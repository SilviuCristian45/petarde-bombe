import type { ClientMessage, GameEvent, GameState } from '@petarde/shared';

// Scenes only talk to the game through this interface, so the same rendering code
// runs on top of the local simulation (LocalTransport) and the Colyseus room (ColyseusTransport).

export type { ClientMessage };

/** Local games are always 'connected'; online ones go through 'reconnecting' after a drop. */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'closed';

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
  /** A room on the server, which others can join with its code. */
  readonly online: boolean;
  /** Only transports that own the simulation can pause it. */
  readonly pausable: boolean;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  connectionStatus(): ConnectionStatus;
  /** Why the connection closed, shown back in the menu. */
  readonly closeReason: string;
  dispose(): void;
}
