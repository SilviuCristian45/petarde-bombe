import type { LeaderboardEntry, LeaderboardResponse } from '@petarde/shared';
import { serverHttpUrl } from './rooms';

// The all-time leaderboard, read from the server (GET /leaderboard, cached there for ~30 s).

const TIMEOUT_MS = 8000;

/** The top rows, or null when the server or its database cannot be reached. */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[] | null> {
  const url = serverHttpUrl('/leaderboard');
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as LeaderboardResponse;
    return body.available && Array.isArray(body.entries) ? body.entries : null;
  } catch {
    return null;
  }
}

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'Europe/Bucharest',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "18.11.2026, 22:15" in Romanian time (the server stores UTC). */
export function formatRecordDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}
