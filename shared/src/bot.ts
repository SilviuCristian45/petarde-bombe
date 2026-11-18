import {
  BOMB_FUSE_TICKS,
  BOT_EASY,
  BOT_HARD,
  BOT_MEDIUM,
  CELL_BRICK,
  CELL_EMPTY,
  CELL_WALL,
  DIR_NONE,
  DIR_VECTORS,
  SHRINK_INTERVAL_TICKS,
  SHRINK_START_TICKS,
  SUB,
} from './constants';
import { blastCells, cellCenter, cellIndex, cellOf } from './grid';
import { seedFrom } from './rng';
import { shrinkOrder } from './shrink';
import type { Action, GameState, PlayerState } from './types';

// Simple bots: flee danger, break bricks, bomb near players, grab power-ups.
// Pure functions of the state, so the server can fill rooms with bots too.
// The three levels run the same code; only the parameters below differ.

export interface BotLevelParams {
  /** Ticks between decisions; in between the bot walks on to the next cell center and waits there. */
  thinkEvery: number;
  /** Chance that enemies count as targets during a mood window (bombing them, walking to them). */
  hunt: number;
  /** How far (in cells) the bot walks to get at an enemy. */
  chase: number;
  /** Chance per decision of a random safe step instead of the planned one (and a clumsier escape). */
  mistake: number;
  /** Chance per decision of standing still while out of danger. */
  hesitate: number;
  /** Chance of ignoring a given power-up for the whole round. */
  skipPowerup: number;
  /** Fire from other players' bombs is noticed only once it is this many ticks away (own bombs at once). */
  noticeFire: number;
  /** Chance of a random safe step when there is nothing to do, instead of standing still. */
  wander: number;
}

const NEVER = 1 << 30;

export const BOT_PARAMS: Readonly<Record<number, BotLevelParams>> = {
  [BOT_EASY]: { thinkEvery: 8, hunt: 0.1, chase: 4, mistake: 0.2, hesitate: 0.2, skipPowerup: 0.5, noticeFire: 30, wander: 0.5 },
  [BOT_MEDIUM]: { thinkEvery: 4, hunt: 0.45, chase: 8, mistake: 0.07, hesitate: 0.05, skipPowerup: 0.15, noticeFire: 40, wander: 0.5 },
  // The original bots: decide every tick, always hunt, never err.
  [BOT_HARD]: { thinkEvery: 1, hunt: 1, chase: NEVER, mistake: 0, hesitate: 0, skipPowerup: 0, noticeFire: NEVER, wander: 0 },
};

export function botParams(level: number): BotLevelParams {
  return BOT_PARAMS[level] ?? BOT_PARAMS[BOT_HARD]!;
}

/** Hunting moods last this long, so a bot does not flip between targets at every decision. */
const MOOD_TICKS = 60;
const SALT_MISTAKE = 1;
const SALT_HESITATE = 2;
const SALT_HUNT = 3;
const SALT_POWERUP = 4;
const SALT_STEP = 5;
const SALT_WANDER = 6;

/** Deterministic value in [0, 1) mixed from integers; nothing is consumed from the state. */
function hashRoll(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Per-decision roll drawn from the state's RNG value (read, not advanced, so botThink stays
 * a pure function the debug view may call any time).
 */
function decisionRoll(state: GameState, me: PlayerState, salt: number): number {
  return hashRoll(state.rng, state.tick, me.slot, salt);
}

/** A roll that stays the same for a whole round for a given key (a cell, a mood window). */
function roundRoll(state: GameState, me: PlayerState, salt: number, key: number): number {
  return hashRoll(seedFrom(state.code), state.round, me.slot, salt, key);
}

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
function findPath(s: Search, goal: (i: number, dist: number) => boolean): number[] | null {
  const { state, start, ticksPerCell, danger, blocked } = s;
  const prev = new Int32Array(state.width * state.height).fill(-1);
  const dist = new Int32Array(state.width * state.height).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]!;
    if (goal(cur, dist[cur]!)) {
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

/** The bot only starts running at its next decision, so a slow thinker needs more room. */
function canEscapeAfterBomb(s: Search, range: number, level: BotLevelParams): boolean {
  const { state, start } = s;
  const x = start % state.width;
  const y = (start - x) / state.width;
  const danger = s.danger.slice();
  const fuse = BOMB_FUSE_TICKS - (level.thinkEvery - 1);
  for (const c of blastCells(state, x, y, range)) danger[c] = Math.min(danger[c]!, fuse);
  return findPath({ ...s, danger }, (i) => danger[i] === INF) !== null;
}

/**
 * The danger map as this bot sees it: other players' bombs are noticed only once they are
 * `noticeFire` ticks from going off. Flames, the shrinking arena and its own bombs are always seen.
 */
function perceivedDanger(state: GameState, me: PlayerState, level: BotLevelParams): Int32Array {
  if (level.noticeFire >= NEVER) return computeDanger(state);
  const bombs = state.bombs.filter((b) => b.owner === me.id || b.fuse <= level.noticeFire);
  return computeDanger({ ...state, bombs });
}

/** Neighbouring cells the bot can step into right now without walking towards fire. */
function safeSteps(s: Search): number[] {
  const { state, start } = s;
  const x = start % state.width;
  const y = (start - x) / state.width;
  const out: number[] = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const i = cellIndex(state, x + dx, y + dy);
    if (state.grid[i] === CELL_EMPTY && !s.blocked.has(i) && s.danger[i] === INF) out.push(i);
  }
  return out;
}

export type BotIntent = 'flee' | 'break' | 'attack' | 'powerup' | 'idle';

export interface BotThought {
  action: Action;
  intent: BotIntent;
  /** Cells the bot plans to walk through, last one is its target (empty = none). */
  path: number[];
}

/** Picks the bot's next action, deciding right now (tests, determinism checks). */
export function botDecide(state: GameState, botId: string): Action {
  return botThink(state, botId).action;
}

/**
 * What a bot does on this tick of the game loop: a fresh decision every `thinkEvery` ticks
 * (staggered by slot); in between it walks on to the next cell center and stops there.
 * Null keeps the held input.
 */
export function botAct(state: GameState, botId: string): Action | null {
  const me = state.players[botId];
  if (!me) return null;
  if ((state.tick + me.slot) % botParams(me.botLevel).thinkEvery === 0) return botDecide(state, botId);
  if (me.dir === DIR_NONE) return null;
  const [dx, dy] = DIR_VECTORS[me.dir]!;
  const pos = dx !== 0 ? me.x : me.y;
  const past = (pos - cellCenter(cellOf(pos))) * (dx + dy);
  return past >= 0 && past < me.speed ? 'stop' : null;
}

/** Same decision as botDecide, plus why and where it is heading (for the debug view). */
export function botThink(state: GameState, botId: string): BotThought {
  const me = state.players[botId];
  if (!me || !me.alive || state.phase !== 'playing') return { action: 'stop', intent: 'idle', path: [] };
  const level = botParams(me.botLevel);

  const here = cellIndex(state, cellOf(me.x), cellOf(me.y));
  const blocked = new Set<number>();
  for (const b of state.bombs) blocked.add(cellIndex(state, b.x, b.y));
  blocked.delete(here);
  const s: Search = {
    state,
    start: here,
    // A slow thinker covers at most one cell per decision; its plans account for that.
    ticksPerCell: Math.max(Math.ceil(SUB / me.speed) + 1, level.thinkEvery),
    danger: perceivedDanger(state, me, level),
    blocked,
    order: (me.slot + Math.floor(state.tick / 60)) % 4,
  };
  const go = (path: number[] | null, intent: BotIntent): BotThought =>
    path && path.length > 0
      ? { action: directionTo(state, here, path[0]!), intent, path }
      : { action: 'stop', intent, path: [] };
  const randomStep = (salt: number): BotThought | null => {
    const steps = safeSteps(s);
    if (steps.length === 0) return null;
    const to = steps[Math.floor(decisionRoll(state, me, salt) * steps.length)]!;
    return { action: directionTo(state, here, to), intent: 'idle', path: [to] };
  };
  const erring = decisionRoll(state, me, SALT_MISTAKE) < level.mistake;

  // 1. Standing in a blast zone: run to the nearest safe cell (a clumsy bot may pick a farther one).
  if (s.danger[here] !== INF) {
    const safe = (i: number) => s.danger[i] === INF;
    let skip = erring ? 1 + Math.floor(decisionRoll(state, me, SALT_STEP) * 3) : 0;
    const path = (skip > 0 ? findPath(s, (i) => safe(i) && skip-- <= 0) : null) ?? findPath(s, safe);
    return go(path, 'flee');
  }

  // 2. Out of danger, a weaker bot sometimes just stands there or takes a wrong turn.
  if (decisionRoll(state, me, SALT_HESITATE) < level.hesitate) return { action: 'stop', intent: 'idle', path: [] };
  if (erring) {
    const step = randomStep(SALT_STEP);
    if (step) return step;
  }

  const hunting = roundRoll(state, me, SALT_HUNT, Math.floor(state.tick / MOOD_TICKS)) < level.hunt;
  const enemies = hunting ? enemyCells(state, me) : new Set<number>();
  let active = 0;
  for (const b of state.bombs) if (b.owner === me.id) active++;
  const hasBomb = active < me.maxBombs && !state.bombs.some((b) => cellIndex(state, b.x, b.y) === here);

  // 3. Good spot and a way out: drop a bomb.
  const bombHere = hasBomb && isBombSpot(state, here, me.range, enemies) && canEscapeAfterBomb(s, me.range, level);
  if (bombHere) {
    return { action: 'bomb', intent: enemyInBlast(state, here, me.range, enemies) ? 'attack' : 'break', path: [] };
  }

  // 4. Head for a power-up or the nearest useful bombing spot, staying out of danger.
  const powerups = new Set<number>();
  for (const u of state.powerups) {
    const i = cellIndex(state, u.x, u.y);
    if (roundRoll(state, me, SALT_POWERUP, i) >= level.skipPowerup) powerups.add(i);
  }
  const roam: Search = { ...s, strict: true };
  const bombSpot = (i: number, dist: number) =>
    hasBomb && (brickNextTo(state, i) || (dist <= level.chase && enemyInBlast(state, i, me.range, enemies)));
  const target = findPath(roam, (i, dist) => i !== here && s.danger[i] === INF && (powerups.has(i) || bombSpot(i, dist)));
  if (target) {
    const end = target[target.length - 1]!;
    const intent = powerups.has(end) ? 'powerup' : enemyInBlast(state, end, me.range, enemies) ? 'attack' : 'break';
    return go(target, intent);
  }

  // 5. Nothing useful in reach: approach an enemy within chasing distance, else wait (or wander).
  if (enemies.size > 0) {
    const toEnemy = findPath(roam, (i, dist) => i !== here && dist <= level.chase && enemies.has(i));
    if (toEnemy) return go(toEnemy, 'attack');
  }
  if (decisionRoll(state, me, SALT_WANDER) < level.wander) {
    const step = randomStep(SALT_WANDER);
    if (step) return step;
  }
  return { action: 'stop', intent: 'idle', path: [] };
}
