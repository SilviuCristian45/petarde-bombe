import { describe, expect, it } from 'vitest';
import { DIR_NONE, DIR_RIGHT, START_SPEED } from '../src/constants';
import { cellCenter } from '../src/grid';
import { applyInput } from '../src/sim';
import { makeState, run } from './helpers';

const OPEN = ['#######', '#1....#', '#.#.#.#', '#....2#', '#######'];

describe('input', () => {
  it('keeps a bomb press made in the same tick as a direction change', () => {
    const s = makeState(OPEN);
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    applyInput(s, { playerId: 'p1', action: 'right' });
    run(s, 1);
    const p = s.players.p1!;
    expect(s.bombs).toEqual([expect.objectContaining({ x: 1, y: 1, owner: 'p1' })]);
    expect(p.x).toBe(cellCenter(1) + START_SPEED);
  });

  it('keeps the bomb press regardless of order, even if followed by stop', () => {
    const s = makeState(OPEN);
    applyInput(s, { playerId: 'p1', action: 'right' });
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    applyInput(s, { playerId: 'p1', action: 'stop' });
    run(s, 1);
    expect(s.bombs).toHaveLength(1);
    expect(s.players.p1!.dir).toBe(DIR_NONE);
    expect(s.players.p1!.x).toBe(cellCenter(1));
  });

  it('places the bomb before moving, on the cell the player was in', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.x = cellCenter(1) + 450; // about to cross into (2,1)
    applyInput(s, { playerId: 'p1', action: 'right' });
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    run(s, 1);
    expect(s.bombs[0]).toMatchObject({ x: 1, y: 1 });
  });

  it('consumes the press: one bomb per press, flag cleared after the tick', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.maxBombs = 3;
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    run(s, 1);
    expect(p.bombPressed).toBe(false);
    run(s, 5);
    expect(s.bombs).toHaveLength(1);
  });

  it('holds the direction until it changes', () => {
    const s = makeState(OPEN);
    applyInput(s, { playerId: 'p1', action: 'right' });
    run(s, 3);
    expect(s.players.p1!.dir).toBe(DIR_RIGHT);
    expect(s.players.p1!.x).toBe(cellCenter(1) + 3 * START_SPEED);
  });

  it('respects the bomb limit and one bomb per cell', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    run(s, 1);
    applyInput(s, { playerId: 'p1', action: 'bomb' }); // same cell
    run(s, 1);
    expect(s.bombs).toHaveLength(1);
    p.maxBombs = 2;
    applyInput(s, { playerId: 'p1', action: 'bomb' }); // still same cell
    run(s, 1);
    expect(s.bombs).toHaveLength(1);
    applyInput(s, { playerId: 'p1', action: 'right' });
    run(s, 4);
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    applyInput(s, { playerId: 'p1', action: 'stop' });
    run(s, 1);
    expect(s.bombs).toHaveLength(2);
  });

  it('ignores input from dead or unknown players and outside of play', () => {
    const s = makeState(OPEN);
    s.players.p1!.alive = false;
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    applyInput(s, { playerId: 'ghost', action: 'right' });
    run(s, 1);
    expect(s.bombs).toHaveLength(0);
    s.phase = 'intermission';
    applyInput(s, { playerId: 'p2', action: 'left' });
    expect(s.players.p2!.dir).toBe(DIR_NONE);
  });
});
