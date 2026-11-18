import { load, save } from './storage';

// "Efecte reduse": fewer particles and no snow, for slow computers and phones.

const KEY = 'reducedEffects';
let reduced = load(KEY) === '1';
const listeners = new Set<(reduced: boolean) => void>();

export function reducedEffects(): boolean {
  return reduced;
}

export function setReducedEffects(value: boolean): void {
  if (value === reduced) return;
  reduced = value;
  save(KEY, value ? '1' : '0');
  for (const cb of listeners) cb(value);
}

/** Returns an unsubscribe function. */
export function onEffectsChange(cb: (reduced: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
