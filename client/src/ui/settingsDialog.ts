import { isTouch } from '../device';
import { getSetting, setSetting, type SettingKey } from '../settings';
import { button, el } from './dom';
import { openDialog } from './dialog';

// "Setări" on touch devices: effects and the touch controls, remembered on this device.

const canVibrate = typeof navigator.vibrate === 'function';

function toggle(key: SettingKey, label: string): HTMLButtonElement {
  const state = el('span', { class: 'state' });
  const node = el('button', { class: 'toggle', attrs: { type: 'button' } }, [el('span', { text: label }), state]);
  const sync = () => {
    const on = getSetting(key);
    node.classList.toggle('on', on);
    node.setAttribute('aria-pressed', String(on));
    state.textContent = on ? 'da' : 'nu';
  };
  node.addEventListener('click', () => {
    setSetting(key, !getSetting(key));
    sync();
  });
  sync();
  return node;
}

export function openSettings(): void {
  const items = [toggle('reducedEffects', 'Efecte reduse')];
  if (isTouch) {
    items.push(toggle('joystick', 'Joystick în loc de D-pad'), toggle('leftHanded', 'Mod stângaci'));
    if (canVibrate) items.push(toggle('vibration', 'Vibrații'));
  }
  const dialog = openDialog(
    [el('h2', { text: 'Setări' }), el('div', { class: 'toggle-list' }, items), button('Gata', () => dialog.close(), 'primary', 'medium')],
    () => dialog.close(),
  );
}
