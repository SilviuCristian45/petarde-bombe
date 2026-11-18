import { TICK_RATE } from './constants';
import { botDecide } from './bot';
import { onlyBotsAlive, sortedPlayers } from './match';
import { applyInput, step } from './sim';
import type { GameEvent, GameState, PlayerInput } from './types';

// One tick exactly as every host of the simulation runs it (the browser's LocalTransport
// and the Colyseus room), so local and online games behave the same.

/** The shrinking arena ends every round well before this. */
const MAX_SKIP_TICKS = 10 * 60 * TICK_RATE;

/** Applies queued inputs, lets the bots decide, then advances one tick. */
export function runTick(state: GameState, inputs: readonly PlayerInput[]): GameEvent[] {
  for (const input of inputs) applyInput(state, input);
  for (const p of sortedPlayers(state)) {
    if (p.isBot && p.alive) applyInput(state, { playerId: p.id, action: botDecide(state, p.id) });
  }
  return step(state);
}

/**
 * Fast-forwards a round that only bots are still playing (no-op otherwise). The skipped
 * effects would all fire at once, so only the outcome (roundEnd/matchEnd) is returned.
 */
export function skipBotRound(state: GameState): GameEvent[] {
  const outcome: GameEvent[] = [];
  if (!onlyBotsAlive(state)) return outcome;
  for (let i = 0; i < MAX_SKIP_TICKS && state.phase === 'playing'; i++) {
    for (const e of runTick(state, [])) if (e.type === 'roundEnd' || e.type === 'matchEnd') outcome.push(e);
  }
  return outcome;
}
