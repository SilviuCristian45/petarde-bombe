import type { Action, GameEvent, GameState } from '@petarde/shared';

// Scenes only talk to the game through this interface, so the same rendering code
// runs on top of the local simulation (LocalTransport) and, later, Colyseus.

export type ClientMessage =
  | { type: 'input'; action: Action }
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
  dispose(): void;
}
