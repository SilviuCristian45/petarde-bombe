import { describe, expect, it } from 'vitest';
import { CELL_BRICK, CELL_EMPTY, FLAME_TICKS, POWERUP_SPEED } from '../src/constants';
import { addBomb, cellType, hasFlame, makeState, run } from './helpers';

const ARENA = [
  '#######',
  '#.....#',
  '#.#.#.#',
  '#.....#',
  '#.#+#.#',
  '#1...2#',
  '#######',
];

describe('explosions', () => {
  it('burns a cross limited by range, stopped by walls and bricks', () => {
    const s = makeState(ARENA);
    addBomb(s, 3, 3, 'p1', 1, 2);
    const events = run(s, 1);

    const expected = [
      [3, 3],
      [3, 2],
      [3, 1],
      [4, 3],
      [5, 3],
      [2, 3],
      [1, 3],
      [3, 4], // brick: burns, stops the arm
    ];
    for (const [x, y] of expected) expect(hasFlame(s, x!, y!), `${x},${y}`).toBe(true);
    expect(s.flames).toHaveLength(expected.length);
    expect(hasFlame(s, 3, 5)).toBe(false);
    expect(s.bombs).toHaveLength(0);
    expect(cellType(s, 3, 4)).toBe(CELL_EMPTY);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(events.some((e) => e.type === 'brickDestroyed')).toBe(true);
  });

  it('does not burn through fixed walls', () => {
    const s = makeState(ARENA);
    addBomb(s, 1, 1, 'p1', 1, 5);
    run(s, 1);
    // Right arm runs along row 1, down arm along column 1; nothing behind walls.
    expect(hasFlame(s, 5, 1)).toBe(true);
    expect(hasFlame(s, 1, 5)).toBe(true);
    expect(hasFlame(s, 2, 2)).toBe(false);
  });

  it('flames last FLAME_TICKS ticks', () => {
    const s = makeState(ARENA);
    addBomb(s, 3, 3, 'p1', 1);
    run(s, FLAME_TICKS);
    expect(s.flames.length).toBeGreaterThan(0);
    run(s, 1);
    expect(s.flames).toHaveLength(0);
  });

  it('explodes only when the fuse runs out', () => {
    const s = makeState(ARENA);
    addBomb(s, 3, 3, 'p1', 5);
    run(s, 4);
    expect(s.bombs).toHaveLength(1);
    expect(s.flames).toHaveLength(0);
    run(s, 1);
    expect(s.bombs).toHaveLength(0);
  });

  it('destroys power-ups hit by a blast', () => {
    const s = makeState(ARENA);
    s.powerups.push({ x: 5, y: 3, type: POWERUP_SPEED });
    addBomb(s, 3, 3, 'p1', 1);
    run(s, 1);
    expect(s.powerups.find((u) => u.x === 5 && u.y === 3)).toBeUndefined();
  });

  it('keeps the brick standing until it is hit', () => {
    const s = makeState(ARENA);
    addBomb(s, 1, 3, 'p1', 1, 1);
    run(s, 1);
    expect(cellType(s, 3, 4)).toBe(CELL_BRICK);
  });
});

describe('bomb chains', () => {
  const CHAIN = [
    '#########',
    '#.......#',
    '#.#.#.#.#',
    '#.......#',
    '#.#.#.#1#',
    '#########',
  ];

  it('detonates bombs caught in a blast in the same tick', () => {
    const s = makeState(CHAIN);
    addBomb(s, 1, 1, 'p1', 1, 2);
    addBomb(s, 3, 1, 'p1', 40, 2);
    addBomb(s, 5, 1, 'p1', 40, 2); // reached only through the second bomb
    run(s, 1);
    expect(s.bombs).toHaveLength(0);
    expect(hasFlame(s, 7, 1)).toBe(true);
  });

  it('credits chained kills to the player who started the chain', () => {
    const s = makeState([
      '#########',
      '#.....2.#',
      '#.#.#.#.#',
      '#.......#',
      '#.#.#.#1#',
      '#########',
    ]);
    addBomb(s, 1, 1, 'p1', 1, 2);
    addBomb(s, 3, 1, 'p2', 40, 3); // p2's own bomb, set off by p1
    const events = run(s, 1);
    expect(s.players.p2!.alive).toBe(false);
    expect(events).toContainEqual({ type: 'death', playerId: 'p2', killerId: 'p1', suicide: false });
    expect(s.players.p1!.kills).toBe(1);
    expect(s.players.p1!.points).toBe(1);
    expect(s.players.p2!.points).toBe(0);
  });

  it('a bomb placed into lingering fire goes off at once', () => {
    const s = makeState(CHAIN);
    addBomb(s, 1, 1, 'p1', 1, 3);
    run(s, 1);
    addBomb(s, 3, 3, 'p1', 50, 2); // column 3 is not burning yet
    addBomb(s, 3, 1, 'p1', 50, 1); // row 1 is still on fire
    run(s, 1);
    expect(s.bombs.map((b) => [b.x, b.y])).toEqual([[3, 3]]);
  });
});
