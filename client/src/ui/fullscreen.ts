import { isTouch } from '../device';

// Fullscreen for the whole page (canvas and HTML layers together). Not available on iPhone;
// there the menu suggests adding the game to the home screen instead (ui/installHint.ts).

type FsDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as FsDocument;

export const fullscreenAvailable = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export function enterFullscreen(): void {
  if (!fullscreenAvailable || isFullscreen()) return;
  const root = document.documentElement as FsElement;
  try {
    if (root.requestFullscreen) void root.requestFullscreen({ navigationUI: 'hide' }).then(lockLandscape, () => undefined);
    else root.webkitRequestFullscreen?.();
  } catch {
    // refused (no user gesture): the button still works
  }
}

export function exitFullscreen(): void {
  if (!isFullscreen()) return;
  if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
  else doc.webkitExitFullscreen?.();
}

export function toggleFullscreen(): void {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}

/** Also fires when the browser leaves fullscreen on its own (Esc, back gesture). */
export function onFullscreenChange(cb: () => void): void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
}

/** Android can hold the game sideways once it is fullscreen. */
function lockLandscape(): void {
  if (!isTouch) return;
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation.lock?.('landscape').catch(() => undefined);
}

let armed: ((e: Event) => void) | null = null;

/**
 * Phones only: the next tap anywhere goes fullscreen (browsers allow it only from a gesture).
 * Called when the lobby or a match starts; returns a function that disarms it.
 */
export function fullscreenOnFirstTap(): () => void {
  if (!isTouch || !fullscreenAvailable || isFullscreen()) return () => undefined;
  disarm();
  armed = () => {
    disarm();
    enterFullscreen();
  };
  window.addEventListener('pointerup', armed, { capture: true });
  return disarm;
}

function disarm(): void {
  if (armed) window.removeEventListener('pointerup', armed, { capture: true });
  armed = null;
}
