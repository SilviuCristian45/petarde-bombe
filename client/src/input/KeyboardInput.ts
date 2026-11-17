import Phaser from 'phaser';
import type { Action } from '@petarde/shared';
import type { InputSource } from './InputSource';

type Dir = 'up' | 'down' | 'left' | 'right';

const KEYS: [number, Dir][] = [
  [Phaser.Input.Keyboard.KeyCodes.UP, 'up'],
  [Phaser.Input.Keyboard.KeyCodes.W, 'up'],
  [Phaser.Input.Keyboard.KeyCodes.DOWN, 'down'],
  [Phaser.Input.Keyboard.KeyCodes.S, 'down'],
  [Phaser.Input.Keyboard.KeyCodes.LEFT, 'left'],
  [Phaser.Input.Keyboard.KeyCodes.A, 'left'],
  [Phaser.Input.Keyboard.KeyCodes.RIGHT, 'right'],
  [Phaser.Input.Keyboard.KeyCodes.D, 'right'],
];

/**
 * Arrows / WASD to move, Space to drop a bomb. The most recently pressed direction
 * that is still held wins, so releasing it falls back to the previous one.
 */
export class KeyboardInput implements InputSource {
  private readonly held: { key: Phaser.Input.Keyboard.Key; dir: Dir }[] = [];
  private readonly keys: Phaser.Input.Keyboard.Key[] = [];
  private readonly bombKey: Phaser.Input.Keyboard.Key;
  private bombQueued = false;
  private sent: Action = 'stop';

  constructor(keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {
    for (const [code, dir] of KEYS) {
      const key = keyboard.addKey(code, true);
      key.on('down', () => {
        this.release(key);
        this.held.push({ key, dir });
      });
      this.keys.push(key);
    }
    this.bombKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, true);
    this.bombKey.on('down', () => {
      this.bombQueued = true;
    });
  }

  poll(): Action[] {
    // Keys released while the window lost focus never fire 'up'; drop them here.
    for (let i = this.held.length - 1; i >= 0; i--) if (!this.held[i]!.key.isDown) this.held.splice(i, 1);
    const actions: Action[] = [];
    const dir: Action = this.held.length > 0 ? this.held[this.held.length - 1]!.dir : 'stop';
    if (dir !== this.sent) {
      actions.push(dir);
      this.sent = dir;
    }
    if (this.bombQueued) {
      actions.push('bomb');
      this.bombQueued = false;
    }
    return actions;
  }

  reset(): void {
    this.sent = 'stop';
    this.bombQueued = false;
  }

  destroy(): void {
    for (const key of [...this.keys, this.bombKey]) key.removeAllListeners();
    this.held.length = 0;
  }

  private release(key: Phaser.Input.Keyboard.Key): void {
    const i = this.held.findIndex((h) => h.key === key);
    if (i >= 0) this.held.splice(i, 1);
  }
}
