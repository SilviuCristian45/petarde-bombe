// Game state is flat and serializable so it maps directly onto @colyseus/schema:
// players -> MapSchema, grid/bombs/flames/powerups -> ArraySchema.

export type Phase = 'lobby' | 'playing' | 'intermission' | 'finished';

export type Action = 'up' | 'down' | 'left' | 'right' | 'stop' | 'bomb';

export interface PlayerInput {
  playerId: string;
  action: Action;
}

export interface PlayerState {
  id: string;
  name: string;
  slot: number; // 0..5, also the color index and spawn index
  joinOrder: number;
  isBot: boolean;
  connected: boolean;
  alive: boolean;
  x: number; // sub-units, center of the player
  y: number;
  dir: number; // DIR_* currently held
  bombPressed: boolean; // consumed at the next tick
  maxBombs: number;
  range: number;
  speed: number;
  wins: number;
  kills: number;
  deaths: number;
  points: number;
}

export interface BombState {
  id: number;
  x: number; // cell
  y: number;
  owner: string;
  fuse: number; // ticks left
  range: number;
}

export interface FlameState {
  x: number;
  y: number;
  ttl: number;
  owner: string; // player credited for kills ('' = nobody)
}

export interface PowerUpState {
  x: number;
  y: number;
  type: number; // POWERUP_*
}

export interface GameState {
  code: string;
  phase: Phase;
  hostId: string;
  roundsTotal: number;
  round: number;
  tick: number;
  roundTick: number;
  phaseTimer: number; // intermission countdown
  endingTimer: number; // >0 while a round is about to end
  roundWinner: string; // '' = draw (or no round finished yet)
  rng: number; // uint32 RNG state
  nextId: number;
  joinCounter: number;
  shrinkIndex: number;
  width: number;
  height: number;
  grid: number[];
  players: Record<string, PlayerState>;
  bombs: BombState[];
  flames: FlameState[];
  powerups: PowerUpState[];
}

export type GameEvent =
  | { type: 'bombPlaced'; x: number; y: number; owner: string }
  | { type: 'explosion'; x: number; y: number; owner: string; cells: number[] }
  | { type: 'brickDestroyed'; x: number; y: number }
  | { type: 'pickup'; playerId: string; powerup: number }
  | { type: 'death'; playerId: string; killerId: string; suicide: boolean }
  | { type: 'shrink'; x: number; y: number }
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; round: number; winnerId: string }
  | { type: 'matchEnd'; standings: string[] };
