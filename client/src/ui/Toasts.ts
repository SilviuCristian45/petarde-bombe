import Phaser from 'phaser';
import { FONT, GAME_W } from '../render/layout';

export interface ToastOptions {
  /** Plain text after the lead. */
  message: string;
  /** Shown first, in the accent color (e.g. a player's name). */
  lead?: string;
  /** Stripe and lead color; defaults to the title yellow. */
  accent?: number;
}

const RIGHT = GAME_W - 10;
const TOP = 40; // below the mute / fullscreen icons
const GAP = 6;
const PAD_X = 10;
const HEIGHT = 28;
const STRIPE = 4;
const MAX_TOASTS = 3;
const SHOW_MS = 3000;
const FADE_MS = 250;

interface Toast {
  box: Phaser.GameObjects.Container;
  timer: Phaser.Time.TimerEvent;
  leaving: boolean;
}

/**
 * Small messages stacked in the top-right corner: the newest at the bottom, older ones pushed up,
 * at most three, each gone by itself after a few seconds. Never interactive, so it never blocks play.
 */
export class Toasts {
  private readonly toasts: Toast[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  show(opts: ToastOptions): void {
    const scene = this.scene;
    const accent = opts.accent ?? 0xffe066;
    const style = { fontFamily: FONT, fontSize: '13px', color: '#ffffff' };
    const parts: Phaser.GameObjects.GameObject[] = [];
    let x = STRIPE + PAD_X;
    if (opts.lead) {
      const lead = scene.add.text(x, HEIGHT / 2, opts.lead, { ...style, color: toCss(accent), fontStyle: 'bold' }).setOrigin(0, 0.5);
      x += lead.width + 7;
      parts.push(lead);
    }
    const text = scene.add.text(x, HEIGHT / 2, opts.message, style).setOrigin(0, 0.5);
    const width = x + text.width + PAD_X;
    const bg = scene.add.rectangle(0, 0, width, HEIGHT, 0x0b1026, 0.9).setOrigin(0).setStrokeStyle(1, 0x24365e);
    const stripe = scene.add.rectangle(0, 0, STRIPE, HEIGHT, accent).setOrigin(0);
    const box = scene.add.container(RIGHT - width, this.slotY(this.active().length), [bg, stripe, ...parts, text]).setAlpha(0);
    scene.tweens.add({ targets: box, alpha: 1, duration: FADE_MS });

    const toast: Toast = { box, leaving: false, timer: scene.time.delayedCall(SHOW_MS, () => this.dismiss(toast)) };
    this.toasts.push(toast);
    const active = this.active();
    if (active.length > MAX_TOASTS) this.dismiss(active[0]!);
  }

  private active(): Toast[] {
    return this.toasts.filter((t) => !t.leaving);
  }

  private slotY(index: number): number {
    return TOP + index * (HEIGHT + GAP);
  }

  private dismiss(toast: Toast): void {
    if (toast.leaving) return;
    toast.leaving = true;
    toast.timer.remove();
    this.scene.tweens.add({
      targets: toast.box,
      alpha: 0,
      y: toast.box.y - HEIGHT / 2,
      duration: FADE_MS,
      onComplete: () => {
        toast.box.destroy();
        this.toasts.splice(this.toasts.indexOf(toast), 1);
      },
    });
    // The rest slide up into the freed place.
    this.active().forEach((t, i) => this.scene.tweens.add({ targets: t.box, y: this.slotY(i), duration: FADE_MS }));
  }
}

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
