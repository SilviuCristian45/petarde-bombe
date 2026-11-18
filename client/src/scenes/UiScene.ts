import Phaser from 'phaser';
import { isMuted, toggleMute } from '../audio/sound';
import { GAME_W } from '../render/layout';
import { ensureTextures, TEX } from '../render/textures';
import { Toasts, type ToastOptions } from '../ui/Toasts';

/** Runs on top of every other scene from the intro on: mute and fullscreen toggles, toasts. */
export class UiScene extends Phaser.Scene {
  toasts!: Toasts;

  constructor() {
    super('ui');
  }

  create(): void {
    ensureTextures(this);
    this.toasts = new Toasts(this);
    const mute = iconButton(this, GAME_W - 20, isMuted() ? TEX.soundOff : TEX.soundOn, () => {
      toggleMute(this.game);
      mute.setTexture(isMuted() ? TEX.soundOff : TEX.soundOn);
    });

    // Not offered where the browser has no Fullscreen API (e.g. Safari on iPhone).
    if (!this.scale.fullscreen.available) return;
    const full = iconButton(this, GAME_W - 50, TEX.fullscreenOn, () => this.toggleFullscreen());
    // These also fire when the browser leaves fullscreen on its own (Esc).
    const sync = () => full.setTexture(this.scale.isFullscreen ? TEX.fullscreenOff : TEX.fullscreenOn);
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, sync);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, sync);
    this.input.keyboard!.on('keydown-F', () => {
      if (!isTyping()) this.toggleFullscreen();
    });
  }

  private toggleFullscreen(): void {
    if (this.scale.isFullscreen) this.scale.stopFullscreen();
    else this.scale.startFullscreen();
  }
}

function iconButton(scene: Phaser.Scene, x: number, texture: string, onClick: () => void): Phaser.GameObjects.Image {
  // Small enough to sit beside the game HUD's title.
  const button = scene.add.image(x, 20, texture).setScale(0.8).setAlpha(0.75).setInteractive({ useHandCursor: true });
  button.on('pointerover', () => button.setAlpha(1));
  button.on('pointerout', () => button.setAlpha(0.75));
  button.on('pointerup', onClick);
  return button;
}

/** A toast in the top-right corner, above whatever scene is running. */
export function showToast(game: Phaser.Game, opts: ToastOptions): void {
  const ui = game.scene.getScene('ui') as UiScene | null;
  if (ui?.scene.isActive()) ui.toasts.show(opts);
}

/** Keys typed into the nickname or code fields are text, not shortcuts. */
export function isTyping(): boolean {
  return document.activeElement instanceof HTMLInputElement;
}
