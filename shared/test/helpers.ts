import { BOMB_FUSE_TICKS, CELL_BRICK, CELL_EMPTY, CELL_WALL } from '../src/constants';
import { cellCenter } from '../src/grid';
import { addPlayer, createGameState } from '../src/match';
import { step } from '../src/sim';
import type { GameEvent, GameState } from '../src/types';

/**
 * Builds a playing state from ASCII: '#' wall, '+' brick, '.' empty,
 * '1'..'6' a player (id "p1".."p6", slot digit-1) standing at that cell center.
 */
export function makeState(rows: string[]): GameState {
  const height = rows.length;
  const width = rows[0]!.length;
  const state = createGameState({ code: 'TESTAA', seed: 1, width, height });
  const spots: { digit: number; x: number; y: number }[] = [];
  state.grid = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      state.grid.push(ch === '#' ? CELL_WALL : ch === '+' ? CELL_BRICK : CELL_EMPTY);
      if (ch >= '1' && ch <= '6') spots.push({ digit: Number(ch), x, y });
    });
  });
  spots.sort((a, b) => a.digit - b.digit);
  for (const s of spots) addPlayer(state, `p${s.digit}`, `P${s.digit}`);
  for (const s of spots) {
    const p = state.players[`p${s.digit}`]!;
    p.slot = s.digit - 1;
    p.alive = true;
    p.x = cellCenter(s.x);
    p.y = cellCenter(s.y);
  }
  state.phase = 'playing';
  state.round = 1;
  return state;
}

export function addBomb(state: GameState, x: number, y: number, owner: string, fuse = BOMB_FUSE_TICKS, range = 2) {
  const bomb = { id: state.nextId++, x, y, owner, fuse, range };
  state.bombs.push(bomb);
  return bomb;
}

export function run(state: GameState, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(state));
  return events;
}

export function cellType(state: GameState, x: number, y: number): number {
  return state.grid[y * state.width + x]!;
}

export function hasFlame(state: GameState, x: number, y: number): boolean {
  return state.flames.some((f) => f.x === x && f.y === y);
}
