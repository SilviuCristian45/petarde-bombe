import Phaser from 'phaser';
import { el } from './dom';

// The lobby and the match are played sideways; a phone held upright gets "Rotește telefonul"
// over them (CSS: body.touch.landscape-only in portrait). The menu and the name screen work both ways.

let holders = 0;

export function initRotatePrompt(): void {
  const prompt = el('div', { class: 'rotate', attrs: { role: 'alert' } }, [
    el('div', { class: 'phone' }),
    el('p', { text: 'Rotește telefonul' }),
    el('p', { class: 'muted', text: 'Jocul merge doar pe orizontală.' }),
  ]);
  // Taps on the prompt must not reach the game underneath.
  prompt.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  document.body.append(prompt);
}

/** For the scene's lifetime, portrait shows the rotate prompt. */
export function requireLandscape(scene: Phaser.Scene): void {
  holders++;
  document.body.classList.add('landscape-only');
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    holders--;
    if (holders === 0) document.body.classList.remove('landscape-only');
  });
}
