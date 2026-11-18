import { TICK_RATE } from '@petarde/shared';

/** Loopback only: Caddy is the public entry point. */
export const HOST = process.env.HOST ?? '127.0.0.1';
export const PORT = Number(process.env.PORT ?? 2567);

/** Rooms alive at once; one more "Creează room" is refused with "Serverul e plin". */
export const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 20);

/** Seconds a dropped player keeps their place. */
export const RECONNECT_SECONDS = 15;

/** Inputs per second a client may send; extra ones are ignored. */
export const MAX_INPUTS_PER_SECOND = 30;
/** Messages per second (of any kind) above which a client is disconnected. */
export const MAX_MESSAGES_PER_SECOND = 2 * MAX_INPUTS_PER_SECOND;

export const TICK_INTERVAL_MS = 1000 / TICK_RATE;
