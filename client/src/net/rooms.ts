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

/** A reconnection token left by a reload of this tab, if any (the server keeps the seat for 15 s). */
export function hasResumableRoom(): boolean {
  return onlineEnabled && loadToken() !== null;
}

export async function resumeRoom(): Promise<GameTransport> {
  const token = loadToken();
  saveToken(null);
  if (!onlineEnabled || !token) throw new RoomError('Nu există un joc de reluat.');
  try {
    return await connected(getClient().reconnect(token));
  } catch {
    throw new RoomError('Nu te-ai mai putut reconecta la joc.');
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
  return new ColyseusTransport(room, { onToken: saveToken });
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

function loadToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // reloading the tab just won't resume the room
  }
}
