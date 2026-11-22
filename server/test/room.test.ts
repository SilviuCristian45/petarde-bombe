import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  BOT_EASY,
  BOT_HARD,
  BOT_MEDIUM,
  COUNTDOWN_TICKS,
  ERR_ROOM_FULL,
  ERR_SERVER_FULL,
  isValidRoomCode,
  MAX_PLAYERS,
  MSG_EVENTS,
  MSG_RECORDS,
  ROOM_NAME,
  type GameState,
  type LeaderboardResponse,
  type MatchRecords,
  type TickEvents,
} from '@petarde/shared';
import { createServer as createNetServer } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/app';
import type { BombeRoom } from '../src/BombeRoom';
import { MAX_ROOMS } from '../src/config';
import { openLeaderboard, useLeaderboard, type Leaderboard } from '../src/leaderboard';

let colyseus: ColyseusTestServer;
let board: Leaderboard;

/** A port nothing listens on, so another local Colyseus server (default test port 2568) is never hit by mistake. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  // Not boot(): for a Server instance it ignores its port argument and always listens on 2568.
  const server = createServer();
  await server.listen(await freePort());
  colyseus = new ColyseusTestServer(server);
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
  board = openLeaderboard(':memory:')!;
  useLeaderboard(board);
});
afterEach(() => {
  useLeaderboard(null);
  try {
    board.close();
  } catch {
    // a test closed it already
  }
});

/** The authoritative game state inside the server room. */
const game = (room: BombeRoom): GameState => room['game'];

async function create(name = 'Ana'): Promise<{ client: ClientRoom; room: BombeRoom }> {
  const client = await colyseus.sdk.create(ROOM_NAME, { name });
  const room = colyseus.getRoomById<BombeRoom>(client.roomId);
  return { client, room };
}

function join(code: string, name = 'Ion'): Promise<ClientRoom> {
  return colyseus.sdk.joinById(code, { name });
}

/** Sends a message and waits until the room has processed it. */
async function send(client: ClientRoom, room: BombeRoom, type: string, payload?: unknown): Promise<void> {
  client.send(type, payload);
  await room.waitForNextMessage();
  await room.waitForNextTimestep();
}

/** Plays a one-round match to its end: everyone but `winnerId` dies once the countdown is over. */
async function finishMatch(room: BombeRoom, winnerId: string): Promise<void> {
  const g = game(room);
  g.roundsTotal = 1;
  g.roundTick = COUNTDOWN_TICKS;
  for (const p of Object.values(g.players)) p.alive = p.id === winnerId;
  for (let i = 0; i < 100 && g.phase !== 'finished'; i++) await room.waitForNextTimestep();
  expect(g.phase).toBe('finished');
  await room.waitForNextTimestep(); // the tick's messages are out
}

async function status(code: string): Promise<string> {
  const res = await colyseus.http.get(`/rooms/${code}`);
  return (res.data as { status: string }).status;
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: number; message: string }> {
  try {
    await promise;
  } catch (e) {
    return e as { code?: number; message: string };
  }
  throw new Error('expected the promise to reject');
}

describe('BombeRoom', () => {
  it('uses a 6-character room code as its id and makes the creator host', async () => {
    const { client, room } = await create();
    expect(isValidRoomCode(client.roomId)).toBe(true);
    expect(game(room).code).toBe(client.roomId);
    expect(game(room).hostId).toBe(client.sessionId);
    await room.waitForNextPatch();
    expect(room.state.code).toBe(client.roomId);
    const health = await colyseus.http.get('/health');
    expect(health.data).toMatchObject({ ok: true, rooms: 1 });
  });

  it('lets players join by code, with a cleaned nickname', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId, '  Ion\u0007‮ cel Mare din Deal ');
    expect(Object.keys(game(room).players)).toHaveLength(2);
    expect(game(room).players[guest.sessionId]!.name).toBe('Ion cel Mare din');
    expect(await status(client.roomId)).toBe('open');
  });

  it('refuses an unknown code', async () => {
    const err = await rejection(join('ABCDEF'));
    expect(err.message).toMatch(/not found/);
    expect(await status('ABCDEF')).toBe('missing');
  });

  it('refuses a seventh player', async () => {
    const { client } = await create();
    for (let i = 1; i < MAX_PLAYERS; i++) await join(client.roomId, `P${i}`);
    expect(await status(client.roomId)).toBe('full');
    const err = await rejection(join(client.roomId));
    expect(err.message).toMatch(/locked/);
  });

  it('counts bots against the six places', async () => {
    const { client, room } = await create();
    for (let i = 1; i < MAX_PLAYERS; i++) await send(client, room, 'addBot');
    expect(Object.keys(game(room).players)).toHaveLength(MAX_PLAYERS);
    const err = await rejection(join(client.roomId));
    expect(err.code).toBe(ERR_ROOM_FULL);
  });

  it('locks during a match and unlocks back in the lobby', async () => {
    const { client, room } = await create();
    await join(client.roomId);
    await send(client, room, 'start');
    expect(game(room).phase).toBe('playing');
    expect(room.locked).toBe(true);
    expect(await status(client.roomId)).toBe('playing');
    expect((await rejection(join(client.roomId, 'Eva'))).message).toMatch(/locked/);

    game(room).phase = 'finished';
    await send(client, room, 'lobby');
    expect(game(room).phase).toBe('lobby');
    expect(room.locked).toBe(false);
    await join(client.roomId, 'Eva');
    expect(Object.keys(game(room).players)).toHaveLength(3);
  });

  it('only lets the host start the match, change rounds or add bots', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId);
    await send(guest, room, 'rounds', { rounds: 7 });
    await send(guest, room, 'addBot');
    await send(guest, room, 'start');
    expect(game(room).phase).toBe('lobby');
    expect(game(room).roundsTotal).toBe(3);
    expect(Object.keys(game(room).players)).toHaveLength(2);

    await send(client, room, 'rounds', { rounds: 7 });
    await send(client, room, 'start');
    expect(game(room).roundsTotal).toBe(7);
    expect(game(room).phase).toBe('playing');
  });

  it('passes the host to the next human, never to a bot', async () => {
    const { client, room } = await create();
    await send(client, room, 'addBot'); // joined before the guest
    const guest = await join(client.roomId);
    await client.leave();
    await room.waitForNextTimestep();
    expect(game(room).hostId).toBe(guest.sessionId);
    await room.waitForNextPatch();
    expect(room.state.hostId).toBe(guest.sessionId);
  });

  it('refuses skipRound while a human is alive, allows it to the host once all are dead', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId);
    await send(client, room, 'addBot');
    await send(client, room, 'start');

    game(room).players[client.sessionId]!.alive = false;
    await send(client, room, 'skipRound'); // the guest is still alive
    expect(game(room).phase).toBe('playing');
    expect(game(room).round).toBe(1);

    game(room).players[guest.sessionId]!.alive = false;
    await send(guest, room, 'skipRound'); // not the host
    expect(game(room).phase).toBe('playing');

    await send(client, room, 'skipRound');
    expect(game(room).phase).toBe('intermission');
  });

  it('applies inputs only to the sender and only while playing', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId);
    await send(guest, room, 'input', { action: 'right' }); // lobby: ignored
    await send(client, room, 'start');
    const host = game(room).players[client.sessionId]!;
    const startX = host.x;

    await send(guest, room, 'input', { action: 'down', playerId: client.sessionId });
    await send(guest, room, 'input', { action: 'fly' });
    expect(host.x).toBe(startX);
    expect(host.dir).toBe(0);
    expect(game(room).players[guest.sessionId]!.dir).not.toBe(0);
  });

  it('kills a player who leaves mid-round, without crediting a kill', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId);
    await send(client, room, 'start');
    const guestId = guest.sessionId;
    const death = client.waitForMessage('events');
    await guest.leave();
    await room.waitForNextTimestep();
    const p = game(room).players[guestId]!;
    expect(p).toMatchObject({ alive: false, left: true, deaths: 0 });
    expect(Object.values(game(room).players).every((q) => q.kills === 0)).toBe(true);
    const msg = (await death) as { tick: number; events: { type: string; playerId: string }[] };
    expect(msg.events).toContainEqual(expect.objectContaining({ type: 'death', playerId: guestId, killerId: '' }));
    expect(msg.tick).toBe(game(room).tick);
  });

  it('frees a lobby seat at once when a player leaves', async () => {
    const { client, room } = await create();
    const guests: ClientRoom[] = [];
    for (let i = 1; i < MAX_PLAYERS; i++) guests.push(await join(client.roomId, `P${i}`));
    expect(await status(client.roomId)).toBe('full');

    await guests[0]!.leave();
    await room.waitForNextTimestep();
    expect(game(room).players[guests[0]!.sessionId]).toBeUndefined();
    await room.waitForNextPatch();
    expect(room.state.players.has(guests[0]!.sessionId)).toBe(false);
    expect(await status(client.roomId)).toBe('open');
    await join(client.roomId, 'Eva');
    expect(Object.keys(game(room).players)).toHaveLength(MAX_PLAYERS);
  });

  it('keeps a player who left mid-match as "left" only until the lobby', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId);
    await send(client, room, 'addBot');
    await send(client, room, 'start');
    const guestId = guest.sessionId;
    await guest.leave();
    await room.waitForNextTimestep();
    expect(game(room).players[guestId]).toMatchObject({ left: true, connected: false, alive: false });

    game(room).phase = 'finished';
    await room.waitForNextPatch();
    expect(room.state.players.get(guestId)?.left).toBe(true); // still in this match's standings

    await send(client, room, 'lobby');
    expect(game(room).phase).toBe('lobby');
    expect(game(room).players[guestId]).toBeUndefined();
    await room.waitForNextPatch();
    expect(room.state.players.has(guestId)).toBe(false);
    expect(Object.keys(game(room).players)).toHaveLength(2);
  });

  it('lets only the host set bot levels, only in the lobby, only to valid values', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId);
    await send(client, room, 'addBot');
    const botId = Object.values(game(room).players).find((p) => p.isBot)!.id;
    expect(game(room).players[botId]!.botLevel).toBe(BOT_MEDIUM);
    const guestLevel = game(room).players[guest.sessionId]!.botLevel;

    await send(guest, room, 'botLevel', { level: BOT_HARD });
    await send(guest, room, 'setBotLevel', { botId, level: BOT_HARD });
    await send(client, room, 'botLevel', { level: 7 });
    await send(client, room, 'setBotLevel', { botId, level: '2' });
    await send(client, room, 'setBotLevel', { botId: guest.sessionId, level: BOT_EASY });
    expect(game(room).botLevel).toBe(BOT_MEDIUM);
    expect(game(room).players[botId]!.botLevel).toBe(BOT_MEDIUM);
    expect(game(room).players[guest.sessionId]!.botLevel).toBe(guestLevel);

    await send(client, room, 'botLevel', { level: BOT_EASY });
    await send(client, room, 'setBotLevel', { botId, level: BOT_HARD });
    await send(client, room, 'addBot');
    expect(game(room).botLevel).toBe(BOT_EASY);
    expect(game(room).players[botId]!.botLevel).toBe(BOT_HARD);
    const second = Object.values(game(room).players).find((p) => p.isBot && p.id !== botId)!;
    expect(second.botLevel).toBe(BOT_EASY);
    await room.waitForNextPatch();
    expect(room.state.botLevel).toBe(BOT_EASY);
    expect(room.state.players.get(botId)?.botLevel).toBe(BOT_HARD);

    await send(client, room, 'start');
    await send(client, room, 'setBotLevel', { botId, level: BOT_EASY });
    expect(game(room).players[botId]!.botLevel).toBe(BOT_HARD);
  });

  it('mirrors the match statistics used by the end-of-match awards', async () => {
    const { client, room } = await create();
    await join(client.roomId);
    await send(client, room, 'start');
    Object.assign(game(room).players[client.sessionId]!, { suicides: 2, bricks: 7, pickups: 3 });
    await room.waitForNextPatch();
    expect(room.state.players.get(client.sessionId)).toMatchObject({ suicides: 2, bricks: 7, pickups: 3 });
  });

  it('keeps a dropped player for reconnection', async () => {
    const { client, room } = await create();
    const guest = await join(client.roomId);
    const token = guest.reconnectionToken;
    guest.reconnection.enabled = false;
    await guest.leave(false); // not consented: a drop
    await room.waitForNextTimestep();
    expect(game(room).players[guest.sessionId]!.connected).toBe(false);

    const back = await colyseus.sdk.reconnect(token);
    expect(back.sessionId).toBe(guest.sessionId);
    await room.waitForNextTimestep();
    expect(game(room).players[guest.sessionId]!.connected).toBe(true);
  });

  it(`refuses to create more than ${MAX_ROOMS} rooms`, async () => {
    for (let i = 0; i < MAX_ROOMS; i++) await create(`P${i}`);
    const err = await rejection(create());
    expect(err.code).toBe(ERR_SERVER_FULL);
    expect(err.message).toBe('Serverul e plin');
  });
});

describe('all-time leaderboard', () => {
  it('saves a finished online match with two humans, without bots, and announces new records', async () => {
    const { client, room } = await create('Ana');
    const guest = await join(client.roomId, 'Ion');
    await send(client, room, 'addBot');
    const records: MatchRecords[] = [];
    client.onMessage(MSG_RECORDS, (msg: MatchRecords) => records.push(msg));
    await send(client, room, 'start');
    await finishMatch(room, client.sessionId);

    expect(board.top().map((e) => [e.name, e.wins])).toEqual([
      ['Ana', 1],
      ['Ion', 0],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(records).toEqual([
      {
        records: [
          { playerId: client.sessionId, name: 'Ana', place: 1 },
          { playerId: guest.sessionId, name: 'Ion', place: 2 },
        ],
      },
    ]);

    const res = await colyseus.http.get('/leaderboard');
    const body = res.data as LeaderboardResponse;
    expect(body.available).toBe(true);
    expect(body.entries[0]).toMatchObject({ place: 1, name: 'Ana', points: 3, wins: 1, rounds: 1 });
    // The SDK's HTTP client hands headers back as a plain object.
    expect((res.headers as unknown as Record<string, string>)['cache-control']).toBe('public, max-age=30');
  });

  it('leaves out a player who left mid-match', async () => {
    const { client, room } = await create('Ana');
    const guest = await join(client.roomId, 'Ion');
    await join(client.roomId, 'Vlad');
    await send(client, room, 'start');
    await guest.leave();
    await room.waitForNextTimestep();
    await finishMatch(room, client.sessionId);
    expect(board.top().map((e) => e.name)).toEqual(['Ana', 'Vlad']);
  });

  it('does not count a match with a single human', async () => {
    const { client, room } = await create('Ana');
    await send(client, room, 'addBot');
    await send(client, room, 'start');
    await finishMatch(room, client.sessionId);
    expect(board.top()).toEqual([]);
  });

  it('finishes the match normally when the database fails', async () => {
    const { client, room } = await create('Ana');
    await join(client.roomId, 'Ion');
    const events: TickEvents[] = [];
    client.onMessage(MSG_EVENTS, (msg: TickEvents) => events.push(msg));
    await send(client, room, 'start');
    board.close(); // every write now throws
    const original = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await finishMatch(room, client.sessionId);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.flatMap((m) => m.events).some((e) => e.type === 'matchEnd')).toBe(true);
    // The room carries on: back to the lobby for another match.
    await send(client, room, 'lobby');
    expect(game(room).phase).toBe('lobby');
  });
});
