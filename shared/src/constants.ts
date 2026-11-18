// Timing: the simulation advances in fixed ticks.
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

// Map
export const GRID_W = 19;
export const GRID_H = 13;

// Positions are integers in sub-units; one cell = SUB sub-units.
export const SUB = 1000;
export const HALF = SUB / 2;

// Cell types stored in the grid array.
export const CELL_EMPTY = 0;
export const CELL_WALL = 1;
export const CELL_BRICK = 2;

// Directions stored on players (numbers, schema-friendly).
export const DIR_NONE = 0;
export const DIR_UP = 1;
export const DIR_RIGHT = 2;
export const DIR_DOWN = 3;
export const DIR_LEFT = 4;
export const DIR_VECTORS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

// Power-ups
export const POWERUP_BOMB = 1;
export const POWERUP_RANGE = 2;
export const POWERUP_SPEED = 3;
export const POWERUP_DROP_CHANCE = 0.35;

// Players
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS_TO_START = 2;
export const MAX_NAME_LENGTH = 16;
export const START_BOMBS = 1;
export const MAX_BOMBS = 8;
export const START_RANGE = 2;
export const MAX_RANGE = 8;
export const START_SPEED = 200; // sub-units per tick = 4 cells/s
export const SPEED_STEP = 40;
export const MAX_SPEED = 360; // must stay below HALF
export const BRICK_DENSITY = 0.7;

// Bombs and flames
export const BOMB_FUSE_TICKS = 50; // 2.5 s
export const FLAME_TICKS = 10; // 0.5 s

// Round flow
/** "3, 2, 1, FOC!" at the start of every round: nobody moves or drops bombs until FOC. */
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const ROUND_END_DELAY_TICKS = 20; // 1 s after the last decisive death
export const INTERMISSION_TICKS = 100; // 5 s between rounds
/** Two minutes of fighting after the countdown. */
export const SHRINK_START_TICKS = COUNTDOWN_TICKS + 120 * TICK_RATE;
export const SHRINK_INTERVAL_TICKS = 10; // one cell every 0.5 s
export const ROUND_OPTIONS: readonly number[] = [3, 5, 7];
export const DEFAULT_ROUNDS = 3;

// Scoring
export const POINTS_ROUND_WIN = 3;
export const POINTS_KILL = 1;
export const POINTS_SUICIDE = -1;

// One color per slot (0..5).
export const PLAYER_COLORS: readonly number[] = [
  0xe63946, // roșu
  0x4cc9f0, // albastru
  0xffd60a, // galben
  0x52b788, // verde
  0xc77dff, // mov
  0xff8c42, // portocaliu
];

export const BOT_NAMES: readonly string[] = ['Capra', 'Ursul', 'Sorcova', 'Plugușorul', 'Steaua', 'Căiuții'];
