import type { Action, GameEvent } from './types';

// Wire contract between the Colyseus room (/server) and ColyseusTransport (/client).

export const ROOM_NAME = 'bombe';

/** What the browser sends; the message `type` is also the Colyseus message name. */
export type ClientMessage =
  | { type: 'input'; action: Action }
  | { type: 'rounds'; rounds: number } // host, lobby: 3/5/7
  | { type: 'addBot' } // host, lobby
  | { type: 'removeBot' }
  | { type: 'botLevel'; level: number } // host, lobby: level for bots added from now on
  | { type: 'setBotLevel'; botId: string; level: number } // host, lobby: one bot's level
  | { type: 'start' } // host: lobby -> round 1
  | { type: 'lobby' } // host: finished -> back to the lobby ("Încă un meci")
  | { type: 'skipRound' }; // host, only while onlyBotsAlive

/** Server -> clients after each tick that produced events. */
export const MSG_EVENTS = 'events';
export interface TickEvents {
  /** The state tick these events belong to; clients play them once their state reaches it. */
  tick: number;
  events: GameEvent[];
}

/** Error codes the room rejects joins/creates with (Colyseus ServerError codes). */
export const ERR_SERVER_FULL = 4001; // too many rooms on the server
export const ERR_ROOM_FULL = 4002;
export const ERR_IN_PROGRESS = 4003;

/** Answer of GET /rooms/:code, used to explain a refused join. */
export type RoomStatus = 'open' | 'full' | 'playing' | 'missing';

export const ACTIONS: readonly Action[] = ['up', 'down', 'left', 'right', 'stop', 'bomb'];
