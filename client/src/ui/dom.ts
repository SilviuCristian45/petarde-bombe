import Phaser from 'phaser';
import { isTouch } from '../device';

// Small helpers for the HTML parts of the UI (screens, dialogs, toasts, touch controls).

type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  /** Any other attribute (type, aria-label, inputmode...). */
  attrs?: Record<string, string>;
  onClick?: (e: MouseEvent) => void;
}

/** document.createElement with a class, text, attributes and children in one go. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElProps = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  const onClick = props.onClick;
  if (onClick) node.addEventListener('click', (e) => onClick(e as MouseEvent));
  for (const child of children) if (child) node.append(child);
  return node;
}

export type ButtonStyle = 'primary' | 'secondary';

export function button(label: string, onClick: () => void, style: ButtonStyle = 'secondary', size = ''): HTMLButtonElement {
  return el('button', { class: `btn ${style} ${size}`.trim(), text: label, attrs: { type: 'button' }, onClick: () => onClick() });
}

/** "Bombe și Petarde" in the title style. */
export function title(small = false): HTMLHeadingElement {
  return el('h1', { class: small ? 'title small' : 'title', text: 'Bombe și Petarde' });
}

/** Switches a button between the primary and secondary look. */
export function setButtonStyle(btn: HTMLButtonElement, style: ButtonStyle): void {
  btn.classList.toggle('primary', style === 'primary');
  btn.classList.toggle('secondary', style === 'secondary');
}

/** Sets text only when it changed (screens refresh every frame). */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function show(node: HTMLElement, visible: boolean): void {
  node.hidden = !visible;
}

/**
 * Puts an HTML screen over the canvas for as long as the scene runs. The canvas behind it only
 * draws the night sky, stretched to cover the whole page (portrait phones included).
 */
export function mountScreen(scene: Phaser.Scene, className: string, children: Child[]): HTMLElement {
  const column = el('div', { class: 'column' }, children);
  const screen = el('div', { class: `screen ${className}` }, [column]);
  document.body.append(screen);
  document.body.classList.add('html-screen');
  useScaleMode(scene, Phaser.Scale.ENVELOP);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    screen.remove();
    if (!document.querySelector('.screen')) document.body.classList.remove('html-screen');
  });
  return column;
}

/** FIT for the game (all of the arena visible), ENVELOP behind the HTML screens. */
export function useScaleMode(scene: Phaser.Scene, mode: Phaser.Scale.ScaleModeType): void {
  const scale = scene.scale;
  scale.scaleMode = mode;
  // FIT / ENVELOP is really the display size's aspect mode.
  scale.displaySize.setAspectMode(mode);
  // The parent may have just changed size (safe-area padding comes and goes with the HTML screens).
  scale.getParentBounds();
  scale.refresh();
}

/** Keys typed into the nickname or code fields are text, not shortcuts. */
export function isTyping(): boolean {
  return document.activeElement instanceof HTMLInputElement;
}

/** A page-wide key handler for the scene's lifetime; skipped while typing or on a focused button (it has its own Enter). */
export function onKey(scene: Phaser.Scene, key: string, handler: () => void): void {
  const listener = (e: KeyboardEvent) => {
    if (e.key !== key || e.repeat || isTyping() || document.activeElement instanceof HTMLButtonElement) return;
    if (document.querySelector('.modal-backdrop')) return;
    handler();
  };
  window.addEventListener('keydown', listener);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', listener));
}

/** On phones the keyboard slides over the lower half: bring the focused field back into view. */
export function keepInViewOnFocus(input: HTMLElement): void {
  if (!isTouch) return;
  input.addEventListener('focus', () => {
    window.setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
  });
}

/**
 * Screens follow the visual viewport (CSS --vv-top / --vv-height), which shrinks when the phone
 * keyboard opens; called once at startup.
 */
export function trackVisualViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const sync = () => {
    root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    root.style.setProperty('--vv-height', `${vv.height}px`);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}

/** A texture baked by render/textures.ts as an image URL, for the HTML parts. */
export function textureUrl(game: Phaser.Game, key: string): string {
  return game.textures.getBase64(key);
}
