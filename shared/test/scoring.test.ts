import { describe, expect, it } from 'vitest';
import { INTERMISSION_TICKS, POINTS_ROUND_WIN, ROUND_END_DELAY_TICKS } from '../src/constants';
import { computeStandings } from '../src/match';
import { addBomb, makeState, run } from './helpers';

const ARENA = ['#######', '#1....#', '#.#.#.#', '#....3#', '#.#.#.#', '#2....#', '#######'];

describe('scoring', () => {
  it('kill gives +1 to the bomber', () => {
    const s = makeState(ARENA);
    addBomb(s, 1, 4, 'p1', 1, 1); // reaches (1,5) where p2 stands
    const events = run(s, 1);
    expect(s.players.p2!.alive).toBe(false);
    expect(s.players.p2!.deaths).toBe(1);
    expect(s.players.p1!.kills).toBe(1);
    expect(s.players.p1!.points).toBe(1);
    expect(events).toContainEqual({ type: 'death', playerId: 'p2', killerId: 'p1', suicide: false });
  });

  it('suicide gives -1 and no kill', () => {
    const s = makeState(ARENA);
    addBomb(s, 1, 1, 'p1', 1);
    run(s, 1);
    const p1 = s.players.p1!;
    expect(p1.alive).toBe(false);
    expect(p1.points).toBe(-1);
    expect(p1.kills).toBe(0);
    expect(p1.deaths).toBe(1);
  });

  it('walking into lingering fire credits the bomb owner', () => {
    const s = makeState(ARENA);
    addBomb(s, 3, 1, 'p3', 1, 1); // burns (2,1)
    run(s, 1);
    s.players.p1!.dir = 2; // right, into the fire
    run(s, 4);
    expect(s.players.p1!.alive).toBe(false);
    expect(s.players.p3!.kills).toBe(1);
  });

  it('last player alive wins the round (+3) after a short delay', () => {
    const s = makeState(ARENA);
    s.players.p3!.alive = false;
    addBomb(s, 1, 4, 'p1', 1, 1);
    const first = run(s, 1);
    expect(first.some((e) => e.type === 'roundEnd')).toBe(false);
    expect(s.phase).toBe('playing');
    const later = run(s, ROUND_END_DELAY_TICKS - 1);
    expect(later).toContainEqual({ type: 'roundEnd', round: 1, winnerId: 'p1' });
    expect(s.phase).toBe('intermission');
    expect(s.roundWinner).toBe('p1');
    expect(s.players.p1!.wins).toBe(1);
    expect(s.players.p1!.points).toBe(POINTS_ROUND_WIN + 1);
  });

  it('is a draw when the last players die in the same tick', () => {
    const s = makeState(ARENA);
    s.players.p3!.alive = false;
    addBomb(s, 1, 3, 'p3', 1, 2); // hits (1,1) and (1,5)
    run(s, ROUND_END_DELAY_TICKS);
    expect(s.phase).toBe('intermission');
    expect(s.roundWinner).toBe('');
    expect(s.players.p1!.wins + s.players.p2!.wins).toBe(0);
    expect(s.players.p3!.kills).toBe(2);
  });

  it('a survivor who dies during the grace period turns the round into a draw', () => {
    const s = makeState(ARENA);
    s.players.p3!.alive = false;
    s.players.p2!.alive = false;
    addBomb(s, 1, 1, 'p1', 5, 1); // p1's own bomb
    run(s, ROUND_END_DELAY_TICKS);
    expect(s.roundWinner).toBe('');
    expect(s.players.p1!.wins).toBe(0);
  });

  it('starts the next round after the intermission', () => {
    const s = makeState(ARENA);
    s.players.p3!.alive = false;
    addBomb(s, 1, 4, 'p1', 1, 1);
    run(s, ROUND_END_DELAY_TICKS);
    expect(s.phase).toBe('intermission');
    const events = run(s, INTERMISSION_TICKS);
    expect(events).toContainEqual({ type: 'roundStart', round: 2 });
    expect(s.phase).toBe('playing');
    expect(s.round).toBe(2);
    expect(Object.values(s.players).every((p) => p.alive)).toBe(true);
    expect(s.players.p1!.wins).toBe(1); // match totals survive
  });

  it('lays out the next map as soon as the intermission starts, and plays on it', () => {
    const s = makeState(ARENA);
    s.players.p3!.alive = false;
    addBomb(s, 1, 4, 'p1', 1, 1);
    run(s, ROUND_END_DELAY_TICKS);
    expect(s.phase).toBe('intermission');
    expect(s.grid).not.toEqual(makeState(ARENA).grid);
    expect(s.flames).toHaveLength(0);
    expect(s.bombs).toHaveLength(0);
    const next = [...s.grid];
    run(s, INTERMISSION_TICKS);
    expect(s.phase).toBe('playing');
    expect(s.grid).toEqual(next);
  });

  it('ends the match after the last round with standings', () => {
    const s = makeState(ARENA);
    s.roundsTotal = 3;
    s.round = 3;
    s.players.p3!.alive = false;
    addBomb(s, 1, 4, 'p1', 1, 1);
    const events = run(s, ROUND_END_DELAY_TICKS);
    expect(s.phase).toBe('finished');
    const end = events.find((e) => e.type === 'matchEnd');
    expect(end).toEqual({ type: 'matchEnd', standings: ['p1', 'p3', 'p2'] });
  });

  it('ranks by points, then wins, kills, fewer deaths', () => {
    const s = makeState(ARENA);
    Object.assign(s.players.p1!, { points: 4, wins: 1, kills: 1, deaths: 2 });
    Object.assign(s.players.p2!, { points: 4, wins: 1, kills: 1, deaths: 1 });
    Object.assign(s.players.p3!, { points: 6, wins: 2, kills: 0, deaths: 0 });
    expect(computeStandings(s)).toEqual(['p3', 'p2', 'p1']);
  });
});
