import type { Action, GameEvent, GameState } from '@petarde/shared';

// Scenes only talk to the game through this interface, so the same rendering code
// runs on top of the local simulation (LocalTransport) and, later, Colyseus.

export type ClientMessage =
  | { type: 'input'; action: Action }
  | { type: 'rounds'; rounds: number } // host, lobby: 3/5/7
  | { type: 'addBot' } // host, lobby, only where botControls
  | { type: 'removeBot' }
  | { type: 'start' } // host: lobby -> round 1
  | { type: 'lobby' }; // host: finished -> back to the lobby ("Încă un meci")

export interface GameTransport {
  /** Id of the player controlled from this browser. */
  readonly playerId: string;
  /** Latest known state. Read-only for the scene. */
  getState(): Readonly<GameState>;
  send(msg: ClientMessage): void;
  /** Subscribes to simulation events (explosions, deaths...). Returns an unsubscribe function. */
  onEvents(cb: (events: GameEvent[]) => void): () => void;
  /** Called every frame with the elapsed real time. */
  update(dtMs: number): void;
  /** Only transports that own the simulation can pause it. */
  readonly pausable: boolean;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  /** Whether the lobby offers +Bot/-Bot (the local game). */
  readonly botControls: boolean;
  /** Only transports that own the simulation can fast-forward a round that only bots are still playing. */
  readonly skippable: boolean;
  /** Simulates to the end of the current round at once (no-op unless onlyBotsAlive). */
  skipRound(): void;
  dispose(): void;
}
