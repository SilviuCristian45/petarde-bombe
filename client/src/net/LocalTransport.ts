import {
  addBot,
  addPlayer,
  backToLobby,
  createGameState,
  generateRoomCode,
  removeBot,
  runTick,
  setBotLevel,
  setDefaultBotLevel,
  setRounds,
  skipBotRound,
  startMatch,
  TICK_MS,
  type GameEvent,
  type GameState,
  type NewRecord,
  type PlayerInput,
} from '@petarde/shared';
import type { ClientMessage, ConnectionStatus, GameTransport } from './GameTransport';

export interface LocalOptions {
  name: string;
  bots: number;
  /** Level of the bots added at the start (BOT_EASY..BOT_HARD); the room default otherwise. */
  botLevel?: number;
  rounds: number;
  seed: string;
  /** Start round 1 right away (debug URL options) instead of waiting in the lobby. */
  autoStart: boolean;
}

const MAX_FRAME_MS = 250; // after a stall, catch up at most this much

/** Runs the shared simulation in the browser, with bots filling the room. */
export class LocalTransport implements GameTransport {
  readonly playerId = 'local';
  readonly online = false;
  readonly pausable = true;
  readonly closeReason = '';
  private readonly state: GameState;
  private readonly pending: PlayerInput[] = [];
  private readonly listeners = new Set<(events: GameEvent[]) => void>();
  private acc = 0;
  private paused = false;
  private botCounter = 0;

  constructor(opts: LocalOptions) {
    this.state = createGameState({ code: generateRoomCode(Math.random), seed: opts.seed });
    addPlayer(this.state, this.playerId, opts.name);
    if (opts.botLevel !== undefined) setDefaultBotLevel(this.state, this.playerId, opts.botLevel);
    for (let i = 0; i < opts.bots; i++) this.addBot();
    setRounds(this.state, this.playerId, opts.rounds);
    if (opts.autoStart) startMatch(this.state, this.playerId);
  }

  /** Offline matches never enter the leaderboard. */
  newRecords(): readonly NewRecord[] {
    return [];
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  send(msg: ClientMessage): void {
    if (msg.type === 'input') this.pending.push({ playerId: this.playerId, action: msg.action });
    else if (msg.type === 'rounds') setRounds(this.state, this.playerId, msg.rounds);
    else if (msg.type === 'addBot') this.addBot();
    else if (msg.type === 'removeBot') removeBot(this.state, this.playerId);
    else if (msg.type === 'botLevel') setDefaultBotLevel(this.state, this.playerId, msg.level);
    else if (msg.type === 'setBotLevel') setBotLevel(this.state, this.playerId, msg.botId, msg.level);
    else if (msg.type === 'start') startMatch(this.state, this.playerId);
    else if (msg.type === 'lobby') backToLobby(this.state, this.playerId);
    else if (msg.type === 'skipRound') this.skipRound();
  }

  onEvents(cb: (events: GameEvent[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  update(dtMs: number): void {
    if (this.paused) return;
    this.acc += Math.min(dtMs, MAX_FRAME_MS);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.tick();
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.acc = 0;
  }

  connectionStatus(): ConnectionStatus {
    return 'connected';
  }

  private skipRound(): void {
    this.pending.length = 0;
    this.acc = 0;
    this.emit(skipBotRound(this.state));
  }

  dispose(): void {
    this.listeners.clear();
  }

  private addBot(): void {
    addBot(this.state, this.playerId, `bot${++this.botCounter}`);
  }

  private tick(): void {
    const events = runTick(this.state, this.pending);
    this.pending.length = 0;
    this.emit(events);
  }

  private emit(events: GameEvent[]): void {
    if (events.length > 0) for (const cb of this.listeners) cb(events);
  }
}
