import Phaser from 'phaser';
import { playOptional } from '../audio/sound';
import { FONT, GAME_W } from '../render/layout';
import { ensureTextures } from '../render/textures';
import { addTitle, drawBackdrop } from '../ui/backdrop';
import { TextButton } from '../ui/TextButton';
import type { MenuSceneData } from './MenuScene';

/** Title screen. The "Intră" click is the user gesture browsers require before audio can play. */
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
    addTitle(this, 170, 64);
    this.add
      .text(GAME_W / 2, 240, 'Revelion cu petarde, în arenă', { fontFamily: FONT, fontSize: '20px', color: '#d0d8f0' })
      .setOrigin(0.5);
    new TextButton(this, GAME_W / 2, 360, 'Intră', () => this.enter(), 'primary', 30);
    this.input.keyboard!.once('keydown-ENTER', () => this.enter());
    this.scene.launch('ui');
  }

  private enter(): void {
    void playOptional(this.game, 'intro', ['audio/intro.ogg', 'audio/intro.mp3']);
    this.scene.start('menu', this.next);
  }
}
