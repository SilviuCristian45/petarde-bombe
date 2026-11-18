import Phaser from 'phaser';
import { playOptional } from '../audio/sound';
import { ensureTextures } from '../render/textures';
import { drawBackdrop } from '../ui/backdrop';
import { button, el, mountScreen, onKey, title } from '../ui/dom';
import type { MenuSceneData } from './MenuScene';

/** Title screen. The "Intră" click is the user gesture browsers require before audio can play. Next: the nickname. */
export class IntroScene extends Phaser.Scene {
  private next!: MenuSceneData;

  constructor() {
    super('intro');
  }

  init(data: MenuSceneData): void {
    this.next = data;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    const enter = button('Intră', () => this.enter(), 'primary', 'big');
    mountScreen(this, 'intro', [title(), el('p', { class: 'subtitle', text: 'Revelion cu petarde, în arenă' }), enter]);
    onKey(this, 'Enter', () => this.enter());
  }

  private enter(): void {
    void playOptional(this.game, 'intro', ['audio/intro.ogg', 'audio/intro.mp3']);
    this.scene.start('name', this.next);
  }
}
