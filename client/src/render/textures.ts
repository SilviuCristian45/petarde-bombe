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
  powerup: (type: number) => `powerup${type}`,
  player: (slot: number) => `player${slot}`,
} as const;

export function createTextures(scene: Phaser.Scene): void {
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
