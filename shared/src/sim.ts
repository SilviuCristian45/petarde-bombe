import {
  BOMB_FUSE_TICKS,
  CELL_BRICK,
  CELL_EMPTY,
  CELL_WALL,
  DIR_DOWN,
  DIR_LEFT,
  DIR_NONE,
  DIR_RIGHT,
  DIR_UP,
  DIR_VECTORS,
  FLAME_TICKS,
  INTERMISSION_TICKS,
  MAX_BOMBS,
  MAX_RANGE,
  MAX_SPEED,
  POINTS_KILL,
  POINTS_ROUND_WIN,
  POINTS_SUICIDE,
  POWERUP_BOMB,
  POWERUP_DROP_CHANCE,
  POWERUP_RANGE,
  POWERUP_SPEED,
  ROUND_END_DELAY_TICKS,
  SPEED_STEP,
} from './constants';
import { blastCells, bombAt, cellCenter, cellIndex, cellOf, isBlocked } from './grid';
import { computeStandings, prepareRound, startRound, sortedPlayers } from './match';
import { nextInt, nextRandom } from './rng';
import { isShrinkTick, shrinkOrder } from './shrink';
import type { Action, BombState, FlameState, GameEvent, GameState, PlayerInput, PlayerState } from './types';

const ACTION_DIRS: Partial<Record<Action, number>> = {
  up: DIR_UP,
  right: DIR_RIGHT,
  down: DIR_DOWN,
  left: DIR_LEFT,
  stop: DIR_NONE,
};

/**
 * Records a player's intent. Direction is held until changed; a bomb press is latched
 * and consumed on the next tick, so it survives a direction change in the same tick.
 */
export function applyInput(state: GameState, input: PlayerInput): void {
  if (state.phase !== 'playing') return;
  const p = state.players[input.playerId];
  if (!p || !p.alive) return;
  if (input.action === 'bomb') {
    p.bombPressed = true;
    return;
  }
  const dir = ACTION_DIRS[input.action];
  if (dir !== undefined) p.dir = dir;
}

/** Advances the simulation by one fixed tick. Returns what happened, for sound/effects. */
export function step(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  state.tick++;

  if (state.phase === 'intermission') {
    state.phaseTimer--;
    if (state.phaseTimer <= 0) {
      state.round++;
      startRound(state);
      events.push({ type: 'roundStart', round: state.round });
    }
    return events;
  }
  if (state.phase !== 'playing') return events;

  state.roundTick++;
  const players = sortedPlayers(state);

  for (const p of players) {
    if (!p.alive) continue;
    if (p.bombPressed) {
      p.bombPressed = false;
      placeBomb(state, p, events);
    }
    movePlayer(state, p);
    pickUp(state, p, events);
  }

  decayFlames(state);
  explodeBombs(state, events);
  shrinkArena(state, events);
  resolveDeaths(state, players, events);
  checkRoundEnd(state, events);
  return events;
}

function placeBomb(state: GameState, p: PlayerState, events: GameEvent[]): void {
  const x = cellOf(p.x);
  const y = cellOf(p.y);
  if (bombAt(state, x, y)) return;
  let active = 0;
  for (const b of state.bombs) if (b.owner === p.id) active++;
  if (active >= p.maxBombs) return;
  state.bombs.push({ id: state.nextId++, x, y, owner: p.id, fuse: BOMB_FUSE_TICKS, range: p.range });
  events.push({ type: 'bombPlaced', x, y, owner: p.id });
}

/** Moves toward `center` along one axis, never past it when the next cell is blocked. */
function advance(pos: number, center: number, d: number, speed: number, blocked: boolean): number {
  const next = pos + d * speed;
  if (!blocked) return next;
  if ((pos - center) * d >= 0) return pos;
  return (next - center) * d > 0 ? center : next;
}

/**
 * Grid movement with corner assistance: a player must be centered on the cross axis
 * to travel; when the cell ahead is open they are pulled onto the lane, and when it is
 * blocked but the neighbouring lane they lean into is open, they slide into that lane.
 */
export function movePlayer(state: GameState, p: PlayerState): void {
  if (p.dir === DIR_NONE) return;
  const [dx, dy] = DIR_VECTORS[p.dir]!;
  const horizontal = dx !== 0;
  const d = horizontal ? dx : dy;
  const cx = cellOf(p.x);
  const cy = cellOf(p.y);
  // "along" is the travel axis, "cross" the perpendicular one.
  const along = horizontal ? p.x : p.y;
  const cross = horizontal ? p.y : p.x;
  const alongCenter = cellCenter(horizontal ? cx : cy);
  const crossCenter = cellCenter(horizontal ? cy : cx);
  const blockedAt = (a: number, c: number) => (horizontal ? isBlocked(state, a, c) : isBlocked(state, c, a));
  const alongCell = horizontal ? cx : cy;
  const crossCell = horizontal ? cy : cx;
  const ahead = alongCell + d;
  const blockedAhead = blockedAt(ahead, crossCell);

  let speed = p.speed;
  let newCross = cross;
  const off = cross - crossCenter;
  if (off !== 0) {
    if (!blockedAhead) {
      const s = Math.min(speed, Math.abs(off));
      newCross -= Math.sign(off) * s;
      speed -= s;
    } else {
      const side = Math.sign(off);
      if (!blockedAt(alongCell, crossCell + side) && !blockedAt(ahead, crossCell + side)) {
        newCross += side * speed;
        speed = 0;
      }
    }
  }
  const newAlong = speed > 0 ? advance(along, alongCenter, d, speed, blockedAhead) : along;
  if (horizontal) {
    p.x = newAlong;
    p.y = newCross;
  } else {
    p.y = newAlong;
    p.x = newCross;
  }
}

function pickUp(state: GameState, p: PlayerState, events: GameEvent[]): void {
  const x = cellOf(p.x);
  const y = cellOf(p.y);
  const i = state.powerups.findIndex((u) => u.x === x && u.y === y);
  if (i < 0) return;
  const type = state.powerups[i]!.type;
  state.powerups.splice(i, 1);
  if (type === POWERUP_BOMB) p.maxBombs = Math.min(MAX_BOMBS, p.maxBombs + 1);
  else if (type === POWERUP_RANGE) p.range = Math.min(MAX_RANGE, p.range + 1);
  else if (type === POWERUP_SPEED) p.speed = Math.min(MAX_SPEED, p.speed + SPEED_STEP);
  events.push({ type: 'pickup', playerId: p.id, powerup: type });
}

function decayFlames(state: GameState): void {
  for (const f of state.flames) f.ttl--;
  state.flames = state.flames.filter((f) => f.ttl > 0);
}

/**
 * Detonates due bombs and everything they chain into. Chained bombs credit the player
 * whose bomb started the chain. Bricks break and power-ups spawn after all blasts.
 */
export function explodeBombs(state: GameState, events: GameEvent[]): void {
  for (const b of state.bombs) b.fuse--;

  const flameAt = new Map<number, FlameState>();
  for (const f of state.flames) flameAt.set(cellIndex(state, f.x, f.y), f);

  const queue: { bomb: BombState; attacker: string }[] = [];
  const exploded = new Set<number>();
  for (const b of state.bombs) {
    const burning = flameAt.get(cellIndex(state, b.x, b.y));
    if (b.fuse <= 0 || burning) {
      exploded.add(b.id);
      queue.push({ bomb: b, attacker: burning && b.fuse > 0 ? burning.owner : b.owner });
    }
  }
  if (queue.length === 0) return;

  const freshCells = new Set<number>();
  const bricks = new Set<number>();
  for (let q = 0; q < queue.length; q++) {
    const { bomb, attacker } = queue[q]!;
    const cells = blastCells(state, bomb.x, bomb.y, bomb.range);
    for (const i of cells) {
      const x = i % state.width;
      const y = (i - x) / state.width;
      freshCells.add(i);
      flameAt.set(i, { x, y, ttl: FLAME_TICKS, owner: attacker });
      if (state.grid[i] === CELL_BRICK) bricks.add(i);
      const other = bombAt(state, x, y);
      if (other && !exploded.has(other.id)) {
        exploded.add(other.id);
        queue.push({ bomb: other, attacker });
      }
    }
    events.push({ type: 'explosion', x: bomb.x, y: bomb.y, owner: attacker, cells });
  }

  state.bombs = state.bombs.filter((b) => !exploded.has(b.id));
  state.flames = [...flameAt.values()];
  state.powerups = state.powerups.filter((u) => !freshCells.has(cellIndex(state, u.x, u.y)));

  for (const i of bricks) {
    const x = i % state.width;
    const y = (i - x) / state.width;
    state.grid[i] = CELL_EMPTY;
    events.push({ type: 'brickDestroyed', x, y });
    if (nextRandom(state) < POWERUP_DROP_CHANCE) {
      state.powerups.push({ x, y, type: 1 + nextInt(state, 3) });
    }
  }
}

/** After the shrink delay, walls in one more cell of the spiral every interval. */
export function shrinkArena(state: GameState, events: GameEvent[]): void {
  if (!isShrinkTick(state.roundTick)) return;
  const order = shrinkOrder(state.width, state.height);
  while (state.shrinkIndex < order.length && state.grid[order[state.shrinkIndex]!] === CELL_WALL) {
    state.shrinkIndex++;
  }
  if (state.shrinkIndex >= order.length) return;
  const i = order[state.shrinkIndex++]!;
  const x = i % state.width;
  const y = (i - x) / state.width;
  state.grid[i] = CELL_WALL;
  state.bombs = state.bombs.filter((b) => b.x !== x || b.y !== y);
  state.flames = state.flames.filter((f) => f.x !== x || f.y !== y);
  state.powerups = state.powerups.filter((u) => u.x !== x || u.y !== y);
  events.push({ type: 'shrink', x, y });
}

/** Everyone standing in fire or crushed by the closing arena dies at the same time. */
function resolveDeaths(state: GameState, players: PlayerState[], events: GameEvent[]): void {
  const flameAt = new Map<number, FlameState>();
  for (const f of state.flames) flameAt.set(cellIndex(state, f.x, f.y), f);

  const dead: { p: PlayerState; killer: string }[] = [];
  for (const p of players) {
    if (!p.alive) continue;
    const i = cellIndex(state, cellOf(p.x), cellOf(p.y));
    if (state.grid[i] === CELL_WALL) dead.push({ p, killer: '' });
    else {
      const f = flameAt.get(i);
      if (f) dead.push({ p, killer: f.owner });
    }
  }
  for (const { p, killer } of dead) {
    p.alive = false;
    p.dir = DIR_NONE;
    p.bombPressed = false;
    p.deaths++;
    const suicide = killer === p.id;
    if (suicide) p.points += POINTS_SUICIDE;
    else {
      const k = killer ? state.players[killer] : undefined;
      if (k) {
        k.kills++;
        k.points += POINTS_KILL;
      }
    }
    events.push({ type: 'death', playerId: p.id, killerId: killer, suicide });
  }
}

/** The last one standing wins; if nobody survives the grace period, it is a draw. */
function checkRoundEnd(state: GameState, events: GameEvent[]): void {
  const alive = Object.values(state.players).filter((p) => p.alive);
  if (state.endingTimer === 0) {
    if (alive.length > 1) return;
    state.endingTimer = ROUND_END_DELAY_TICKS;
  }
  state.endingTimer--;
  if (state.endingTimer > 0) return;

  const winner = alive.length === 1 ? alive[0]! : undefined;
  state.roundWinner = winner ? winner.id : '';
  if (winner) {
    winner.wins++;
    winner.points += POINTS_ROUND_WIN;
  }
  events.push({ type: 'roundEnd', round: state.round, winnerId: state.roundWinner });

  if (state.round >= state.roundsTotal) {
    state.phase = 'finished';
    events.push({ type: 'matchEnd', standings: computeStandings(state) });
  } else {
    state.phase = 'intermission';
    state.phaseTimer = INTERMISSION_TICKS;
    prepareRound(state);
  }
}
