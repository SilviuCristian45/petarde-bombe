import { describe, expect, it } from 'vitest';
import { CELL_BRICK, CELL_EMPTY, POWERUP_RANGE } from '../src/constants';
import { computeAwards } from '../src/awards';
import { addPlayer, createGameState, startMatch } from '../src/match';
import { addBomb, cellType, makeState, run } from './helpers';

const ARENA = ['#######', '#1.+..#', '#.#.#.#', '#+...3#', '#.#.#.#', '#2....#', '#######'];

describe('match statistics', () => {
  it('counts suicides, broken bricks and power-ups without touching the score rules', () => {
    const s = makeState(ARENA);
    addBomb(s, 4, 1, 'p3', 1, 1); // breaks the brick at (3,1)
    run(s, 1);
    expect(cellType(s, 3, 1)).toBe(CELL_EMPTY);
    expect(s.players.p3!).toMatchObject({ bricks: 1, alive: true });

    addBomb(s, 5, 2, 'p3', 1, 1); // reaches p3 at (5,3)
    run(s, 1);
    expect(s.players.p3!).toMatchObject({ suicides: 1, deaths: 1, points: -1, kills: 0 });

    addBomb(s, 1, 4, 'p1', 1, 1); // reaches p2 at (1,5) and the brick at (1,3)
    run(s, 1);
    expect(s.players.p1!).toMatchObject({ kills: 1, bricks: 1, suicides: 0, points: 1 });
    expect(s.players.p2!).toMatchObject({ suicides: 0, deaths: 1 });
  });

  it('credits a chained brick to whoever lit the chain', () => {
    const s = makeState(['#######', '#1....#', '#.....#', '#....+#', '#2....#', '#######']);
    addBomb(s, 3, 3, 'p1', 1, 1);
    addBomb(s, 4, 3, 'p2', 40, 1); // set off by p1's blast, reaches the brick at (5,3)
    expect(cellType(s, 5, 3)).toBe(CELL_BRICK);
    run(s, 1);
    expect(cellType(s, 5, 3)).toBe(CELL_EMPTY);
    expect(s.players.p1!.bricks).toBe(1);
    expect(s.players.p2!.bricks).toBe(0);
  });

  it('counts power-ups picked up', () => {
    const s = makeState(ARENA);
    s.powerups.push({ x: 2, y: 1, type: POWERUP_RANGE });
    s.players.p1!.dir = 2;
    run(s, 5);
    expect(s.players.p1!.pickups).toBe(1);
    expect(s.players.p1!.range).toBe(3);
  });

  it('starts every match from zero', () => {
    const s = createGameState({ code: 'TESTAA', seed: 1 });
    addPlayer(s, 'a', 'Ana');
    addPlayer(s, 'b', 'Ion');
    Object.assign(s.players.a!, { suicides: 2, bricks: 9, pickups: 4 });
    startMatch(s, 'a');
    expect(s.players.a!).toMatchObject({ suicides: 0, bricks: 0, pickups: 0 });
  });
});

describe('awards', () => {
  function standings(stats: Record<string, Partial<{ kills: number; suicides: number; deaths: number; bricks: number; pickups: number; left: boolean }>>) {
    const s = createGameState({ code: 'TESTAA', seed: 1 });
    for (const [id, values] of Object.entries(stats)) {
      addPlayer(s, id, id);
      Object.assign(s.players[id]!, values);
    }
    return s;
  }

  it('gives each award to the leader, ties shared', () => {
    const s = standings({
      ana: { kills: 3, suicides: 0, deaths: 1, bricks: 10, pickups: 2 },
      ion: { kills: 1, suicides: 2, deaths: 3, bricks: 10, pickups: 5 },
      eva: { kills: 0, suicides: 1, deaths: 2, bricks: 4, pickups: 0 },
    });
    expect(computeAwards(s)).toEqual([
      { id: 'artificier', playerIds: ['ana'], value: 3 },
      { id: 'kamikaze', playerIds: ['ion'], value: 2 },
      { id: 'supravietuitor', playerIds: ['ana'], value: 1 },
      { id: 'spargator', playerIds: ['ana', 'ion'], value: 10 },
      { id: 'colectionar', playerIds: ['ion'], value: 5 },
    ]);
  });

  it('skips awards nobody earned or everybody shares', () => {
    const s = standings({
      ana: { kills: 0, suicides: 0, deaths: 2, bricks: 3, pickups: 0 },
      ion: { kills: 0, suicides: 0, deaths: 2, bricks: 3, pickups: 0 },
    });
    expect(computeAwards(s)).toEqual([]);
  });

  it('leaves players who left out of "Supraviețuitorul"', () => {
    const s = standings({
      ana: { deaths: 2 },
      ion: { deaths: 3 },
      eva: { deaths: 0, left: true },
    });
    expect(computeAwards(s)).toEqual([{ id: 'supravietuitor', playerIds: ['ana'], value: 2 }]);
  });
});
