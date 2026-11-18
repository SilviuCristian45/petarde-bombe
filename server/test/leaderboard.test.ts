import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addBot, addPlayer, createGameState, LEADERBOARD_SIZE, type GameState } from '@petarde/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Leaderboard, matchResult, migrate, MIGRATIONS, openLeaderboard, type MatchResult } from '../src/leaderboard';

interface Score {
  name: string;
  points: number;
  wins?: number;
  kills?: number;
  deaths?: number;
}

let opened: Leaderboard[] = [];
afterEach(() => {
  for (const board of opened) board.close();
  opened = [];
});

function memoryBoard(): Leaderboard {
  const board = openLeaderboard(':memory:');
  if (!board) throw new Error('node:sqlite is not available');
  opened.push(board);
  return board;
}

let minute = 0;
/** A counted match between the given humans; each call ends a minute after the previous one. */
function match(...scores: Score[]): MatchResult {
  return {
    room: 'ABCDEF',
    endedAt: new Date(Date.UTC(2026, 10, 18, 20, minute++)),
    rounds: 5,
    humans: scores.length,
    bots: 0,
    players: scores.map((s, i) => ({ playerId: `p${i}`, wins: 0, kills: 0, deaths: 0, ...s })),
  };
}

/** A finished room: humans by name (a "!" prefix = left mid-match), then bots. */
function finishedState(humans: string[], bots = 0): GameState {
  const state = createGameState({ code: 'QWERTY', seed: 1 });
  humans.forEach((name, i) => addPlayer(state, `h${i}`, name.replace(/^!/, '')));
  for (let i = 0; i < bots; i++) addBot(state, 'h0', `b${i}`);
  Object.values(state.players).forEach((p, i) => {
    p.points = 10 + i;
    p.wins = 1;
  });
  humans.forEach((name, i) => {
    if (name.startsWith('!')) state.players[`h${i}`]!.left = true;
  });
  state.phase = 'finished';
  state.round = state.roundsTotal;
  return state;
}

describe('matchResult', () => {
  it('saves humans who finished, never bots or players who left', () => {
    const result = matchResult(finishedState(['Ana', 'Ion', '!Vlad'], 2), new Date())!;
    expect(result.players.map((p) => p.name)).toEqual(['Ana', 'Ion']);
    expect(result).toMatchObject({ room: 'QWERTY', humans: 3, bots: 2, rounds: 3 });
  });

  it('only counts matches with at least two humans', () => {
    expect(matchResult(finishedState(['Ana'], 3), new Date())).toBeNull();
    // Two humans played, even if one of them left before the end.
    expect(matchResult(finishedState(['Ana', '!Ion'], 1), new Date())?.players).toHaveLength(1);
  });
});

describe('Leaderboard', () => {
  it('keeps every match and shows one row per nickname, ignoring case', () => {
    const board = memoryBoard();
    board.record(match({ name: 'Ana', points: 10 }, { name: 'Ion', points: 4 }));
    board.record(match({ name: 'ANA', points: 25, wins: 3 }, { name: 'ion', points: 2 }));
    board.record(match({ name: 'ana', points: 12 }, { name: 'Ion', points: 3 }));

    const top = board.top();
    expect(top.map((e) => [e.place, e.name, e.points])).toEqual([
      [1, 'ANA', 25],
      [2, 'Ion', 4],
    ]);
    expect(top[0]).toMatchObject({ wins: 3, rounds: 5, endedAt: '2026-11-18T20:01:00.000Z' });
  });

  it('ranks by points, then wins, then whoever got there first', () => {
    const board = memoryBoard();
    board.record(match({ name: 'Primul', points: 20, wins: 2 }, { name: 'Mic', points: 5 }));
    board.record(match({ name: 'Al doilea', points: 20, wins: 2 }, { name: 'Victorii', points: 20, wins: 4 }));
    board.record(match({ name: 'Mare', points: 30 }, { name: 'Zero', points: 0 }));
    expect(board.top().map((e) => e.name)).toEqual(['Mare', 'Victorii', 'Primul', 'Al doilea', 'Mic', 'Zero']);
  });

  it(`shows at most ${LEADERBOARD_SIZE} rows`, () => {
    const board = memoryBoard();
    for (let i = 0; i < 10; i++) board.record(match({ name: `A${i}`, points: i }, { name: `B${i}`, points: 100 + i }));
    const top = board.top();
    expect(top).toHaveLength(LEADERBOARD_SIZE);
    expect(top[0]!.name).toBe('B9');
    expect(top.at(-1)!.place).toBe(LEADERBOARD_SIZE);
  });

  it('reports a new record when someone enters the top or beats their own record', () => {
    const board = memoryBoard();
    expect(board.record(match({ name: 'Ana', points: 10 }, { name: 'Ion', points: 5 }))).toEqual([
      { playerId: 'p0', name: 'Ana', place: 1 },
      { playerId: 'p1', name: 'Ion', place: 2 },
    ]);
    // Ion beats his record; Ana does worse than hers.
    expect(board.record(match({ name: 'ana', points: 3 }, { name: 'Ion', points: 15 }))).toEqual([
      { playerId: 'p1', name: 'Ion', place: 1 },
    ]);
  });

  it('serves the top from a short cache that a saved match clears', () => {
    const board = memoryBoard();
    board.record(match({ name: 'Ana', points: 10 }, { name: 'Ion', points: 5 }));
    const first = board.top(1000);
    expect(board.top(2000)).toBe(first);
    board.record(match({ name: 'Vlad', points: 50 }, { name: 'Ion', points: 5 }));
    expect(board.top(3000)[0]!.name).toBe('Vlad');
  });
});

describe('schema', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('is created on first start and kept, with its data, on the next', () => {
    dir = mkdtempSync(join(tmpdir(), 'bombe-lb-'));
    const path = join(dir, 'nested', 'leaderboard.db');
    const board = openLeaderboard(path)!;
    board.record(match({ name: 'Ana', points: 10 }, { name: 'Ion', points: 5 }));
    board.close();

    const again = openLeaderboard(path)!;
    expect(again.top()).toHaveLength(2);
    again.close();
    const db = new DatabaseSync(path);
    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: MIGRATIONS.length });
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    db.close();
  });

  it('applies only the missing steps to an older schema', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS);
    db.exec("INSERT INTO matches (room, ended_at, rounds, humans, bots) VALUES ('AAAAAA', '2026-01-01T00:00:00.000Z', 3, 2, 0)");
    const next = [...MIGRATIONS, 'ALTER TABLE matches ADD COLUMN extra INTEGER NOT NULL DEFAULT 7'];
    expect(migrate(db, next)).toBe(next.length);
    expect(db.prepare('SELECT room, extra FROM matches').all()).toEqual([{ room: 'AAAAAA', extra: 7 }]);
    expect(migrate(db, next)).toBe(next.length); // nothing left to do
    db.close();
  });

  it('rolls back a failed step and refuses a schema newer than the code', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => migrate(db, [...MIGRATIONS, 'CREATE TABLE x (a); NOT SQL'])).toThrow();
    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: MIGRATIONS.length });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'x'").get()).toBeUndefined();
    db.prepare('UPDATE schema_version SET version = 99').run();
    expect(() => migrate(db)).toThrow(/newer/);
    db.close();
  });

  it('leaves the server without a leaderboard (not crashed) when the database cannot be opened', () => {
    dir = mkdtempSync(join(tmpdir(), 'bombe-lb-'));
    const path = join(dir, 'leaderboard.db');
    const db = new DatabaseSync(path);
    migrate(db, [...MIGRATIONS, 'SELECT 1']); // written by a newer server
    db.close();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      expect(openLeaderboard(path)).toBeNull();
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});
