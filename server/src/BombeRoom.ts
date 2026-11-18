import { Room, ServerError, type Client } from '@colyseus/core';
import {
  ACTIONS,
  addBot,
  addPlayer,
  backToLobby,
  createGameState,
  ERR_IN_PROGRESS,
  ERR_ROOM_FULL,
  ERR_SERVER_FULL,
  generateRoomCode,
  leavePlayer,
  MAX_PLAYERS,
  MSG_EVENTS,
  MSG_RECORDS,
  removeBot,
  runTick,
  setBotLevel,
  setConnected,
  setDefaultBotLevel,
  setRounds,
  skipBotRound,
  startMatch,
  type Action,
  type GameEvent,
  type GameState,
  type MatchRecords,
  type PlayerInput,
  type RoomStatus,
  type TickEvents,
} from '@petarde/shared';
import {
  MAX_INPUTS_PER_SECOND,
  MAX_MESSAGES_PER_SECOND,
  MAX_ROOMS,
  RECONNECT_SECONDS,
  TICK_INTERVAL_MS,
} from './config';
import { mirror } from './mirror';
import { currentLeaderboard, matchResult } from './leaderboard';
import { isCodeTaken, registerRoom, roomCount, unregisterRoom } from './registry';
import { RoomState } from './schema';

interface JoinOptions {
  name?: unknown;
}

/**
 * One game room. Authoritative: clients only send intents, the room runs the shared
 * simulation at TICK_RATE and mirrors the result into the schema for patching.
 */
export class BombeRoom extends Room<{ state: RoomState }> {
  private game!: GameState;
  private queuedInputs: PlayerInput[] = [];
  /** Events produced outside a tick (leaving players, skipped rounds), sent with the next one. */
  private pendingEvents: GameEvent[] = [];
  private readonly inputWindows = new Map<string, { resetAt: number; count: number }>();
  private botCounter = 0;

  onCreate(): void {
    if (roomCount() >= MAX_ROOMS) throw new ServerError(ERR_SERVER_FULL, 'Serverul e plin');
    // Room codes double as Colyseus room ids, so players join with joinById(code).
    const code = generateRoomCode(Math.random, isCodeTaken);
    this.roomId = code;
    registerRoom(code, this);

    this.maxClients = MAX_PLAYERS;
    this.autoDispose = true;
    this.patchRate = TICK_INTERVAL_MS;
    this.maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

    this.game = createGameState({ code, seed: Math.random().toString(36).slice(2) });
    this.state = new RoomState();
    mirror(this.game, this.state);

    this.onMessage('input', (client, msg: { action?: unknown }) => this.onInput(client, msg?.action));
    this.onMessage('rounds', (client, msg: { rounds?: unknown }) => {
      if (typeof msg?.rounds === 'number') setRounds(this.game, client.sessionId, msg.rounds);
    });
    this.onMessage('addBot', (client) => {
      addBot(this.game, client.sessionId, `bot${++this.botCounter}`);
    });
    this.onMessage('removeBot', (client) => {
      removeBot(this.game, client.sessionId);
    });
    // Levels are validated (host, lobby, known level, a bot) by the shared functions.
    this.onMessage('botLevel', (client, msg: { level?: unknown }) => {
      if (typeof msg?.level === 'number') setDefaultBotLevel(this.game, client.sessionId, msg.level);
    });
    this.onMessage('setBotLevel', (client, msg: { botId?: unknown; level?: unknown }) => {
      if (typeof msg?.botId === 'string' && typeof msg.level === 'number') {
        setBotLevel(this.game, client.sessionId, msg.botId, msg.level);
      }
    });
    this.onMessage('start', async (client) => {
      if (startMatch(this.game, client.sessionId)) await this.lock();
    });
    this.onMessage('lobby', async (client) => {
      if (backToLobby(this.game, client.sessionId)) await this.unlock();
    });
    // Online a round may be fast-forwarded only by the host, and only once every human is dead.
    this.onMessage('skipRound', (client) => {
      if (client.sessionId !== this.game.hostId) return;
      this.queuedInputs = [];
      this.pendingEvents.push(...skipBotRound(this.game));
    });
    this.onMessage('*', () => {
      // unknown message types are ignored
    });

    this.setTimestep(() => this.tick(), TICK_INTERVAL_MS);
  }

  onJoin(client: Client, options?: JoinOptions): void {
    const name = typeof options?.name === 'string' ? options.name : '';
    const result = addPlayer(this.game, client.sessionId, name);
    if (!result.ok) {
      if (result.reason === 'in-progress') throw new ServerError(ERR_IN_PROGRESS, 'Meciul e în desfășurare');
      throw new ServerError(ERR_ROOM_FULL, 'Room-ul e plin');
    }
    mirror(this.game, this.state);
  }

  onDrop(client: Client): void {
    setConnected(this.game, client.sessionId, false);
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client): void {
    setConnected(this.game, client.sessionId, true);
  }

  /** Gone for good: a consented leave, or the reconnection window expired. */
  onLeave(client: Client): void {
    this.pendingEvents.push(...leavePlayer(this.game, client.sessionId));
    this.inputWindows.delete(client.sessionId);
    this.queuedInputs = this.queuedInputs.filter((i) => i.playerId !== client.sessionId);
  }

  onDispose(): void {
    unregisterRoom(this.roomId);
  }

  /** Read by GET /rooms/:code to explain why a join was refused. */
  status(): RoomStatus {
    if (this.game.phase !== 'lobby') return 'playing';
    return Object.keys(this.game.players).length >= MAX_PLAYERS ? 'full' : 'open';
  }

  private onInput(client: Client, action: unknown): void {
    if (this.game.phase !== 'playing' || !ACTIONS.includes(action as Action)) return;
    const now = this.clock.currentTime;
    let window = this.inputWindows.get(client.sessionId);
    if (!window || now >= window.resetAt) {
      window = { resetAt: now + 1000, count: 0 };
      this.inputWindows.set(client.sessionId, window);
    }
    if (++window.count > MAX_INPUTS_PER_SECOND) return;
    // The player id always comes from the connection, never from the message.
    this.queuedInputs.push({ playerId: client.sessionId, action: action as Action });
  }

  private tick(): void {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    // Nothing moves in the lobby; lobby changes are mirrored all the same.
    if (this.game.phase !== 'lobby') events.push(...runTick(this.game, this.queuedInputs));
    this.queuedInputs = [];
    mirror(this.game, this.state);
    if (events.length > 0) {
      const message: TickEvents = { tick: this.game.tick, events };
      this.broadcast(MSG_EVENTS, message);
    }
    // matchEnd happens once per match, from a tick or from a skipped round (sent with this tick).
    if (events.some((e) => e.type === 'matchEnd')) this.saveMatch();
  }

  /** Writes the finished match to the all-time leaderboard. A database error is only logged. */
  private saveMatch(): void {
    const board = currentLeaderboard();
    const result = matchResult(this.game, new Date());
    if (!board || !result) return;
    try {
      const records = board.record(result);
      if (records.length > 0) this.broadcast(MSG_RECORDS, { records } satisfies MatchRecords);
    } catch (err) {
      console.error(`Clasament: meciul din ${this.roomId} nu s-a putut salva:`, err);
    }
  }
}
