import Phaser from 'phaser';
import {
  botThink,
  cellOf,
  computeDanger,
  NO_DANGER,
  PLAYER_COLORS,
  sortedPlayers,
  type BotIntent,
  type BotThought,
  type GameState,
} from '@petarde/shared';
import { BOARD_H, BOARD_W, BOARD_X, BOARD_Y, cellToScreenX, cellToScreenY, FONT, subToScreenX, subToScreenY, TILE } from '../render/layout';

// Enabled with ?debug in the URL: grid, hitboxes, danger map, tick/FPS and what each bot is up to.

const INTENTS: Record<BotIntent, { label: string; color: number }> = {
  flee: { label: 'fuge', color: 0x4cc9f0 },
  break: { label: 'sparge', color: 0xffd166 },
  attack: { label: 'atacă', color: 0xff4d6d },
  powerup: { label: 'bonus', color: 0x80ed99 },
  idle: { label: 'stă', color: 0xaaaaaa },
};

const ACTION_ARROWS: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', stop: '·', bomb: '💣' };

const DEPTH = 20;

export type ScreenPos = (playerId: string) => { x: number; y: number } | undefined;

export class DebugOverlay {
  private readonly scene: Phaser.Scene;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly info: Phaser.GameObjects.Text;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private thoughts = new Map<string, BotThought>();
  private danger: Int32Array | null = null;
  private lastTick = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.drawGrid();
    this.gfx = scene.add.graphics().setDepth(DEPTH);
    this.info = scene.add
      .text(BOARD_X + 4, BOARD_Y + 2, '', {
        fontFamily: FONT,
        fontSize: '12px',
        color: '#00ff9c',
        backgroundColor: '#000000aa',
        padding: { x: 4, y: 2 },
      })
      .setDepth(DEPTH + 1);
  }

  update(state: Readonly<GameState>, fps: number, paused: boolean, screenPos: ScreenPos): void {
    // Bot thinking is pure, so it can be recomputed here from any state (local or remote).
    if (state.tick !== this.lastTick) {
      this.lastTick = state.tick;
      this.danger = state.phase === 'playing' ? computeDanger(state) : null;
      this.thoughts = new Map();
      for (const p of sortedPlayers(state)) if (p.isBot && p.alive) this.thoughts.set(p.id, botThink(state, p.id));
    }

    const status = paused ? '  PAUZĂ' : '';
    this.info.setText(
      `tick ${state.tick}  runda-tick ${state.roundTick}  FPS ${fps.toFixed(0)}  ${state.phase}  bombe ${state.bombs.length}${status}`,
    );

    const g = this.gfx.clear();
    if (this.danger) {
      for (let i = 0; i < this.danger.length; i++) {
        const t = this.danger[i]!;
        if (t === NO_DANGER) continue;
        const x = i % state.width;
        const y = (i - x) / state.width;
        g.fillStyle(0xff0000, t <= 10 ? 0.35 : 0.15).fillRect(BOARD_X + x * TILE, BOARD_Y + y * TILE, TILE, TILE);
      }
    }

    for (const p of Object.values(state.players)) {
      if (!p.alive || state.phase !== 'playing') continue;
      const color = PLAYER_COLORS[p.slot]!;
      // Collisions use the cell under the player's center: that cell is the hitbox.
      g.lineStyle(2, color, 1).strokeRect(BOARD_X + cellOf(p.x) * TILE + 1, BOARD_Y + cellOf(p.y) * TILE + 1, TILE - 2, TILE - 2);
      const cx = subToScreenX(p.x);
      const cy = subToScreenY(p.y);
      g.lineStyle(1, 0xffffff, 1).lineBetween(cx - 4, cy, cx + 4, cy).lineBetween(cx, cy - 4, cx, cy + 4);
    }

    const seen = new Set<string>();
    for (const [id, thought] of this.thoughts) {
      const pos = screenPos(id);
      if (!pos) continue;
      seen.add(id);
      const { label, color } = INTENTS[thought.intent];
      if (thought.path.length > 0) {
        g.lineStyle(2, color, 0.8).beginPath().moveTo(pos.x, pos.y);
        for (const c of thought.path) g.lineTo(cellToScreenX(c % state.width), cellToScreenY(Math.floor(c / state.width)));
        g.strokePath();
        const end = thought.path[thought.path.length - 1]!;
        const ex = end % state.width;
        const ey = Math.floor(end / state.width);
        g.lineStyle(2, color, 1).strokeCircle(cellToScreenX(ex), cellToScreenY(ey), TILE / 3);
      }
      let text = this.labels.get(id);
      if (!text) {
        text = this.scene.add
          .text(0, 0, '', { fontFamily: FONT, fontSize: '11px', backgroundColor: '#000000cc', padding: { x: 2, y: 1 } })
          .setOrigin(0.5, 0)
          .setDepth(DEPTH + 1);
        this.labels.set(id, text);
      }
      text
        .setText(`${label} ${ACTION_ARROWS[thought.action] ?? ''}`)
        .setColor(`#${color.toString(16).padStart(6, '0')}`)
        .setPosition(pos.x, pos.y + TILE / 2 - 2)
        .setVisible(true);
    }
    for (const [id, text] of this.labels) if (!seen.has(id)) text.setVisible(false);
  }

  private drawGrid(): void {
    const g = this.scene.add.graphics().setDepth(DEPTH);
    g.lineStyle(1, 0xffffff, 0.15);
    for (let x = 0; x <= BOARD_W; x += TILE) g.lineBetween(BOARD_X + x, BOARD_Y, BOARD_X + x, BOARD_Y + BOARD_H);
    for (let y = 0; y <= BOARD_H; y += TILE) g.lineBetween(BOARD_X, BOARD_Y + y, BOARD_X + BOARD_W, BOARD_Y + y);
    const style = { fontFamily: FONT, fontSize: '9px', color: '#ffffff' };
    for (let x = 1; x < BOARD_W / TILE; x++) {
      this.scene.add.text(BOARD_X + x * TILE + 2, BOARD_Y + BOARD_H - TILE + 2, String(x), style).setDepth(DEPTH).setAlpha(0.6);
    }
    for (let y = 1; y < BOARD_H / TILE; y++) {
      this.scene.add.text(BOARD_X + 2, BOARD_Y + y * TILE + 2, String(y), style).setDepth(DEPTH).setAlpha(0.6);
    }
  }
}
