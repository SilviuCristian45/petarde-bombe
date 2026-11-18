import type Phaser from 'phaser';
import { isMuted, toggleMute } from '../audio/sound';
import { el, isTyping } from './dom';
import { fullscreenAvailable, isFullscreen, onFullscreenChange, toggleFullscreen } from './fullscreen';

// Mute and fullscreen toggles in the top-right corner, over every screen from the intro on (F also toggles fullscreen).

const SVG_NS = 'http://www.w3.org/2000/svg';

const SPEAKER = '<path d="M4 11h6l6-7v24l-6-7H4z" fill="#eaf2ff"/>';
const ICONS = {
  soundOn: `${SPEAKER}<path d="M20 11a7 7 0 0 1 0 10M23 6.5a13 13 0 0 1 0 19" stroke="#eaf2ff" stroke-width="2" fill="none"/>`,
  soundOff: `${SPEAKER}<path d="M20 11l9 10M29 11l-9 10" stroke="#ff6b81" stroke-width="3"/>`,
  // Four corner brackets, at the edges (enter) or folded toward the middle (exit).
  fullscreenOn: '<path d="M6 13V6h7M26 13V6h-7M6 19v7h7M26 19v7h-7" stroke="#eaf2ff" stroke-width="3" fill="none"/>',
  fullscreenOff: '<path d="M13 6v7H6M19 6v7h7M13 26v-7H6M19 26v-7h7" stroke="#eaf2ff" stroke-width="3" fill="none"/>',
};

function icon(markup: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.innerHTML = markup;
  return svg;
}

export function initChrome(game: Phaser.Game): void {
  const bar = el('div', { class: 'chrome' });
  const mute = el('button', { class: 'icon-btn', attrs: { type: 'button' } });
  const syncMute = () => {
    mute.replaceChildren(icon(isMuted() ? ICONS.soundOff : ICONS.soundOn));
    mute.setAttribute('aria-label', isMuted() ? 'Pornește sunetul' : 'Oprește sunetul');
  };
  mute.addEventListener('click', () => {
    toggleMute(game);
    syncMute();
    mute.blur();
  });
  syncMute();
  bar.append(mute);

  // Not offered where the browser has no Fullscreen API (Safari on iPhone).
  if (fullscreenAvailable) {
    const full = el('button', { class: 'icon-btn', attrs: { type: 'button' } });
    const syncFull = () => {
      full.replaceChildren(icon(isFullscreen() ? ICONS.fullscreenOff : ICONS.fullscreenOn));
      full.setAttribute('aria-label', isFullscreen() ? 'Ieși din ecran complet' : 'Ecran complet');
    };
    full.addEventListener('click', () => {
      toggleFullscreen();
      full.blur();
    });
    onFullscreenChange(syncFull);
    syncFull();
    bar.append(full);
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'f' || e.key === 'F') && !e.repeat && !isTyping()) toggleFullscreen();
    });
  }
  document.body.append(bar);
}
