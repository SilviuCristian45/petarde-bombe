import Phaser from 'phaser';
import { isTouch } from './device';
import { getSetting } from './settings';

// Screen Wake Lock (the phone screen stays on during the lobby and the match) and vibration.
// Both are optional: browsers without them (or pages without HTTPS) simply do without.

let wanted = 0;
let sentinel: WakeLockSentinel | null = null;

async function acquire(): Promise<void> {
  if (sentinel || wanted === 0 || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
    // Released meanwhile (the scene ended while the request was pending).
    if (wanted === 0) void release();
  } catch {
    // battery saver, or not allowed: the screen may dim, the game goes on
  }
}

async function release(): Promise<void> {
  const held = sentinel;
  sentinel = null;
  await held?.release().catch(() => undefined);
}

// The browser drops the lock whenever the page is hidden; take it again on the way back.
document.addEventListener('visibilitychange', () => void acquire());

/** Keeps the screen on while the scene runs. */
export function keepScreenOn(scene: Phaser.Scene): void {
  wanted++;
  void acquire();
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    wanted--;
    if (wanted === 0) void release();
  });
}

/** Short buzz for a petard, a long one for a death (touch devices, unless switched off in the settings). */
export function vibrate(kind: 'bomb' | 'death'): void {
  if (!isTouch || !getSetting('vibration') || typeof navigator.vibrate !== 'function') return;
  // Chrome refuses (and logs an error) until the page has had a tap.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate(kind === 'bomb' ? 25 : 350);
  } catch {
    // not allowed before the first tap
  }
}
