import { describe, expect, it } from 'vitest';
import { COUNTDOWN_TICKS, INTERMISSION_TICKS, SHRINK_START_TICKS, TICK_RATE } from '../src/constants';
import { addBot, addPlayer, createGameState, startMatch } from '../src/match';
import { applyInput, countdownSeconds } from '../src/sim';
import { makeState, run } from './helpers';

const ARENA = ['#######', '#1....#', '#.#.#.#', '#....2#', '#######'];

describe('round countdown', () => {
  it('counts 3, 2, 1, then FOC', () => {
    expect(countdownSeconds(0)).toBe(3);
    expect(countdownSeconds(TICK_RATE - 1)).toBe(3);
    expect(countdownSeconds(TICK_RATE)).toBe(2);
    expect(countdownSeconds(2 * TICK_RATE)).toBe(1);
    expect(countdownSeconds(COUNTDOWN_TICKS - 1)).toBe(1);
    expect(countdownSeconds(COUNTDOWN_TICKS)).toBe(0);
  });

  it('keeps everyone in place and drops bomb presses until FOC', () => {
    const s = makeState(ARENA);
    s.roundTick = 0;
    const p1 = s.players.p1!;
    const startX = p1.x;
    applyInput(s, { playerId: 'p1', action: 'right' });
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    run(s, COUNTDOWN_TICKS);
    expect(p1.x).toBe(startX);
    expect(s.bombs).toEqual([]);
    expect(p1.bombPressed).toBe(false);

    // The direction held during the countdown applies from the first tick after FOC.
    run(s, 1);
    expect(p1.x).toBeGreaterThan(startX);
    applyInput(s, { playerId: 'p1', action: 'bomb' });
    run(s, 1);
    expect(s.bombs).toHaveLength(1);
  });

  it('runs again at the start of every round, bots included', () => {
    const s = createGameState({ code: 'TESTAA', seed: 'countdown' });
    addPlayer(s, 'h', 'Ana');
    addBot(s, 'h', 'bot1');
    startMatch(s, 'h');
    const spawn = Object.values(s.players).map((p) => [p.x, p.y]);
    for (let i = 0; i < COUNTDOWN_TICKS; i++) {
      for (const p of Object.values(s.players)) applyInput(s, { playerId: p.id, action: 'down' });
      run(s, 1);
    }
    expect(Object.values(s.players).map((p) => [p.x, p.y])).toEqual(spawn);

    // Next round: back to 3.
    s.players.h!.alive = false;
    while (s.phase === 'playing') run(s, 1);
    run(s, INTERMISSION_TICKS);
    expect(s.phase).toBe('playing');
    expect(countdownSeconds(s.roundTick)).toBe(3);
  });

  it('leaves the full two minutes of fighting before the arena shrinks', () => {
    expect(SHRINK_START_TICKS - COUNTDOWN_TICKS).toBe(120 * TICK_RATE);
  });
});
