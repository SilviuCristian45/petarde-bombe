import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { isValidRoomCode, normalizeRoomCode, ROOM_NAME, type LeaderboardResponse } from '@petarde/shared';
import { BombeRoom } from './BombeRoom';
import { MAX_ROOMS } from './config';
import { currentLeaderboard } from './leaderboard';
import { roomCount, roomStatus } from './registry';

const health = createEndpoint('/health', { method: 'GET' }, async (ctx) =>
  ctx.json({ ok: true, rooms: roomCount(), maxRooms: MAX_ROOMS, uptime: Math.round(process.uptime()) }),
);

/** Why a join by code failed: Colyseus reports both a full and a running room as "locked". */
const roomInfo = createEndpoint('/rooms/:code', { method: 'GET' }, async (ctx) => {
  const code = normalizeRoomCode(ctx.params.code);
  return ctx.json({ status: isValidRoomCode(code) ? roomStatus(code) : 'missing' });
});

/** The all-time top (cached on the server, and briefly by browsers and proxies). */
const leaderboard = createEndpoint('/leaderboard', { method: 'GET' }, async (ctx) => {
  ctx.setHeader('Cache-Control', 'public, max-age=30');
  const board = currentLeaderboard();
  let body: LeaderboardResponse = { available: false, entries: [] };
  try {
    if (board) body = { available: true, entries: board.top() };
  } catch (err) {
    console.error('Clasament: nu pot citi topul:', err);
  }
  return ctx.json(body);
});

export function createServer() {
  return defineServer({
    transport: new WebSocketTransport(),
    rooms: { [ROOM_NAME]: defineRoom(BombeRoom) },
    routes: createRouter({ health, roomInfo, leaderboard }),
    greet: false,
  });
}
