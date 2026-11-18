import Phaser from 'phaser';
import { addSnow } from '../render/fx';
import { GAME_H, GAME_W } from '../render/layout';

// New Year's night sky behind the HTML screens (intro, name, menu, lobby).

export function drawBackdrop(scene: Phaser.Scene): void {
  scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0b1026);
  const rnd = new Phaser.Math.RandomDataGenerator(['stele']);
  // Dense enough that a portrait phone, which sees only the middle of the sky, still gets stars.
  for (let i = 0; i < 130; i++) {
    const star = scene.add.circle(rnd.between(0, GAME_W), rnd.between(0, GAME_H), rnd.realInRange(0.6, 1.8), 0xeaf2ff);
    scene.tweens.add({
      targets: star,
      alpha: { from: rnd.realInRange(0.2, 0.5), to: 1 },
      duration: rnd.between(900, 2600),
      yoyo: true,
      repeat: -1,
      delay: rnd.between(0, 2000),
    });
  }
  // Snowy ground strip.
  scene.add.rectangle(GAME_W / 2, GAME_H - 12, GAME_W, 24, 0xeaf2ff, 0.12);
  addSnow(scene, 0);
}
