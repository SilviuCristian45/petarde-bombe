import { BRICK_DENSITY, CELL_BRICK, CELL_EMPTY, CELL_WALL, HALF, SUB } from './constants';
import { nextRandom } from './rng';
import type { BombState, GameState } from './types';

const ARMS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function cellIndex(state: Pick<GameState, 'width'>, x: number, y: number): number {
  return y * state.width + x;
}

export function cellOf(pos: number): number {
  return Math.floor(pos / SUB);
}

export function cellCenter(cell: number): number {
  return cell * SUB + HALF;
}

export function inBounds(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

export function cellAt(state: GameState, x: number, y: number): number {
  return inBounds(state, x, y) ? state.grid[cellIndex(state, x, y)]! : CELL_WALL;
}

export function bombAt(state: GameState, x: number, y: number): BombState | undefined {
  return state.bombs.find((b) => b.x === x && b.y === y);
}

/** True when a player cannot walk into the cell. */
export function isBlocked(state: GameState, x: number, y: number): boolean {
  return cellAt(state, x, y) !== CELL_EMPTY || bombAt(state, x, y) !== undefined;
}

export function isFixedWall(x: number, y: number, width: number, height: number): boolean {
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

/** Spawn cells in slot order: opposite corners first, then the side middles. */
export function spawnPoints(width: number, height: number): [number, number][] {
  const r = width - 2;
  const b = height - 2;
  const mid = Math.floor(height / 2);
  return [
    [1, 1],
    [r, b],
    [r, 1],
    [1, b],
    [1, mid],
    [r, mid],
  ];
}

/** Cells kept free around each spawn so players can escape their first bomb. */
export function spawnSafeCells(width: number, height: number): Set<number> {
  const safe = new Set<number>();
  const add = (x: number, y: number) => {
    if (!isFixedWall(x, y, width, height)) safe.add(y * width + x);
  };
  const r = width - 2;
  const b = height - 2;
  const mid = Math.floor(height / 2);
  const corners: [number, number, number, number][] = [
    [1, 1, 1, 1],
    [r, 1, -1, 1],
    [1, b, 1, -1],
    [r, b, -1, -1],
  ];
  for (const [sx, sy, dx, dy] of corners) {
    for (let k = 0; k <= 2; k++) {
      add(sx + dx * k, sy);
      add(sx, sy + dy * k);
    }
  }
  const sides: [number, number][] = [
    [1, 1],
    [r, -1],
  ];
  for (const [sx, dx] of sides) {
    for (let k = -2; k <= 2; k++) add(sx, mid + k);
    add(sx + dx, mid - 1);
    add(sx + dx, mid + 1);
  }
  return safe;
}

/** Fixed walls in the classic pattern plus seeded destructible bricks. */
export function generateGrid(state: GameState): number[] {
  const { width, height } = state;
  const safe = spawnSafeCells(width, height);
  const grid: number[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (isFixedWall(x, y, width, height)) grid[i] = CELL_WALL;
      else if (safe.has(i)) grid[i] = CELL_EMPTY;
      else grid[i] = nextRandom(state) < BRICK_DENSITY ? CELL_BRICK : CELL_EMPTY;
    }
  }
  return grid;
}

/**
 * Cells a blast from (x, y) reaches: the center plus each arm until a wall (excluded)
 * or a brick/bomb (included, stops the arm). A piercing blast goes on through bricks.
 */
export function blastCells(state: GameState, x: number, y: number, range: number, pierce = false): number[] {
  const cells = [cellIndex(state, x, y)];
  for (const [dx, dy] of ARMS) {
    for (let k = 1; k <= range; k++) {
      const cx = x + dx * k;
      const cy = y + dy * k;
      const cell = cellAt(state, cx, cy);
      if (cell === CELL_WALL) break;
      cells.push(cellIndex(state, cx, cy));
      if ((cell === CELL_BRICK && !pierce) || bombAt(state, cx, cy)) break;
    }
  }
  return cells;
}
