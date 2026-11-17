import { describe, expect, it } from 'vitest';
import { CELL_WALL, GRID_H, GRID_W, SHRINK_INTERVAL_TICKS, SHRINK_START_TICKS } from '../src/constants';
import { addPlayer, createGameState, startMatch } from '../src/match';
import { shrinkOrder } from '../src/shrink';
import { shrinkArena } from '../src/sim';
import type { GameEvent } from '../src/types';
import { run } from './helpers';

function match() {
  const s = createGameState({ code: 'SHRINK', seed: 42 });
  addPlayer(s, 'a', 'A');
  addPlayer(s, 'b', 'B');
  addPlayer(s, 'c', 'C');
  startMatch(s, 'a');
  return s;
}

const shrinks = (events: GameEvent[]) =>
  events.filter((e): e is Extract<GameEvent, { type: 'shrink' }> => e.type === 'shrink').map((e) => [e.x, e.y]);

describe('shrinking arena', () => {
  it('covers every interior cell exactly once, outer ring first', () => {
    const order = shrinkOrder(GRID_W, GRID_H);
    expect(order).toHaveLength((GRID_W - 2) * (GRID_H - 2));
    expect(new Set(order).size).toBe(order.length);
    expect(order[0]).toBe(1 * GRID_W + 1);
    expect(order[GRID_W - 3]).toBe(1 * GRID_W + GRID_W - 2); // top-right interior corner
  });

  it('does nothing before two minutes', () => {
    const s = match();
    s.roundTick = SHRINK_START_TICKS - 2;
    const events = run(s, 1);
    expect(shrinks(events)).toEqual([]);
  });

  it('walls in one cell per interval from the top-left corner and crushes players', () => {
    const s = match();
    s.roundTick = SHRINK_START_TICKS - 1;
    const events = run(s, 1);
    expect(shrinks(events)).toEqual([[1, 1]]);
    expect(s.grid[1 * s.width + 1]).toBe(CELL_WALL);
    // Player "a" spawned on (1,1).
    expect(s.players.a!.alive).toBe(false);
    expect(events).toContainEqual({ type: 'death', playerId: 'a', killerId: '', suicide: false });
    expect(s.players.a!.points).toBe(0);

    expect(shrinks(run(s, SHRINK_INTERVAL_TICKS - 1))).toEqual([]);
    expect(shrinks(run(s, 1))).toEqual([[2, 1]]);
  });

  it('skips cells that are already walls without losing a beat', () => {
    const s = match();
    const ring = 2 * (GRID_W - 2) + 2 * (GRID_H - 2) - 4;
    s.shrinkIndex = ring; // next is (2,2), a fixed pillar
    s.roundTick = SHRINK_START_TICKS - 1;
    expect(shrinks(run(s, 1))).toEqual([[3, 2]]);
  });

  it('removes bombs and power-ups on cells it closes', () => {
    const s = match();
    s.bombs.push({ id: 99, x: 1, y: 1, owner: 'b', fuse: 30, range: 2 });
    s.powerups.push({ x: 2, y: 1, type: 1 });
    s.roundTick = SHRINK_START_TICKS - 1;
    run(s, 1 + SHRINK_INTERVAL_TICKS);
    expect(s.bombs.find((b) => b.id === 99)).toBeUndefined();
    expect(s.powerups).toHaveLength(0);
  });

  it('eventually closes the whole interior', () => {
    const s = match();
    const order = shrinkOrder(s.width, s.height);
    for (let k = 0; k <= order.length; k++) {
      s.roundTick = SHRINK_START_TICKS + k * SHRINK_INTERVAL_TICKS;
      shrinkArena(s, []);
    }
    expect(order.every((i) => s.grid[i] === CELL_WALL)).toBe(true);
  });

  it('ends a round of idle players', () => {
    const s = match();
    s.roundTick = SHRINK_START_TICKS - 1;
    const events = run(s, (GRID_W - 2) * (GRID_H - 2) * SHRINK_INTERVAL_TICKS);
    expect(events.some((e) => e.type === 'roundEnd')).toBe(true);
  });
});
