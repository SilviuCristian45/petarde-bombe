import type { Action } from '@petarde/shared';
import { el } from '../ui/dom';
import type { InputSource } from './InputSource';

type Dir = 'up' | 'down' | 'left' | 'right';

export interface TouchOptions {
  /** A joystick (knob following the thumb) instead of the four-arrow D-pad. */
  joystick: boolean;
  /** D-pad on the right, petard button on the left. */
  leftHanded: boolean;
  /** Image URL for the petard button. */
  bombIcon: string;
}

const DIRS: Dir[] = ['up', 'right', 'down', 'left'];
const ARROW_SVG = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 9.5 8h-9z"/></svg>';
/** No direction this close to the middle, as a fraction of the radius. */
const DEAD_ZONE = { dpad: 0.16, joystick: 0.3 };
/** Sliding across a diagonal keeps the current axis until the other one is clearly ahead. */
const AXIS_BIAS = 1.25;
/** How far the joystick knob travels, as a fraction of the radius. */
const KNOB_TRAVEL = 0.6;

/**
 * On-screen controls for phones and tablets (HTML over the canvas): hold an arrow (or push the
 * joystick) to walk, sliding the thumb to another arrow turns, and the big button drops a petard.
 * Every finger is tracked on its own, so walking and dropping petards work at the same time.
 */
export class TouchInput implements InputSource {
  private readonly root: HTMLElement;
  private readonly pad: HTMLElement;
  private readonly bomb: HTMLElement;
  private readonly arrows = new Map<Dir, HTMLElement>();
  private readonly knob?: HTMLElement;
  /** Fingers on the pad, oldest first; the newest one steers. */
  private readonly padPointers = new Map<number, Dir | null>();
  private readonly bombPointers = new Set<number>();
  private bombQueued = false;
  private sent: Action = 'stop';
  private visible = true;

  constructor(private readonly opts: TouchOptions) {
    if (opts.joystick) {
      this.knob = el('div', { class: 'knob' });
      this.pad = el('div', { class: 'touch-pad stick' }, [this.knob]);
    } else {
      this.pad = el('div', { class: 'touch-pad dpad' }, [el('div', { class: 'hub' })]);
      for (const dir of DIRS) {
        const arrow = el('div', { class: `arrow ${dir}` });
        arrow.innerHTML = ARROW_SVG;
        this.arrows.set(dir, arrow);
        this.pad.append(arrow);
      }
    }
    this.pad.setAttribute('aria-label', 'Mers');
    this.bomb = el('div', { class: 'touch-bomb', attrs: { role: 'button', 'aria-label': 'Pune petarda' } });
    this.bomb.style.setProperty('--bomb-icon', `url(${opts.bombIcon})`);
    this.root = el('div', { class: `touch-controls${opts.leftHanded ? ' left-handed' : ''}` }, [this.pad, this.bomb]);

    for (const target of [this.pad, this.bomb]) {
      // Keeps the touch from scrolling, zooming or reaching the game canvas underneath.
      target.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      target.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.pad.addEventListener('pointerdown', (e) => {
      this.pad.setPointerCapture(e.pointerId);
      this.padPointers.set(e.pointerId, this.dirAt(e, null));
      this.refreshPad(e);
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (!this.padPointers.has(e.pointerId)) return;
      this.padPointers.set(e.pointerId, this.dirAt(e, this.padPointers.get(e.pointerId)!));
      this.refreshPad(e);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.pad.addEventListener(type, (e) => {
        if (!this.padPointers.delete(e.pointerId)) return;
        this.refreshPad();
      });
      this.bomb.addEventListener(type, (e) => {
        this.bombPointers.delete(e.pointerId);
        this.bomb.classList.toggle('pressed', this.bombPointers.size > 0);
      });
    }
    this.bomb.addEventListener('pointerdown', (e) => {
      this.bomb.setPointerCapture(e.pointerId);
      this.bombPointers.add(e.pointerId);
      this.bomb.classList.add('pressed');
      if (this.visible) this.bombQueued = true;
    });
    document.body.append(this.root);
  }

  poll(): Action[] {
    const actions: Action[] = [];
    const dir: Action = this.currentDir() ?? 'stop';
    if (dir !== this.sent) {
      actions.push(dir);
      this.sent = dir;
    }
    if (this.bombQueued) {
      actions.push('bomb');
      this.bombQueued = false;
    }
    return actions;
  }

  reset(): void {
    this.sent = 'stop';
    this.bombQueued = false;
  }

  /** Shown only while there is something to steer; hiding lets go of everything held. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    if (visible) return;
    this.bombQueued = false;
    this.releaseAll();
  }

  /** Lets go of everything held, e.g. when the page goes to the background. */
  releaseAll(): void {
    this.padPointers.clear();
    this.bombPointers.clear();
    this.bomb.classList.remove('pressed');
    this.refreshPad();
  }

  destroy(): void {
    this.root.remove();
  }

  private currentDir(): Dir | null {
    if (!this.visible) return null;
    let dir: Dir | null = null;
    for (const d of this.padPointers.values()) dir = d;
    return dir;
  }

  private dirAt(e: PointerEvent, prev: Dir | null): Dir | null {
    const rect = this.pad.getBoundingClientRect();
    const r = rect.width / 2;
    const dx = e.clientX - (rect.left + r);
    const dy = e.clientY - (rect.top + r);
    if (Math.hypot(dx, dy) < r * (this.opts.joystick ? DEAD_ZONE.joystick : DEAD_ZONE.dpad)) return null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let horizontal: boolean;
    if (prev === 'left' || prev === 'right') horizontal = ax * AXIS_BIAS >= ay;
    else if (prev === 'up' || prev === 'down') horizontal = ax > ay * AXIS_BIAS;
    else horizontal = ax > ay;
    if (horizontal) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }

  /** Lights the active arrow, or moves the joystick knob under the steering finger. */
  private refreshPad(e?: PointerEvent): void {
    const dir = this.currentDir();
    for (const [d, arrow] of this.arrows) arrow.classList.toggle('active', d === dir);
    if (!this.knob) return;
    const held = this.padPointers.size > 0;
    this.pad.classList.toggle('active', held && dir !== null);
    if (!held) {
      this.knob.style.transform = '';
      return;
    }
    if (!e) return;
    const rect = this.pad.getBoundingClientRect();
    const r = rect.width / 2;
    let dx = e.clientX - (rect.left + r);
    let dy = e.clientY - (rect.top + r);
    const len = Math.hypot(dx, dy);
    const max = r * KNOB_TRAVEL;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
