import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  LEADERBOARD_MIN_HUMANS,
  LEADERBOARD_SIZE,
  type GameState,
  type LeaderboardEntry,
  type NewRecord,
} from '@petarde/shared';

// All-time leaderboard in SQLite (node:sqlite, built into Node 22: nothing native to bundle).
// Every finished online match is kept (matches + results); the leaderboard is a query over them:
// each nickname's best match, ranked by points, then wins, then whoever got there first.

/** Server-side cache of the top rows; a saved match clears it at once. */
const TOP_CACHE_MS = 30_000;

/**
 * Schema steps, applied in order at startup; schema_version holds how many have run.
 * Never edit a released step: append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE matches (
     id INTEGER PRIMARY KEY,
     room TEXT NOT NULL,
     ended_at TEXT NOT NULL, -- ISO 8601, UTC
     rounds INTEGER NOT NULL,
     humans INTEGER NOT NULL,
     bots INTEGER NOT NULL
   );
   CREATE TABLE results (
     id INTEGER PRIMARY KEY,
     match_id INTEGER NOT NULL REFERENCES matches(id),
     name TEXT NOT NULL,
     name_key TEXT NOT NULL, -- lowercased nickname: one leaderboard row per name_key
     points INTEGER NOT NULL,
     wins INTEGER NOT NULL,
     kills INTEGER NOT NULL,
     deaths INTEGER NOT NULL
   );
   CREATE INDEX results_name_key ON results(name_key);`,
];

/** What a finished match leaves in the database. */
export interface MatchResult {
  room: string;
  endedAt: Date;
  rounds: number;
  /** Every human who played, including those who left. */
  humans: number;
  bots: number;
  /** Humans who were still in the room at the end. */
  players: { playerId: string; name: string; points: number; wins: number; kills: number; deaths: number }[];
}

/** The result of a finished match, or null if it does not count (fewer than two humans). */
export function matchResult(state: Readonly<GameState>, endedAt: Date): MatchResult | null {
  const all = Object.values(state.players);
  const humans = all.filter((p) => !p.isBot);
  if (humans.length < LEADERBOARD_MIN_HUMANS) return null;
  const players = humans
    .filter((p) => !p.left)
    .map((p) => ({ playerId: p.id, name: p.name, points: p.points, wins: p.wins, kills: p.kills, deaths: p.deaths }));
  if (players.length === 0) return null;
  return { room: state.code, endedAt, rounds: state.roundsTotal, humans: humans.length, bots: all.length - humans.length, players };
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Brings the schema up to date, one transaction per step. Throws on a schema newer than this code. */
export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  let row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    row = { version: 0 };
  }
  if (row.version > migrations.length) {
    throw new Error(`schema ${row.version} is newer than this server (${migrations.length})`);
  }
  for (let v = row.version; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]!);
      db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
    });
  }
  return migrations.length;
}

function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Each nickname's best result with its place; the ORDER BY clauses are the ranking rule. */
const BEST = `
  WITH best AS (
    SELECT r.id, r.name, r.name_key, r.points, r.wins, r.kills, r.deaths, m.rounds, m.ended_at,
           ROW_NUMBER() OVER (PARTITION BY r.name_key ORDER BY r.points DESC, r.wins DESC, m.ended_at, r.id) AS nth
    FROM results r JOIN matches m ON m.id = r.match_id
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY points DESC, wins DESC, ended_at, id) AS place
    FROM best WHERE nth = 1
  )`;

export class Leaderboard {
  private cache: { expires: number; rows: LeaderboardEntry[] } | null = null;

  constructor(private readonly db: DatabaseSync) {
    migrate(db);
  }

  /**
   * Saves a finished match. Returns the players whose result is now their best and either
   * makes the top LEADERBOARD_SIZE or beats a record they already had.
   */
  record(result: MatchResult): NewRecord[] {
    const keys = [...new Set(result.players.map((p) => nameKey(p.name)))];
    const known = this.db.prepare('SELECT 1 FROM results WHERE name_key = ? LIMIT 1');
    const hadRecord = new Set(keys.filter((key) => known.get(key)));

    const inserted = new Map<number, (typeof result.players)[number]>();
    transaction(this.db, () => {
      const match = this.db
        .prepare('INSERT INTO matches (room, ended_at, rounds, humans, bots) VALUES (?, ?, ?, ?, ?)')
        .run(result.room, result.endedAt.toISOString(), result.rounds, result.humans, result.bots);
      const insert = this.db.prepare(
        'INSERT INTO results (match_id, name, name_key, points, wins, kills, deaths) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const p of result.players) {
        const row = insert.run(match.lastInsertRowid, p.name, nameKey(p.name), p.points, p.wins, p.kills, p.deaths);
        inserted.set(Number(row.lastInsertRowid), p);
      }
    });
    this.cache = null;

    const places = this.db
      .prepare(`${BEST} SELECT id, name_key, place FROM ranked WHERE name_key IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(keys)) as { id: number; name_key: string; place: number }[];
    const records: NewRecord[] = [];
    for (const row of places) {
      const p = inserted.get(row.id);
      if (p && (row.place <= LEADERBOARD_SIZE || hadRecord.has(row.name_key))) {
        records.push({ playerId: p.playerId, name: p.name, place: row.place });
      }
    }
    return records.sort((a, b) => a.place - b.place);
  }

  /** The top LEADERBOARD_SIZE nicknames, cached for TOP_CACHE_MS. */
  top(now = Date.now()): LeaderboardEntry[] {
    if (this.cache && now < this.cache.expires) return this.cache.rows;
    const rows = this.db
      .prepare(`${BEST} SELECT place, name, points, wins, kills, deaths, rounds, ended_at FROM ranked ORDER BY place LIMIT ?`)
      .all(LEADERBOARD_SIZE) as (Omit<LeaderboardEntry, 'endedAt'> & { ended_at: string })[];
    const entries = rows.map(({ ended_at, ...row }) => ({ ...row, endedAt: ended_at }));
    this.cache = { expires: now + TOP_CACHE_MS, rows: entries };
    return entries;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Opens (and migrates) the database at `path`, ':memory:' for tests. Any failure is logged and
 * gives null: the game runs on without a leaderboard.
 */
export function openLeaderboard(path: string): Leaderboard | null {
  let db: DatabaseSync | undefined;
  try {
    // Loaded at runtime: Node 22.12 only has node:sqlite with --experimental-sqlite (22.13+ always does).
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
    if (!sqlite) throw new Error('node:sqlite nu e disponibil (Node < 22.13 fără --experimental-sqlite)');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    db = new sqlite.DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = ON;');
    return new Leaderboard(db);
  } catch (err) {
    console.error(`Clasament dezactivat: nu pot deschide ${path}:`, err);
    try {
      db?.close();
    } catch {
      // already closed
    }
    return null;
  }
}

let active: Leaderboard | null = null;

/** The leaderboard rooms save to and GET /leaderboard reads (null = none). */
export function currentLeaderboard(): Leaderboard | null {
  return active;
}

export function useLeaderboard(leaderboard: Leaderboard | null): void {
  active = leaderboard;
}
