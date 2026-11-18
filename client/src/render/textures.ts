import Phaser from 'phaser';
import { PLAYER_COLORS, POWERUP_BOMB, POWERUP_RANGE, POWERUP_SPEED } from '@petarde/shared';
import { TILE } from './layout';

// Placeholder art drawn at boot, New Year's Eve flavoured: bricks are gift boxes,
// bombs are firecrackers. Real sprites can replace these keys later.

export const TEX = {
  floorA: 'floorA',
  floorB: 'floorB',
  wall: 'wall',
  brick: 'brick',
  bomb: 'bomb',
  flame: 'flame',
  spark: 'spark',
  smoke: 'smoke',
  crown: 'crown',
  soundOn: 'soundOn',
  soundOff: 'soundOff',
  powerup: (type: number) => `powerup${type}`,
  player: (slot: number) => `player${slot}`,
} as const;

/** Every scene that draws calls this; the textures are baked once per game. */
export function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TEX.wall)) createTextures(scene);
}

function createTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  const T = TILE;
  const bake = (key: string, w = T, h = T) => {
    g.generateTexture(key, w, h);
    g.clear();
  };

  g.fillStyle(0x1b2a4a).fillRect(0, 0, T, T);
  bake(TEX.floorA);
  g.fillStyle(0x1f3053).fillRect(0, 0, T, T);
  bake(TEX.floorB);

  g.fillStyle(0x3d4a66).fillRect(0, 0, T, T);
  g.fillStyle(0x56647f).fillRect(2, 2, T - 4, T - 4);
  g.fillStyle(0x3d4a66).fillRect(6, 6, T - 12, T - 12);
  g.fillStyle(0xeaf2ff, 0.85).fillRect(2, 2, T - 4, 5); // snow on top
  bake(TEX.wall);

  g.fillStyle(0xb5223a).fillRect(3, 5, T - 6, T - 8);
  g.fillStyle(0xd63650).fillRect(3, 5, T - 6, 6);
  g.fillStyle(0xffd166).fillRect(T / 2 - 3, 5, 6, T - 8).fillRect(3, T / 2 - 1, T - 6, 6);
  g.fillStyle(0xffd166).fillCircle(T / 2 - 6, 5, 5).fillCircle(T / 2 + 6, 5, 5);
  bake(TEX.brick);

  g.fillStyle(0x111111).fillCircle(T / 2, T / 2 + 3, 13);
  g.fillStyle(0xe63946).fillRect(T / 2 - 9, T / 2 - 3, 18, 6);
  g.lineStyle(3, 0x8d6e63).lineBetween(T / 2, T / 2 - 10, T / 2 + 6, T / 2 - 16);
  g.fillStyle(0xffe066).fillCircle(T / 2 + 7, T / 2 - 17, 3);
  bake(TEX.bomb);

  g.fillStyle(0xff7b00).fillRect(0, 0, T, T);
  g.fillStyle(0xffc300).fillRect(5, 5, T - 10, T - 10);
  g.fillStyle(0xfff3b0).fillRect(12, 12, T - 24, T - 24);
  bake(TEX.flame);

  // White so particles can be tinted in the player's color.
  g.fillStyle(0xffffff).fillCircle(4, 4, 4);
  bake(TEX.spark, 8, 8);
  g.fillStyle(0xffffff, 0.35).fillCircle(12, 12, 12);
  g.fillStyle(0xffffff, 0.6).fillCircle(12, 12, 8);
  bake(TEX.smoke, 24, 24);

  // Host crown
  g.fillStyle(0xffd166).fillTriangle(1, 5, 6, 14, 1, 14).fillTriangle(19, 5, 14, 14, 19, 14);
  g.fillTriangle(10, 1, 4, 14, 16, 14).fillRect(1, 12, 18, 4);
  g.fillStyle(0xe63946).fillCircle(10, 13, 2);
  bake(TEX.crown, 20, 16);

  // Mute toggle: speaker with sound waves, or with a cross.
  const speaker = () => {
    g.fillStyle(0xeaf2ff).fillRect(4, 11, 6, 10).fillTriangle(8, 11, 16, 4, 16, 28).fillTriangle(8, 21, 16, 4, 16, 28);
  };
  speaker();
  g.lineStyle(2, 0xeaf2ff);
  g.beginPath().arc(17, 16, 6, -0.9, 0.9).strokePath();
  g.beginPath().arc(17, 16, 11, -0.9, 0.9).strokePath();
  bake(TEX.soundOn, 32, 32);
  speaker();
  g.lineStyle(3, 0xff6b81).lineBetween(20, 11, 29, 21).lineBetween(29, 11, 20, 21);
  bake(TEX.soundOff, 32, 32);

  const powerupColors: Record<number, number> = {
    [POWERUP_BOMB]: 0x4361ee,
    [POWERUP_RANGE]: 0xf77f00,
    [POWERUP_SPEED]: 0x2a9d8f,
  };
  for (const [type, color] of Object.entries(powerupColors)) {
    g.fillStyle(0x000000, 0.35).fillRoundedRect(7, 9, T - 12, T - 12, 6);
    g.fillStyle(color).fillRoundedRect(5, 5, T - 12, T - 12, 6);
    g.fillStyle(0xffffff);
    const c = T / 2 - 1;
    if (Number(type) === POWERUP_BOMB) g.fillCircle(c, c + 1, 7).fillRect(c - 1, c - 10, 3, 5);
    else if (Number(type) === POWERUP_RANGE) g.fillRect(c - 10, c - 2, 20, 4).fillRect(c - 2, c - 10, 4, 20);
    else g.fillTriangle(c - 7, c - 9, c + 7, c, c - 7, c + 9);
    bake(TEX.powerup(Number(type)));
  }

  PLAYER_COLORS.forEach((color, slot) => {
    g.fillStyle(0x000000, 0.3).fillEllipse(T / 2, T - 5, 26, 8);
    g.fillStyle(color).fillCircle(T / 2, T / 2, 14);
    g.fillStyle(0xffffff, 0.25).fillCircle(T / 2 - 5, T / 2 - 6, 5);
    g.fillStyle(0xffffff).fillCircle(T / 2 - 5, T / 2 - 1, 4).fillCircle(T / 2 + 5, T / 2 - 1, 4);
    g.fillStyle(0x111111).fillCircle(T / 2 - 4, T / 2 - 1, 2).fillCircle(T / 2 + 6, T / 2 - 1, 2);
    // căciulă
    g.fillStyle(0xe63946).fillTriangle(T / 2 - 11, T / 2 - 9, T / 2 + 11, T / 2 - 9, T / 2 + 4, T / 2 - 22);
    g.fillStyle(0xffffff).fillRect(T / 2 - 12, T / 2 - 11, 24, 4).fillCircle(T / 2 + 4, T / 2 - 22, 3);
    bake(TEX.player(slot));
  });

  g.destroy();
}
