import Phaser from 'phaser';
import { BOARD_H, BOARD_W, BOARD_X, BOARD_Y, TILE } from './layout';

// Strings of fairy lights along the arena's edges, over the outer wall ring (which never changes).

const COLORS = [0xff4d6d, 0x52b788, 0xffd60a, 0x4cc9f0, 0xc77dff];
const SAG = 5;
const BLINK_MS = 650;

export function addGarlands(scene: Phaser.Scene, depth: number): void {
  const inset = 6; // over the outer half of the border walls
  const left = BOARD_X + inset;
  const top = BOARD_Y + inset;
  const right = BOARD_X + BOARD_W - inset;
  const bottom = BOARD_Y + BOARD_H - inset;

  // Hooks every tile along the perimeter, clockwise from the top-left corner.
  const hooks: { x: number; y: number }[] = [];
  for (let x = left; x < right; x += TILE) hooks.push({ x, y: top });
  for (let y = top; y < bottom; y += TILE) hooks.push({ x: right, y });
  for (let x = right; x > left; x -= TILE) hooks.push({ x, y: bottom });
  for (let y = bottom; y > top; y -= TILE) hooks.push({ x: left, y });

  // The wire sags toward the board's center between hooks; a bulb hangs at every low point.
  const cx = BOARD_X + BOARD_W / 2;
  const cy = BOARD_Y + BOARD_H / 2;
  const wire = scene.add.graphics().setDepth(depth);
  wire.lineStyle(1.5, 0x1d3b2a, 0.9);
  const groups: Phaser.GameObjects.Arc[][] = [[], []];
  hooks.forEach((a, i) => {
    const b = hooks[(i + 1) % hooks.length]!;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const len = Math.hypot(cx - mx, cy - my);
    const low = { x: mx + ((cx - mx) / len) * SAG, y: my + ((cy - my) / len) * SAG };
    const curve = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(a.x, a.y),
      new Phaser.Math.Vector2(low.x, low.y),
      new Phaser.Math.Vector2(b.x, b.y),
    );
    curve.draw(wire, 8);
    const color = COLORS[i % COLORS.length]!;
    const glow = scene.add.circle(low.x, low.y, 7, color, 0.28).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    const bulb = scene.add.circle(low.x, low.y, 3.2, color).setDepth(depth);
    groups[i % 2]!.push(glow, bulb);
  });

  // Alternate halves blink, like a cheap string of lights.
  let phase = false;
  const blink = () => {
    phase = !phase;
    groups[0]!.forEach((o) => o.setAlpha(phase ? 1 : 0.35));
    groups[1]!.forEach((o) => o.setAlpha(phase ? 0.35 : 1));
  };
  blink();
  scene.time.addEvent({ delay: BLINK_MS, loop: true, callback: blink });
}
