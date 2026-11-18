// What kind of device the page runs on, decided once at startup (layout constants depend on it).

const params = new URLSearchParams(window.location.search);

function detectTouch(): boolean {
  // ?touch / ?touch=0 force the phone layout on or off, for testing on a desktop.
  const forced = params.get('touch');
  if (forced !== null) return forced !== '0';
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** A phone or tablet: touch controls, the wide game layout, the rotate prompt. */
export const isTouch = detectTouch();

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with a touch screen). */
export const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Launched from the home screen (no browser bars). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
}
