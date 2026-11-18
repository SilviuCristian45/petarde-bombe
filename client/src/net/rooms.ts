import { DEFAULT_ROUNDS } from '@petarde/shared';
import type { GameTransport } from './GameTransport';
import { LocalTransport } from './LocalTransport';

// Where the menu gets its rooms from. Until the Colyseus server exists, "Creează room"
// opens a local room with bots and joining by code is reported as unavailable;
// ColyseusTransport will plug in here without touching the scenes.

/** Bot added to a fresh local room so Start works right away (minimum 2 players). */
const LOCAL_START_BOTS = 1;

export function createRoom(name: string): Promise<GameTransport> {
  return Promise.resolve(
    new LocalTransport({
      name,
      bots: LOCAL_START_BOTS,
      rounds: DEFAULT_ROUNDS,
      seed: Math.random().toString(36).slice(2),
      autoStart: false,
    }),
  );
}

export function joinRoom(_code: string, _name: string): Promise<GameTransport> {
  return Promise.reject(new Error('Serverul online nu e disponibil încă. Creează un room local.'));
}
