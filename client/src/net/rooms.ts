import { Client, type Room } from '@colyseus/sdk';
import {
  DEFAULT_ROUNDS,
  ERR_IN_PROGRESS,
  ERR_ROOM_FULL,
  ERR_SERVER_FULL,
  ROOM_NAME,
  type RoomStatus,
} from '@petarde/shared';
import { ColyseusTransport } from './ColyseusTransport';
import type { GameTransport } from './GameTransport';
import { LocalTransport } from './LocalTransport';

// Where the menu gets its rooms from. Online rooms live on the Colyseus server at
// VITE_SERVER_URL (default "/colyseus" on the same host; empty = offline-only build).
// The offline room runs the simulation in the browser with bots.

/** Bots in a fresh offline room, so Start works right away. */
const OFFLINE_START_BOTS = 3;
const CONNECT_TIMEOUT_MS = 8000;
const TOKEN_KEY = 'petarde.reconnect';

/** A failed create/join, with a message for the menu. `offline` offers the offline game instead. */
export class RoomError extends Error {
  constructor(
    message: string,
    readonly offline = false,
  ) {
    super(message);
  }
}

const serverUrl = resolveServerUrl(import.meta.env.VITE_SERVER_URL ?? '/colyseus');
let client: Client | undefined;

/** Whether this build talks to a server ("Creează room" / "Intră cu cod" go online). */
export const onlineEnabled = serverUrl !== null;

export function createOfflineRoom(name: string): Promise<GameTransport> {
  return Promise.resolve(
    new LocalTransport({
      name,
      bots: OFFLINE_START_BOTS,
      rounds: DEFAULT_ROUNDS,
      seed: Math.random().toString(36).slice(2),
      autoStart: false,
    }),
  );
}

export async function createRoom(name: string): Promise<GameTransport> {
  if (!onlineEnabled) return createOfflineRoom(name);
  try {
    return await connected(getClient().create(ROOM_NAME, { name }));
  } catch (err) {
    throw await explain(err);
  }
}

export async function joinRoom(code: string, name: string): Promise<GameTransport> {
  if (!onlineEnabled) throw new RoomError('Jocul online nu e disponibil în această versiune.');
  try {
    return await connected(getClient().joinById(code, { name }));
  } catch (err) {
    throw await explain(err, code);
  }
}

/**
 * The code of the room a reload of this tab left behind (the server keeps the seat for 15 s),
 * '' if the code is unknown, or null if there is nothing to resume.
 */
export function resumableRoomCode(): string | null {
  if (!onlineEnabled) return null;
  return loadToken()?.code ?? null;
}

export async function resumeRoom(): Promise<GameTransport> {
  const saved = loadToken();
  saveToken(null);
  if (!onlineEnabled || !saved) throw new RoomError('Nu există un joc de reluat.');
  try {
    return await connected(getClient().reconnect(saved.token));
  } catch {
    throw new RoomError('Nu te-ai mai putut reconecta la joc.');
  }
}

/** Leaves the room a reload left behind for good (reconnects just to say so); failures are ignored. */
export async function abandonResumableRoom(): Promise<void> {
  const saved = loadToken();
  saveToken(null);
  if (!onlineEnabled || !saved) return;
  try {
    const room = await withTimeout(getClient().reconnect(saved.token));
    await room.leave(true);
  } catch {
    // the seat was already gone, or will be once the 15 s are up
  }
}

function getClient(): Client {
  client ??= new Client(serverUrl!);
  return client;
}

/** Resolves once the first state has arrived, so scenes never see an empty room. */
async function connected(pending: Promise<Room>): Promise<GameTransport> {
  const room = await withTimeout(pending);
  if (!hasState(room)) {
    await withTimeout(new Promise<void>((resolve) => room.onStateChange.once(() => resolve())));
  }
  // Room codes are the Colyseus room ids.
  return new ColyseusTransport(room, { onToken: (token) => saveToken(token ? { token, code: room.roomId } : null) });
}

function hasState(room: Room): boolean {
  const state = room.state as { code?: string } | undefined;
  return !!state?.code;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Turns SDK/server errors into Romanian messages. */
async function explain(err: unknown, code?: string): Promise<RoomError> {
  const errorCode = typeof err === 'object' && err !== null && 'code' in err ? Number(err.code) : NaN;
  const message = err instanceof Error ? err.message : '';
  if (errorCode === ERR_SERVER_FULL) return new RoomError('Serverul e plin. Încearcă puțin mai târziu.', true);
  if (errorCode === ERR_ROOM_FULL) return new RoomError('Jocul e plin (maxim 6 jucători).');
  if (errorCode === ERR_IN_PROGRESS) return new RoomError('Meciul e deja în desfășurare. Încearcă după ce se termină.');
  if (code && /not found|disposed|locked/.test(message)) {
    // Colyseus reports a full room and a running match the same way ("locked"); ask the server which.
    const status = await fetchStatus(code);
    if (status === 'full') return new RoomError('Jocul e plin (maxim 6 jucători).');
    if (status === 'playing') return new RoomError('Meciul e deja în desfășurare. Încearcă după ce se termină.');
    if (status === 'missing') return new RoomError(`Nu există niciun joc cu codul ${code}.`);
  }
  return new RoomError('Serverul nu e disponibil acum.', true);
}

async function fetchStatus(code: string): Promise<RoomStatus | null> {
  try {
    const url = new URL(serverUrl!);
    url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
    url.pathname = `${url.pathname.replace(/\/$/, '')}/rooms/${code}`;
    const res = await withTimeout(fetch(url));
    if (!res.ok) return null;
    return ((await res.json()) as { status: RoomStatus }).status;
  } catch {
    return null;
  }
}

/** Absolute endpoint (a bare path means this host), or null when online play is switched off. */
function resolveServerUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return null;
  }
}

interface SavedToken {
  token: string;
  code: string;
}

function loadToken(): SavedToken | null {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    // Older builds stored the bare token.
    if (!raw.startsWith('{')) return { token: raw, code: '' };
    const saved = JSON.parse(raw) as Partial<SavedToken>;
    return typeof saved.token === 'string' ? { token: saved.token, code: String(saved.code ?? '') } : null;
  } catch {
    return null;
  }
}

function saveToken(saved: SavedToken | null): void {
  try {
    if (saved) window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(saved));
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // reloading the tab just won't resume the room
  }
}
