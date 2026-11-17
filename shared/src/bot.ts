import {
  BOMB_FUSE_TICKS,
  CELL_BRICK,
  CELL_EMPTY,
  CELL_WALL,
  SHRINK_INTERVAL_TICKS,
  SHRINK_START_TICKS,
  SUB,
} from './constants';
import { blastCells, cellIndex, cellOf } from './grid';
import { shrinkOrder } from './shrink';
import type { Action, GameState, PlayerState } from './types';

// Simple bots: flee danger, break bricks, bomb near players, grab power-ups.
// Pure functions of the state, so the server can fill rooms with bots too.

/** Danger value for cells no fire is heading to. */
export const NO_DANGER = 1 << 30;
const INF = NO_DANGER;
const SAFETY_MARGIN = 4; // ticks
const SHRINK_LOOKAHEAD = 12; // upcoming shrink cells treated as dangerous

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Ticks until each cell is on fire (0 = burning now, INF = safe). */
export function computeDanger(state: GameState): Int32Array {
  const danger = new Int32Array(state.width * state.height).fill(INF);
  const flameCells = new Set<number>();
  for (const f of state.flames) {
    const i = cellIndex(state, f.x, f.y);
    danger[i] = 0;
    flameCells.add(i);
  }

  const bombAtCell = new Map<number, number>();
  state.bombs.forEach((b, k) => bombAtCell.set(cellIndex(state, b.x, b.y), k));
  const times = state.bombs.map((b) => (flameCells.has(cellIndex(state, b.x, b.y)) ? 1 : b.fuse));
  const blasts = state.bombs.map((b) => blastCells(state, b.x, b.y, b.range));
  // A bomb caught in another blast goes off no later than that one.
  for (let changed = true; changed; ) {
    changed = false;
    blasts.forEach((cells, k) => {
      for (const c of cells) {
        const j = bombAtCell.get(c);
        if (j !== undefined && times[j]! > times[k]!) {
          times[j] = times[k]!;
          changed = true;
        }
      }
    });
  }
  blasts.forEach((cells, k) => {
    for (const c of cells) danger[c] = Math.min(danger[c]!, times[k]!);
  });

  if (state.roundTick >= SHRINK_START_TICKS - SHRINK_LOOKAHEAD * SHRINK_INTERVAL_TICKS) {
    const order = shrinkOrder(state.width, state.height);
    const since = state.roundTick - SHRINK_START_TICKS;
    const nextTick =
      since < 0 ? SHRINK_START_TICKS : state.roundTick + SHRINK_INTERVAL_TICKS - (since % SHRINK_INTERVAL_TICKS);
    let k = 0;
    for (let s = state.shrinkIndex; s < order.length && k < SHRINK_LOOKAHEAD; s++) {
      const i = order[s]!;
      if (state.grid[i] === CELL_WALL) continue;
      danger[i] = Math.min(danger[i]!, nextTick + k * SHRINK_INTERVAL_TICKS - state.roundTick);
      k++;
    }
  }
  return danger;
}

interface Search {
  state: GameState;
  start: number;
  ticksPerCell: number;
  danger: Int32Array;
  blocked: Set<number>;
  order: number;
  /** Roaming (not fleeing): never step into a cell that is going to burn. */
  strict?: boolean;
}

/** BFS over walkable cells; a cell is enterable only if we can pass it before it burns. */
function findPath(s: Search, goal: (i: number) => boolean): number[] | null {
  const { state, start, ticksPerCell, danger, blocked } = s;
  const prev = new Int32Array(state.width * state.height).fill(-1);
  const dist = new Int32Array(state.width * state.height).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]!;
    if (goal(cur)) {
      const path: number[] = [];
      for (let c = cur; c !== start; c = prev[c]!) path.push(c);
      return path.reverse();
    }
    const cx = cur % state.width;
    const cy = (cur - cx) / state.width;
    for (let n = 0; n < 4; n++) {
      const [dx, dy] = NEIGHBOURS[(n + s.order) % 4]!;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      const ni = cellIndex(state, nx, ny);
      if (dist[ni]! >= 0 || state.grid[ni] !== CELL_EMPTY || blocked.has(ni)) continue;
      const leaveAt = (dist[cur]! + 2) * ticksPerCell;
      if (danger[ni] !== INF && (s.strict || leaveAt + SAFETY_MARGIN >= danger[ni]!)) continue;
      dist[ni] = dist[cur]! + 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  return null;
}

function directionTo(state: GameState, from: number, to: number): Action {
  const fx = from % state.width;
  const tx = to % state.width;
  if (tx > fx) return 'right';
  if (tx < fx) return 'left';
  return to > from ? 'down' : 'up';
}

function enemyCells(state: GameState, me: PlayerState): Set<number> {
  const cells = new Set<number>();
  for (const p of Object.values(state.players)) {
    if (p.alive && p.id !== me.id) cells.add(cellIndex(state, cellOf(p.x), cellOf(p.y)));
  }
  return cells;
}

function brickNextTo(state: GameState, i: number): boolean {
  const x = i % state.width;
  const y = (i - x) / state.width;
  for (const [dx, dy] of NEIGHBOURS) {
    if (state.grid[cellIndex(state, x + dx, y + dy)] === CELL_BRICK) return true;
  }
  return false;
}

function enemyInBlast(state: GameState, i: number, range: number, enemies: Set<number>): boolean {
  const x = i % state.width;
  const y = (i - x) / state.width;
  for (const c of blastCells(state, x, y, range)) if (enemies.has(c)) return true;
  return false;
}

/** Worth bombing from cell i: a brick next to it or an enemy inside the blast. */
function isBombSpot(state: GameState, i: number, range: number, enemies: Set<number>): boolean {
  return brickNextTo(state, i) || enemyInBlast(state, i, range, enemies);
}

function canEscapeAfterBomb(s: Search, range: number): boolean {
  const { state, start } = s;
  const x = start % state.width;
  const y = (start - x) / state.width;
  const danger = s.danger.slice();
  for (const c of blastCells(state, x, y, range)) danger[c] = Math.min(danger[c]!, BOMB_FUSE_TICKS);
  return findPath({ ...s, danger }, (i) => danger[i] === INF) !== null;
}

export type BotIntent = 'flee' | 'break' | 'attack' | 'powerup' | 'idle';

export interface BotThought {
  action: Action;
  intent: BotIntent;
  /** Cells the bot plans to walk through, last one is its target (empty = none). */
  path: number[];
}

/** Picks the bot's next action for this tick. */
export function botDecide(state: GameState, botId: string): Action {
  return botThink(state, botId).action;
}

/** Same decision as botDecide, plus why and where it is heading (for the debug view). */
export function botThink(state: GameState, botId: string): BotThought {
  const me = state.players[botId];
  if (!me || !me.alive || state.phase !== 'playing') return { action: 'stop', intent: 'idle', path: [] };

  const here = cellIndex(state, cellOf(me.x), cellOf(me.y));
  const blocked = new Set<number>();
  for (const b of state.bombs) blocked.add(cellIndex(state, b.x, b.y));
  blocked.delete(here);
  const s: Search = {
    state,
    start: here,
    ticksPerCell: Math.ceil(SUB / me.speed) + 1,
    danger: computeDanger(state),
    blocked,
    order: (me.slot + Math.floor(state.tick / 60)) % 4,
  };
  const go = (path: number[] | null, intent: BotIntent): BotThought =>
    path && path.length > 0
      ? { action: directionTo(state, here, path[0]!), intent, path }
      : { action: 'stop', intent, path: [] };

  // 1. Standing in a blast zone: run to the nearest safe cell.
  if (s.danger[here] !== INF) {
    return go(findPath(s, (i) => s.danger[i] === INF), 'flee');
  }

  const enemies = enemyCells(state, me);
  let active = 0;
  for (const b of state.bombs) if (b.owner === me.id) active++;
  const hasBomb = active < me.maxBombs && !state.bombs.some((b) => cellIndex(state, b.x, b.y) === here);

  // 2. Good spot and a way out: drop a bomb.
  const bombHere = hasBomb && isBombSpot(state, here, me.range, enemies) && canEscapeAfterBomb(s, me.range);
  if (bombHere) {
    return { action: 'bomb', intent: enemyInBlast(state, here, me.range, enemies) ? 'attack' : 'break', path: [] };
  }

  // 3. Head for a power-up or the nearest useful bombing spot, staying out of danger.
  const powerups = new Set(state.powerups.map((u) => cellIndex(state, u.x, u.y)));
  const roam: Search = { ...s, strict: true };
  const target = findPath(
    roam,
    (i) => i !== here && s.danger[i] === INF && (powerups.has(i) || (hasBomb && isBombSpot(state, i, me.range, enemies))),
  );
  if (target) {
    const end = target[target.length - 1]!;
    const intent = powerups.has(end) ? 'powerup' : enemyInBlast(state, end, me.range, enemies) ? 'attack' : 'break';
    return go(target, intent);
  }

  // 4. Nothing useful in reach: approach the nearest enemy, else wait.
  if (enemies.size > 0) {
    const toEnemy = findPath(roam, (i) => i !== here && enemies.has(i));
    if (toEnemy) return go(toEnemy, 'attack');
  }
  return { action: 'stop', intent: 'idle', path: [] };
}
