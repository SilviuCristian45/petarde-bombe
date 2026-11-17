import {
  addBot,
  addPlayer,
  applyInput,
  backToLobby,
  botDecide,
  createGameState,
  generateRoomCode,
  sortedPlayers,
  startMatch,
  step,
  TICK_MS,
  type GameEvent,
  type GameState,
  type PlayerInput,
} from '@petarde/shared';
import type { ClientMessage, GameTransport } from './GameTransport';

export interface LocalOptions {
  name: string;
  bots: number;
  rounds: number;
  seed: string;
}

const MAX_FRAME_MS = 250; // after a stall, catch up at most this much

/** Runs the shared simulation in the browser, with bots filling the room. */
export class LocalTransport implements GameTransport {
  readonly playerId = 'local';
  readonly pausable = true;
  private readonly state: GameState;
  private readonly pending: PlayerInput[] = [];
  private readonly listeners = new Set<(events: GameEvent[]) => void>();
  private acc = 0;
  private paused = false;

  constructor(opts: LocalOptions) {
    this.state = createGameState({ code: generateRoomCode(Math.random), seed: opts.seed });
    addPlayer(this.state, this.playerId, opts.name);
    for (let i = 0; i < opts.bots; i++) addBot(this.state, this.playerId, `bot${i + 1}`);
    this.state.roundsTotal = opts.rounds;
    startMatch(this.state, this.playerId);
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  send(msg: ClientMessage): void {
    if (msg.type === 'input') this.pending.push({ playerId: this.playerId, action: msg.action });
    else if (msg.type === 'start') startMatch(this.state, this.playerId);
    else if (msg.type === 'lobby') backToLobby(this.state, this.playerId);
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

  dispose(): void {
    this.listeners.clear();
  }

  private tick(): void {
    for (const input of this.pending) applyInput(this.state, input);
    this.pending.length = 0;
    for (const p of sortedPlayers(this.state)) {
      if (p.isBot && p.alive) applyInput(this.state, { playerId: p.id, action: botDecide(this.state, p.id) });
    }
    const events = step(this.state);
    if (events.length > 0) for (const cb of this.listeners) cb(events);
  }
}
