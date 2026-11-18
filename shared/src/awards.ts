import { sortedPlayers } from './match';
import type { GameState, PlayerState } from './types';

// Light-hearted titles shown under the podium at the end of a match. Names and wording live
// in the client; here only who earned what.

export type AwardId = 'artificier' | 'kamikaze' | 'supravietuitor' | 'spargator' | 'colectionar';

export interface Award {
  id: AwardId;
  /** Everyone tied for it, in slot order. */
  playerIds: string[];
  value: number;
}

interface Rule {
  id: AwardId;
  stat: (p: PlayerState) => number;
  most: boolean;
  /** Players considered; defaults to everyone in the match. */
  eligible?: (p: PlayerState) => boolean;
}

const RULES: readonly Rule[] = [
  { id: 'artificier', stat: (p) => p.kills, most: true },
  { id: 'kamikaze', stat: (p) => p.suicides, most: true },
  // Leaving stops the dying; only those who played to the end count.
  { id: 'supravietuitor', stat: (p) => p.deaths, most: false, eligible: (p) => !p.left },
  { id: 'spargator', stat: (p) => p.bricks, most: true },
  { id: 'colectionar', stat: (p) => p.pickups, most: true },
];

/**
 * The awards that apply: a "most" award needs a value above zero, and none is given when
 * every eligible player ties (it would single nobody out).
 */
export function computeAwards(state: Readonly<GameState>): Award[] {
  const awards: Award[] = [];
  const players = sortedPlayers(state as GameState);
  for (const rule of RULES) {
    const pool = players.filter(rule.eligible ?? (() => true));
    if (pool.length < 2) continue;
    const values = pool.map(rule.stat);
    const best = rule.most ? Math.max(...values) : Math.min(...values);
    if (rule.most && best <= 0) continue;
    const winners = pool.filter((p) => rule.stat(p) === best);
    if (winners.length === pool.length) continue;
    awards.push({ id: rule.id, playerIds: winners.map((p) => p.id), value: best });
  }
  return awards;
}
