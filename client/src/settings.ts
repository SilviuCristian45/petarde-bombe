import { isTouch } from './device';
import { load, save } from './storage';

// Per-device preferences, remembered in localStorage:
// - "Efecte reduse": fewer particles and no snow, for slow computers and phones (on by default on touch devices);
// - touch controls: joystick instead of the D-pad, left-handed mode (sides swapped), vibration.

export type SettingKey = 'reducedEffects' | 'joystick' | 'leftHanded' | 'vibration';

const DEFAULTS: Record<SettingKey, boolean> = {
  reducedEffects: isTouch,
  joystick: false,
  leftHanded: false,
  vibration: true,
};

const values = {} as Record<SettingKey, boolean>;
for (const key of Object.keys(DEFAULTS) as SettingKey[]) {
  const saved = load(key);
  values[key] = saved === null ? DEFAULTS[key] : saved === '1';
}
const listeners = new Set<(reduced: boolean) => void>();

export function getSetting(key: SettingKey): boolean {
  return values[key];
}

export function setSetting(key: SettingKey, value: boolean): void {
  if (value === values[key]) return;
  values[key] = value;
  save(key, value ? '1' : '0');
  if (key === 'reducedEffects') for (const cb of listeners) cb(value);
}

export function reducedEffects(): boolean {
  return values.reducedEffects;
}

export function setReducedEffects(value: boolean): void {
  setSetting('reducedEffects', value);
}

/** Returns an unsubscribe function. */
export function onEffectsChange(cb: (reduced: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
