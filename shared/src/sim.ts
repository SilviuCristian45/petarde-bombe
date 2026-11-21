import {
  BOMB_FUSE_TICKS,
  BOMB_SLIDE_TICKS,
  CELL_BRICK,
  COUNTDOWN_TICKS,
  CURSE_TICKS,
  TICK_RATE,
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
  POWERUP_CURSE,
  POWERUP_DROP_CHANCE,
  POWERUP_KICK,
  POWERUP_PIERCE,
  POWERUP_RANGE,
  POWERUP_SHIELD,
  POWERUP_SPEED,
  POWERUP_WEIGHTS,
  ROUND_END_DELAY_TICKS,
  SHIELD_GRACE_TICKS,
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

const POWERUP_WEIGHT_TOTAL = POWERUP_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

/** The direction a player actually walks: the held one, reversed while cursed. */
export function moveDir(p: Readonly<PlayerState>): number {
  if (p.curseTicks <= 0 || p.dir === DIR_NONE) return p.dir;
  return ((p.dir + 1) % 4) + 1; // up <-> down, right <-> left
}

/** 3, 2, 1 while the round's countdown runs, then 0 ("FOC!"). */
export function countdownSeconds(roundTick: number): number {
  return Math.max(0, Math.ceil((COUNTDOWN_TICKS - roundTick) / TICK_RATE));
}

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
  // During the countdown a held direction is kept for FOC, but nobody moves and bomb presses are dropped.
  const frozen = state.roundTick <= COUNTDOWN_TICKS;

  for (const p of players) {
    if (!p.alive) continue;
    if (frozen) {
      p.bombPressed = false;
      continue;
    }
    if (p.graceTicks > 0) p.graceTicks--;
    if (p.curseTicks > 0) p.curseTicks--;
    if (p.bombPressed) {
      p.bombPressed = false;
      placeBomb(state, p, events);
    }
    const { x, y } = p;
    movePlayer(state, p);
    // A kick needs a push: standing against the petard, not just arriving next to it.
    if (p.x === x && p.y === y) kickBomb(state, p, events);
    pickUp(state, p, events);
  }

  decayFlames(state);
  slideBombs(state);
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
  state.bombs.push({
    id: state.nextId++,
    x,
    y,
    owner: p.id,
    fuse: BOMB_FUSE_TICKS,
    range: p.range,
    pierce: p.pierce,
    dir: DIR_NONE,
  });
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
  const dir = moveDir(p);
  if (dir === DIR_NONE) return;
  const [dx, dy] = DIR_VECTORS[dir]!;
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

/** A petard can slide into an empty cell with no other petard and nobody standing in it. */
function canSlideTo(state: GameState, x: number, y: number): boolean {
  if (isBlocked(state, x, y)) return false;
  for (const p of Object.values(state.players)) {
    if (p.alive && cellOf(p.x) === x && cellOf(p.y) === y) return false;
  }
  return true;
}

/** With the kick power-up, pushing against a resting petard sends it sliding the same way. */
function kickBomb(state: GameState, p: PlayerState, events: GameEvent[]): void {
  const dir = moveDir(p);
  if (!p.kick || dir === DIR_NONE) return;
  const [dx, dy] = DIR_VECTORS[dir]!;
  const cx = cellOf(p.x);
  const cy = cellOf(p.y);
  // Pressed against it: on the lane and at (or past) the cell center, facing the petard.
  if (dx !== 0 ? p.y !== cellCenter(cy) : p.x !== cellCenter(cx)) return;
  const along = dx !== 0 ? p.x - cellCenter(cx) : p.y - cellCenter(cy);
  if (along * (dx + dy) < 0) return;
  const b = bombAt(state, cx + dx, cy + dy);
  if (!b || b.dir !== DIR_NONE || !canSlideTo(state, b.x + dx, b.y + dy)) return;
  b.dir = dir;
  events.push({ type: 'kick', playerId: p.id, x: b.x, y: b.y });
}

/** Kicked petards slide on until something is in the way; they keep their fuse. */
function slideBombs(state: GameState): void {
  if (state.roundTick % BOMB_SLIDE_TICKS !== 0) return;
  for (const b of state.bombs) {
    if (b.dir === DIR_NONE) continue;
    const [dx, dy] = DIR_VECTORS[b.dir]!;
    if (canSlideTo(state, b.x + dx, b.y + dy)) {
      b.x += dx;
      b.y += dy;
    } else b.dir = DIR_NONE;
  }
}

function rollPowerup(state: GameState): number {
  let r = nextInt(state, POWERUP_WEIGHT_TOTAL);
  for (const [type, weight] of POWERUP_WEIGHTS) {
    if (r < weight) return type;
    r -= weight;
  }
  return POWERUP_BOMB;
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
  else if (type === POWERUP_KICK) p.kick = true;
  else if (type === POWERUP_SHIELD) p.shield = true;
  else if (type === POWERUP_PIERCE) p.pierce = true;
  else if (type === POWERUP_CURSE) p.curseTicks = CURSE_TICKS;
  p.pickups++;
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
  // Brick cell -> the player credited for breaking it (the first blast to reach it).
  const bricks = new Map<number, string>();
  for (let q = 0; q < queue.length; q++) {
    const { bomb, attacker } = queue[q]!;
    const cells = blastCells(state, bomb.x, bomb.y, bomb.range, bomb.pierce);
    for (const i of cells) {
      const x = i % state.width;
      const y = (i - x) / state.width;
      freshCells.add(i);
      flameAt.set(i, { x, y, ttl: FLAME_TICKS, owner: attacker });
      if (state.grid[i] === CELL_BRICK && !bricks.has(i)) bricks.set(i, attacker);
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

  for (const [i, breaker] of bricks) {
    const x = i % state.width;
    const y = (i - x) / state.width;
    state.grid[i] = CELL_EMPTY;
    const credited = state.players[breaker];
    if (credited) credited.bricks++;
    events.push({ type: 'brickDestroyed', x, y });
    if (nextRandom(state) < POWERUP_DROP_CHANCE) {
      state.powerups.push({ x, y, type: rollPowerup(state) });
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

/**
 * Everyone standing in fire or crushed by the closing arena dies at the same time.
 * A shield absorbs one blast (never the arena) and gives a moment to get out of the fire.
 */
function resolveDeaths(state: GameState, players: PlayerState[], events: GameEvent[]): void {
  const flameAt = new Map<number, FlameState>();
  for (const f of state.flames) flameAt.set(cellIndex(state, f.x, f.y), f);

  const dead: { p: PlayerState; killer: string }[] = [];
  for (const p of players) {
    if (!p.alive) continue;
    const i = cellIndex(state, cellOf(p.x), cellOf(p.y));
    if (state.grid[i] === CELL_WALL) dead.push({ p, killer: '' });
    else if (p.graceTicks <= 0) {
      const f = flameAt.get(i);
      if (!f) continue;
      if (p.shield) {
        p.shield = false;
        p.graceTicks = SHIELD_GRACE_TICKS;
        events.push({ type: 'shieldLost', playerId: p.id });
      } else dead.push({ p, killer: f.owner });
    }
  }
  for (const { p, killer } of dead) {
    p.alive = false;
    p.dir = DIR_NONE;
    p.bombPressed = false;
    p.deaths++;
    const suicide = killer === p.id;
    if (suicide) {
      p.points += POINTS_SUICIDE;
      p.suicides++;
    }
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
