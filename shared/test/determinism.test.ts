import { describe, expect, it } from 'vitest';
import { botDecide } from '../src/bot';
import { addBot, addPlayer, createGameState, sortedPlayers, startMatch } from '../src/match';
import { applyInput, step } from '../src/sim';
import type { Action, GameEvent } from '../src/types';

const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'stop', 'bomb'];

/** Plays a scripted match: two "humans" with a fixed input script plus two bots. */
function simulate(seed: number, ticks: number) {
  const s = createGameState({ code: 'DETERM', seed });
  addPlayer(s, 'h1', 'Ana');
  addPlayer(s, 'h2', 'Ion');
  addBot(s, 'h1', 'b1');
  addBot(s, 'h1', 'b2');
  startMatch(s, 'h1');

  const events: GameEvent[] = [];
  let script = 12345; // independent LCG for the human input script
  for (let t = 0; t < ticks; t++) {
    for (const id of ['h1', 'h2']) {
      script = (Math.imul(script, 1103515245) + 12345) >>> 0;
      if (script % 7 === 0) applyInput(s, { playerId: id, action: ACTIONS[(script >>> 8) % ACTIONS.length]! });
    }
    for (const p of sortedPlayers(s)) {
      if (p.isBot) applyInput(s, { playerId: p.id, action: botDecide(s, p.id) });
    }
    events.push(...step(s));
  }
  return { state: s, events };
}

describe('determinism', () => {
  it('same seed + same inputs = identical state and events', () => {
    const a = simulate(2026, 1500);
    const b = simulate(2026, 1500);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.events).toEqual(b.events);
    expect(a.events.length).toBeGreaterThan(0);
  });

  it('a different seed produces a different game', () => {
    const a = simulate(1, 200);
    const b = simulate(2, 200);
    expect(a.state.grid).not.toEqual(b.state.grid);
  });

  it('state survives a JSON round-trip (plain data, no classes)', () => {
    const { state } = simulate(7, 300);
    const copy = JSON.parse(JSON.stringify(state));
    expect(copy).toEqual(state);
    // Continuing both copies the same way stays in lockstep.
    for (let i = 0; i < 200; i++) {
      step(state);
      step(copy);
    }
    expect(copy).toEqual(state);
  });
});
