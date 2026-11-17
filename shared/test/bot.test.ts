import { describe, expect, it } from 'vitest';
import { CELL_BRICK } from '../src/constants';
import { botDecide, botThink, computeDanger } from '../src/bot';
import { addBot, addPlayer, createGameState, sortedPlayers, startMatch } from '../src/match';
import { applyInput, step } from '../src/sim';
import { addBomb, makeState } from './helpers';

function tickWithBots(s: ReturnType<typeof makeState>, ticks: number) {
  for (let t = 0; t < ticks; t++) {
    for (const p of sortedPlayers(s)) applyInput(s, { playerId: p.id, action: botDecide(s, p.id) });
    step(s);
  }
}

describe('bots', () => {
  it('marks blast zones with time to detonation, including chains', () => {
    const s = makeState(['#######', '#1....#', '#.#.#.#', '#....2#', '#######']);
    addBomb(s, 1, 1, 'p2', 30, 2);
    addBomb(s, 3, 1, 'p2', 5, 2);
    const d = computeDanger(s);
    expect(d[1 * s.width + 1]).toBe(5); // chained by the faster bomb
    expect(d[3 * s.width + 1]).toBe(5); // arm of the slow bomb, now early
    expect(d[3 * s.width + 5]).toBeGreaterThan(1000);
  });

  it('runs out of a blast zone and survives', () => {
    const s = makeState(['#######', '#1....#', '#.#.#.#', '#....2#', '#######']);
    s.players.p1!.isBot = true;
    addBomb(s, 1, 1, 'p2', 30, 2);
    expect(botDecide(s, 'p1')).not.toBe('stop');
    for (let t = 0; t < 45; t++) {
      applyInput(s, { playerId: 'p1', action: botDecide(s, 'p1') });
      step(s);
    }
    expect(s.players.p1!.alive).toBe(true);
  });

  it('bombs a brick when it has an escape route, then survives its own bomb', () => {
    const s = makeState(['#######', '#1+...#', '#.#.#.#', '#....2#', '#######']);
    expect(botDecide(s, 'p1')).toBe('bomb');
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    step(s);
    for (let t = 0; t < 70; t++) {
      applyInput(s, { playerId: 'p1', action: botDecide(s, 'p1') });
      step(s);
    }
    expect(s.grid[1 * s.width + 2]).not.toBe(CELL_BRICK);
    expect(s.players.p1!.deaths).toBe(0);
  });

  it('does not bomb in a dead end with no way out', () => {
    const s = makeState(['#####', '#1+.#', '#+#.#', '#..2#', '#####']);
    expect(botDecide(s, 'p1')).not.toBe('bomb');
  });

  it('bombs an enemy in line of fire', () => {
    const s = makeState(['#######', '#1.2..#', '#.#.#.#', '#.....#', '#######']);
    expect(botDecide(s, 'p1')).toBe('bomb');
  });

  it('reports why it acts: flee, break, attack', () => {
    const flee = makeState(['#######', '#1....#', '#.#.#.#', '#....2#', '#######']);
    addBomb(flee, 1, 1, 'p2', 30, 2);
    const f = botThink(flee, 'p1');
    expect(f.intent).toBe('flee');
    expect(f.path.length).toBeGreaterThan(0);

    const brick = makeState(['#######', '#1+...#', '#.#.#.#', '#....2#', '#######']);
    expect(botThink(brick, 'p1')).toMatchObject({ action: 'bomb', intent: 'break' });

    const enemy = makeState(['#######', '#1.2..#', '#.#.#.#', '#.....#', '#######']);
    expect(botThink(enemy, 'p1')).toMatchObject({ action: 'bomb', intent: 'attack' });
  });

  it('a room full of bots clears bricks and finishes a whole match', () => {
    const s = createGameState({ code: 'BOTBOT', seed: 77 });
    addPlayer(s, 'host', 'Gazda');
    for (let i = 0; i < 5; i++) addBot(s, 'host', `bot${i}`);
    s.roundsTotal = 3;
    startMatch(s, 'host');
    const bricksAtStart = s.grid.filter((c) => c === CELL_BRICK).length;
    tickWithBots(s, 600);
    expect(s.grid.filter((c) => c === CELL_BRICK).length).toBeLessThan(bricksAtStart - 10);
    for (let t = 0; t < 20000 && s.phase !== 'finished'; t++) tickWithBots(s, 1);
    expect(s.phase).toBe('finished');
    const deaths = Object.values(s.players).reduce((n, p) => n + p.deaths, 0);
    expect(deaths).toBeGreaterThan(0);
  });
});
