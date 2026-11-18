import { describe, expect, it } from 'vitest';
import { BOT_EASY, BOT_HARD, BOT_MEDIUM } from '../src/constants';
import { addBot, addPlayer, createGameState, leavePlayer, setDefaultBotLevel, startMatch } from '../src/match';
import { runTick } from '../src/runner';

interface Tally {
  wins: number;
  suicides: number;
  rounds: number; // bot-rounds played at this level
}

/**
 * Bots only, through the real game loop (reaction times included). The seats cycle through
 * `levels`, rotated by the seed so every level gets every spawn corner. Returns totals per level.
 */
function playMatches(levels: number[], bots: number, seeds: number, rounds = 3): Record<number, Tally> {
  const total: Record<number, Tally> = {};
  for (const level of levels) total[level] = { wins: 0, suicides: 0, rounds: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const s = createGameState({ code: 'BALANS', seed });
    addPlayer(s, 'host', 'Gazda');
    for (let i = 0; i < bots; i++) {
      setDefaultBotLevel(s, 'host', levels[(i + seed) % levels.length]!);
      addBot(s, 'host', `bot${i}`);
    }
    s.roundsTotal = rounds;
    startMatch(s, 'host');
    leavePlayer(s, 'host'); // the host only opened the room
    for (let t = 0; t < 40000 && s.phase !== 'finished'; t++) runTick(s, []);
    expect(s.phase).toBe('finished');
    for (const p of Object.values(s.players)) {
      if (!p.isBot) continue;
      const t = total[p.botLevel]!;
      t.wins += p.wins;
      t.suicides += p.suicides;
      t.rounds += rounds;
    }
  }
  return total;
}

describe('bot levels', () => {
  it('hard bots win clearly more rounds than medium ones, medium than easy (all three together)', () => {
    const t = playMatches([BOT_EASY, BOT_MEDIUM, BOT_HARD], 5, 12, 5);
    expect(t[BOT_HARD]!.wins).toBeGreaterThan(2 * t[BOT_MEDIUM]!.wins);
    expect(t[BOT_MEDIUM]!.wins).toBeGreaterThan(t[BOT_EASY]!.wins);
  }, 60_000);

  it('head to head: hard beats medium, medium beats easy', () => {
    const hm = playMatches([BOT_MEDIUM, BOT_HARD], 4, 10);
    expect(hm[BOT_HARD]!.wins).toBeGreaterThan(2 * hm[BOT_MEDIUM]!.wins);
    const me = playMatches([BOT_EASY, BOT_MEDIUM], 4, 10);
    expect(me[BOT_MEDIUM]!.wins).toBeGreaterThan(2 * me[BOT_EASY]!.wins);
  }, 60_000);

  it('every level still runs from explosions: suicides stay the exception', () => {
    const t = playMatches([BOT_EASY, BOT_MEDIUM, BOT_HARD], 3, 9);
    for (const level of [BOT_EASY, BOT_MEDIUM, BOT_HARD]) {
      expect(t[level]!.suicides / t[level]!.rounds).toBeLessThan(0.4);
    }
  }, 60_000);
});
