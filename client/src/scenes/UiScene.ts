import Phaser from 'phaser';
import { isMuted, toggleMute } from '../audio/sound';
import { GAME_W } from '../render/layout';
import { ensureTextures, TEX } from '../render/textures';

/** Runs on top of every other scene from the intro on; holds the mute toggle. */
export class UiScene extends Phaser.Scene {
  constructor() {
    super('ui');
  }

  create(): void {
    ensureTextures(this);
    const icon = () => (isMuted() ? TEX.soundOff : TEX.soundOn);
    const button = this.add
      .image(GAME_W - 24, 24, icon())
      .setAlpha(0.75)
      .setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setAlpha(1));
    button.on('pointerout', () => button.setAlpha(0.75));
    button.on('pointerdown', () => {
      toggleMute(this.game);
      button.setTexture(icon());
    });
  }
}
