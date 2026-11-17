import { describe, expect, it } from 'vitest';
import { CELL_BRICK, CELL_EMPTY, CELL_WALL, GRID_H, GRID_W, MAX_PLAYERS } from '../src/constants';
import { cellOf, spawnPoints, spawnSafeCells } from '../src/grid';
import { addPlayer, createGameState, startMatch } from '../src/match';

function started(seed: number) {
  const s = createGameState({ code: 'MAPMAP', seed });
  for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(s, `p${i}`, `P${i}`);
  startMatch(s, 'p0');
  return s;
}

describe('map', () => {
  it('is 19x13 with a wall border and pillars on even cells', () => {
    const s = started(1);
    expect(s.width).toBe(GRID_W);
    expect(s.height).toBe(GRID_H);
    expect(s.grid).toHaveLength(GRID_W * GRID_H);
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const c = s.grid[y * GRID_W + x];
        const border = x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
        const pillar = x % 2 === 0 && y % 2 === 0;
        if (border || pillar) expect(c).toBe(CELL_WALL);
        else expect([CELL_EMPTY, CELL_BRICK]).toContain(c);
      }
    }
  });

  it('has 6 distinct spawns: 4 corners and the middle of left/right sides', () => {
    expect(spawnPoints(GRID_W, GRID_H)).toEqual([
      [1, 1],
      [17, 11],
      [17, 1],
      [1, 11],
      [1, 6],
      [17, 6],
    ]);
  });

  it('keeps the area around each spawn free', () => {
    const s = started(99);
    for (const i of spawnSafeCells(GRID_W, GRID_H)) expect(s.grid[i]).toBe(CELL_EMPTY);
    for (const p of Object.values(s.players)) {
      expect(s.grid[cellOf(p.y) * GRID_W + cellOf(p.x)]).toBe(CELL_EMPTY);
    }
  });

  it('places bricks from the seed', () => {
    const a = started(5);
    const b = started(5);
    const c = started(6);
    expect(a.grid).toEqual(b.grid);
    expect(a.grid).not.toEqual(c.grid);
    expect(a.grid.filter((v) => v === CELL_BRICK).length).toBeGreaterThan(50);
  });

  it('puts every player on their own spawn', () => {
    const s = started(3);
    const cells = Object.values(s.players).map((p) => `${cellOf(p.x)},${cellOf(p.y)}`);
    expect(new Set(cells).size).toBe(MAX_PLAYERS);
  });
});
