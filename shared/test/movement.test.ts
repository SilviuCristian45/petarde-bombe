import { describe, expect, it } from 'vitest';
import {
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  MAX_RANGE,
  POWERUP_BOMB,
  POWERUP_RANGE,
  POWERUP_SPEED,
  SPEED_STEP,
  START_SPEED,
} from '../src/constants';
import { cellCenter, cellOf } from '../src/grid';
import { addBomb, makeState, run } from './helpers';

const OPEN = [
  '#######',
  '#1....#',
  '#.#.#.#',
  '#.....#',
  '#.#.#2#',
  '#######',
];

describe('movement', () => {
  it('moves by its speed every tick', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.dir = DIR_RIGHT;
    run(s, 2);
    expect(p.x).toBe(cellCenter(1) + 2 * START_SPEED);
    expect(p.y).toBe(cellCenter(1));
  });

  it('stops at the cell center in front of a wall', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.dir = DIR_LEFT;
    run(s, 3);
    expect(p.x).toBe(cellCenter(1));
  });

  it('walks up to the center when approaching a wall off-center', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.x = cellCenter(1) - 300;
    p.dir = DIR_RIGHT;
    // ahead is open: plain movement
    run(s, 1);
    expect(p.x).toBe(cellCenter(1) - 300 + START_SPEED);
    p.x = cellCenter(1) + 100;
    p.y = cellCenter(1);
    p.dir = DIR_LEFT; // (0,1) is a wall
    run(s, 1);
    expect(p.x).toBe(cellCenter(1));
  });

  it('cannot walk into bricks', () => {
    const s = makeState(['#####', '#1+.#', '#...#', '#..2#', '#####']);
    const p = s.players.p1!;
    p.dir = DIR_RIGHT;
    run(s, 5);
    expect(p.x).toBe(cellCenter(1));
  });

  it('cannot walk into a bomb but can walk off the one underfoot', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    addBomb(s, 2, 1, 'p2', 50);
    p.dir = DIR_RIGHT;
    run(s, 3);
    expect(p.x).toBe(cellCenter(1));

    s.bombs = [];
    addBomb(s, 1, 1, 'p1', 50);
    run(s, 3);
    expect(cellOf(p.x)).toBe(2);

    // Turning back while still overlapping the bomb: it cannot step onto it again.
    const before = p.x;
    p.dir = DIR_LEFT;
    run(s, 5);
    expect(p.x).toBe(before);
  });

  it('is pulled onto the lane before moving when off-center', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.y = cellCenter(1) + 150;
    p.dir = DIR_RIGHT;
    run(s, 1);
    expect(p.y).toBe(cellCenter(1));
    expect(p.x).toBe(cellCenter(1) + START_SPEED - 150);
  });

  it('slides around a corner into the open lane it leans into', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    // In cell (1,2), leaning up toward row 1; (2,2) is a pillar, (2,1) is open.
    p.x = cellCenter(1);
    p.y = cellCenter(2) - 300;
    p.dir = DIR_RIGHT;
    run(s, 6);
    expect(cellOf(p.y)).toBe(1);
    expect(p.y).toBe(cellCenter(1));
    expect(p.x).toBeGreaterThan(cellCenter(1));
  });

  it('does not slide when the neighbouring lane is blocked too', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.x = cellCenter(1);
    p.y = cellCenter(1) + 200; // leaning down: (1,2) open but (2,2) is a pillar
    s.grid[1 * s.width + 2] = 1; // wall ahead at (2,1)
    p.dir = DIR_RIGHT;
    run(s, 3);
    expect(p.x).toBe(cellCenter(1));
    expect(p.y).toBe(cellCenter(1) + 200);
  });

  it('moves vertically along columns', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.dir = DIR_DOWN;
    run(s, 20);
    expect(p.y).toBe(cellCenter(4)); // (1,5) is the border wall
  });
});

describe('power-ups', () => {
  it('applies each power-up on pickup', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    s.powerups.push({ x: 2, y: 1, type: POWERUP_BOMB }, { x: 3, y: 1, type: POWERUP_RANGE }, { x: 4, y: 1, type: POWERUP_SPEED });
    p.dir = DIR_RIGHT;
    const events = run(s, 20);
    expect(s.powerups).toHaveLength(0);
    expect(p.maxBombs).toBe(2);
    expect(p.range).toBe(3);
    expect(p.speed).toBe(START_SPEED + SPEED_STEP);
    expect(events.filter((e) => e.type === 'pickup')).toHaveLength(3);
  });

  it('caps stats at their maximum', () => {
    const s = makeState(OPEN);
    const p = s.players.p1!;
    p.range = MAX_RANGE;
    s.powerups.push({ x: 1, y: 1, type: POWERUP_RANGE });
    run(s, 1);
    expect(p.range).toBe(MAX_RANGE);
    expect(s.powerups).toHaveLength(0);
  });
});
