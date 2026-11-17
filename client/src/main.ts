import Phaser from 'phaser';
import { TICK_RATE } from '@petarde/shared';

class HelloScene extends Phaser.Scene {
  create(): void {
    this.add
      .text(480, 270, `Bombe și Petarde\n(${TICK_RATE} tick/s)`, {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ffe066',
        align: 'center',
      })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  backgroundColor: '#0b1026',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [HelloScene],
});
