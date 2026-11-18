import { isIOS, isStandalone } from '../device';
import { load, save } from '../storage';
import { el } from './dom';
import { fullscreenAvailable } from './fullscreen';

// iPhone Safari has no fullscreen: a discreet tip to add the game to the home screen, where it
// opens without browser bars (manifest + apple-mobile-web-app-capable). Shown in the menu until dismissed.

const KEY = 'installHintDismissed';
const SHARE_ICON =
  '<svg class="share-icon" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 1v9M3.5 4.5 7 1l3.5 3.5M3 7H1.5v8h11V7H11" stroke="#d0d8f0" stroke-width="1.5" fill="none"/></svg>';

export function installHint(): HTMLElement | null {
  if (!isIOS || fullscreenAvailable || isStandalone() || load(KEY) === '1') return null;
  const text = el('span');
  text.innerHTML = `Joc pe tot ecranul: ${SHARE_ICON} Partajează → <b>Adaugă pe ecranul principal</b>`;
  const hint = el('div', { class: 'install-hint' }, [text]);
  const close = el('button', { text: '✕', attrs: { type: 'button', 'aria-label': 'Ascunde' } });
  close.addEventListener('click', () => {
    save(KEY, '1');
    hint.remove();
  });
  hint.append(close);
  return hint;
}
