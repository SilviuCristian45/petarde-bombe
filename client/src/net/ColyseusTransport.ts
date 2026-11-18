import type { Room } from '@colyseus/sdk';
import {
  MSG_EVENTS,
  type BombState,
  type FlameState,
  type GameEvent,
  type GameState,
  type Phase,
  type PlayerState,
  type PowerUpState,
  type TickEvents,
} from '@petarde/shared';
import type { ClientMessage, ConnectionStatus, GameTransport } from './GameTransport';

// Plays an authoritative Colyseus room: state comes from schema patches (decoded by the SDK
// through reflection), events from the room's "events" message, and only intents go out.

/** Shape of the decoded schema (see server/src/schema.ts). */
interface RemoteCollection<T> {
  forEach(cb: (value: T) => void): void;
}
interface RemoteState {
  code: string;
  phase: string;
  hostId: string;
  roundsTotal: number;
  botLevel: number;
  round: number;
  tick: number;
  roundTick: number;
  phaseTimer: number;
  endingTimer: number;
  roundWinner: string;
  shrinkIndex: number;
  width: number;
  height: number;
  grid: RemoteCollection<number>;
  players: RemoteCollection<Omit<PlayerState, 'bombPressed'>>;
  bombs: RemoteCollection<BombState>;
  flames: RemoteCollection<FlameState>;
  powerups: RemoteCollection<PowerUpState>;
}

/** Events normally wait for their tick's patch; a patch that never comes must not hold them forever. */
const MAX_EVENT_WAIT_MS = 500;
/** Effects of events this old are past (the tab was in the background): they are dropped, not replayed at once. */
const STALE_EVENT_MS = 2000;
const LOST_MESSAGE = 'Conexiunea cu serverul s-a pierdut.';
/** Retries back off 0.2 s, 0.4 s ... up to 5 s: about 20 s in all, past the server's 15 s window. */
const RECONNECT_RETRIES = 8;

export interface ColyseusTransportHooks {
  /** Called with the latest reconnection token, and with null once this player leaves the room. */
  onToken(token: string | null): void;
}

export class ColyseusTransport implements GameTransport {
  readonly playerId: string;
  readonly online = true;
  readonly pausable = false;
  closeReason = '';
  private state: GameState;
  private dirty = false;
  private status: ConnectionStatus = 'connected';
  private disposed = false;
  private readonly queued: { tick: number; at: number; events: GameEvent[] }[] = [];
  private readonly listeners = new Set<(events: GameEvent[]) => void>();

  constructor(
    private readonly room: Room,
    private readonly hooks: ColyseusTransportHooks,
  ) {
    this.playerId = room.sessionId;
    this.state = toGameState(room.state as RemoteState);
    // The SDK skips auto-reconnection for rooms joined less than 5 s ago; a drop right after Start must still recover.
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = RECONNECT_RETRIES;
    hooks.onToken(room.reconnectionToken);

    room.onStateChange(() => {
      this.dirty = true;
    });
    room.onMessage(MSG_EVENTS, (msg: TickEvents) => {
      this.queued.push({ tick: msg.tick, at: performance.now(), events: msg.events });
    });
    room.onDrop(() => {
      this.status = 'reconnecting';
    });
    room.onReconnect(() => {
      // Left while the connection was down: the leave could not reach the server then, so send it now.
      if (this.disposed) {
        void room.leave().catch(() => undefined);
        return;
      }
      this.status = 'connected';
      hooks.onToken(room.reconnectionToken);
    });
    // The token is kept here on purpose: a tab reload also closes the socket and must be able to resume.
    room.onLeave(() => {
      if (this.disposed) return;
      this.status = 'closed';
      this.closeReason = LOST_MESSAGE;
    });
    // Failed attempts while reconnecting also land here; the banner already tells that story.
    room.onError((code, message) => {
      if (this.status === 'connected') console.warn(`Colyseus error ${code}: ${message ?? ''}`);
    });
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  send(msg: ClientMessage): void {
    // Inputs from while the connection is down would replay late; lobby actions can wait in the SDK queue.
    if (this.status === 'closed' || (msg.type === 'input' && this.status !== 'connected')) return;
    const { type, ...payload } = msg;
    this.room.send(type, payload);
  }

  onEvents(cb: (events: GameEvent[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  update(): void {
    if (this.dirty) {
      this.dirty = false;
      this.state = toGameState(this.room.state as RemoteState);
    }
    this.flushEvents();
  }

  isPaused(): boolean {
    return false;
  }

  setPaused(): void {
    // the server owns the clock
  }

  connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** Leaving for good: a consented leave (no 15 s seat) and the token forgotten, so a reload does not rejoin. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.hooks.onToken(null);
    void this.room.leave().catch(() => undefined);
  }

  /**
   * The events message and the state patch of a tick travel separately and may arrive in
   * either order; events are released once the state has reached their tick, so effects
   * line up with what is drawn (the same order LocalTransport emits them in).
   */
  private flushEvents(): void {
    const now = performance.now();
    let ready: GameEvent[] = [];
    while (this.queued.length > 0) {
      const next = this.queued[0]!;
      if (next.tick > this.state.tick && now - next.at < MAX_EVENT_WAIT_MS) break;
      this.queued.shift();
      if (now - next.at < STALE_EVENT_MS) ready = ready.concat(next.events);
    }
    if (ready.length > 0) for (const cb of this.listeners) cb(ready);
  }
}

function toGameState(r: RemoteState): GameState {
  const players: Record<string, PlayerState> = {};
  r.players.forEach((p) => {
    players[p.id] = { ...pick(p), bombPressed: false };
  });
  return {
    code: r.code,
    phase: (r.phase || 'lobby') as Phase,
    hostId: r.hostId,
    roundsTotal: r.roundsTotal,
    botLevel: r.botLevel,
    round: r.round,
    tick: r.tick,
    roundTick: r.roundTick,
    phaseTimer: r.phaseTimer,
    endingTimer: r.endingTimer,
    roundWinner: r.roundWinner,
    // Server-only fields; the client never simulates.
    rng: 0,
    nextId: 0,
    joinCounter: 0,
    shrinkIndex: r.shrinkIndex,
    width: r.width,
    height: r.height,
    grid: toArray(r.grid, (c) => c),
    players,
    bombs: toArray(r.bombs, (b) => ({ id: b.id, x: b.x, y: b.y, owner: b.owner, fuse: b.fuse, range: b.range })),
    flames: toArray(r.flames, (f) => ({ x: f.x, y: f.y, ttl: f.ttl, owner: f.owner })),
    powerups: toArray(r.powerups, (u) => ({ x: u.x, y: u.y, type: u.type })),
  };
}

function pick(p: Omit<PlayerState, 'bombPressed'>): Omit<PlayerState, 'bombPressed'> {
  return {
    id: p.id,
    name: p.name,
    slot: p.slot,
    joinOrder: p.joinOrder,
    isBot: p.isBot,
    botLevel: p.botLevel,
    connected: p.connected,
    left: p.left,
    alive: p.alive,
    x: p.x,
    y: p.y,
    dir: p.dir,
    maxBombs: p.maxBombs,
    range: p.range,
    speed: p.speed,
    wins: p.wins,
    kills: p.kills,
    deaths: p.deaths,
    points: p.points,
    suicides: p.suicides,
    bricks: p.bricks,
    pickups: p.pickups,
  };
}

function toArray<T, U>(items: RemoteCollection<T>, map: (item: T) => U): U[] {
  const out: U[] = [];
  items.forEach((item) => out.push(map(item)));
  return out;
}
