import Phaser from 'phaser';
import {
  CELL_BRICK,
  CELL_WALL,
  computeStandings,
  PLAYER_COLORS,
  SHRINK_START_TICKS,
  sortedPlayers,
  SUB,
  TICK_MS,
  TICK_RATE,
  type GameEvent,
  type GameState,
} from '@petarde/shared';
import { DebugOverlay } from '../debug/DebugOverlay';
import type { InputSource } from '../input/InputSource';
import { KeyboardInput } from '../input/KeyboardInput';
import type { GameTransport } from '../net/GameTransport';
import {
  BOARD_H,
  BOARD_W,
  BOARD_X,
  BOARD_Y,
  cellToScreenX,
  cellToScreenY,
  FONT,
  HUD_W,
  HUD_X,
  subToScreenX,
  subToScreenY,
  TILE,
} from '../render/layout';
import { createTextures, TEX } from '../render/textures';

export interface GameSceneData {
  transport: GameTransport;
  debug: boolean;
}

interface PlayerView {
  body: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

interface HudRow {
  swatch: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

const DEPTH = { floor: 0, powerup: 1, cell: 2, bomb: 3, flame: 4, player: 5, label: 7, overlay: 10 } as const;
const ROUND_BANNER_TICKS = TICK_RATE; // "Runda N!" shown for 1 s

/** Renders the shared GameState and forwards local input; knows nothing about where the state comes from. */
export class GameScene extends Phaser.Scene {
  private transport!: GameTransport;
  private debugEnabled = false;
  private controls!: InputSource;
  private debug?: DebugOverlay;
  private unsubscribe?: () => void;

  private cellImages: Phaser.GameObjects.Image[] = [];
  private cellTypes: number[] = [];
  private readonly bombViews = new Map<number, Phaser.GameObjects.Image>();
  private readonly flameViews = new Map<number, Phaser.GameObjects.Image>();
  private readonly powerupViews = new Map<string, Phaser.GameObjects.Image>();
  private readonly playerViews = new Map<string, PlayerView>();

  // Players move once per tick; we draw them between the last two ticks.
  private readonly prevPos = new Map<string, { x: number; y: number }>();
  private readonly curPos = new Map<string, { x: number; y: number }>();
  private lastTick = -1;
  private tickAt = 0;

  private hudInfo!: Phaser.GameObjects.Text;
  private hudRows: HudRow[] = [];
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayText!: Phaser.GameObjects.Text;

  constructor() {
    super('game');
  }

  init(data: GameSceneData): void {
    this.transport = data.transport;
    this.debugEnabled = data.debug;
  }

  create(): void {
    if (!this.textures.exists(TEX.wall)) createTextures(this);
    const state = this.transport.getState();

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const floor = (x + y) % 2 === 0 ? TEX.floorA : TEX.floorB;
        this.add.image(cellToScreenX(x), cellToScreenY(y), floor).setDepth(DEPTH.floor);
        this.cellImages.push(
          this.add.image(cellToScreenX(x), cellToScreenY(y), TEX.wall).setDepth(DEPTH.cell).setVisible(false),
        );
        this.cellTypes.push(-1);
      }
    }

    this.createHud();
    this.overlayBg = this.add
      .rectangle(BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2, BOARD_W * 0.6, 120, 0x0b1026, 0.85)
      .setStrokeStyle(2, 0xffe066)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    this.overlayText = this.add
      .text(BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2, '', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#ffe066',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay);

    this.controls = new KeyboardInput(this.input.keyboard!);
    this.input.keyboard!.on('keydown-P', () => {
      if (this.transport.pausable) this.transport.setPaused(!this.transport.isPaused());
    });
    this.input.keyboard!.on('keydown-ENTER', () => this.restartMatch());
    this.unsubscribe = this.transport.onEvents((events) => this.handleEvents(events));

    if (this.debugEnabled) this.debug = new DebugOverlay(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.controls.destroy();
      this.transport.dispose();
    });
  }

  update(time: number, delta: number): void {
    for (const action of this.controls.poll()) this.transport.send({ type: 'input', action });
    this.transport.update(delta);

    const state = this.transport.getState();
    if (state.tick !== this.lastTick) {
      this.lastTick = state.tick;
      this.tickAt = time;
      this.prevPos.clear();
      for (const [id, pos] of this.curPos) this.prevPos.set(id, pos);
      this.curPos.clear();
      for (const p of Object.values(state.players)) this.curPos.set(p.id, { x: p.x, y: p.y });
    }
    const alpha = this.transport.isPaused() ? 1 : Phaser.Math.Clamp((time - this.tickAt) / TICK_MS, 0, 1);

    this.syncGrid(state);
    this.syncPowerups(state, time);
    this.syncBombs(state, time);
    this.syncFlames(state);
    this.syncPlayers(state, alpha);
    this.syncHud(state);
    this.syncOverlay(state);
    this.debug?.update(state, this.game.loop.actualFps, this.transport.isPaused(), (id) => {
      const view = this.playerViews.get(id);
      return view?.body.visible ? { x: view.body.x, y: view.body.y } : undefined;
    });
  }

  private handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'explosion') this.cameras.main.shake(120, 0.004);
      else if (e.type === 'roundStart') this.controls.reset();
    }
  }

  private restartMatch(): void {
    const state = this.transport.getState();
    if (state.phase !== 'finished' || state.hostId !== this.transport.playerId) return;
    this.transport.send({ type: 'lobby' });
    this.transport.send({ type: 'start' });
  }

  private syncGrid(state: Readonly<GameState>): void {
    for (let i = 0; i < state.grid.length; i++) {
      const type = state.grid[i]!;
      if (type === this.cellTypes[i]) continue;
      this.cellTypes[i] = type;
      const img = this.cellImages[i]!;
      if (type === CELL_WALL) img.setTexture(TEX.wall).setVisible(true);
      else if (type === CELL_BRICK) img.setTexture(TEX.brick).setVisible(true);
      else img.setVisible(false);
    }
  }

  private syncPowerups(state: Readonly<GameState>, time: number): void {
    const seen = new Set<string>();
    for (const u of state.powerups) {
      const key = `${u.x},${u.y},${u.type}`;
      seen.add(key);
      let img = this.powerupViews.get(key);
      if (!img) {
        img = this.add.image(cellToScreenX(u.x), cellToScreenY(u.y), TEX.powerup(u.type)).setDepth(DEPTH.powerup);
        this.powerupViews.set(key, img);
      }
      img.y = cellToScreenY(u.y) + Math.sin(time / 200 + u.x) * 2;
    }
    prune(this.powerupViews, seen);
  }

  private syncBombs(state: Readonly<GameState>, time: number): void {
    const seen = new Set<number>();
    for (const b of state.bombs) {
      seen.add(b.id);
      let img = this.bombViews.get(b.id);
      if (!img) {
        img = this.add.image(cellToScreenX(b.x), cellToScreenY(b.y), TEX.bomb).setDepth(DEPTH.bomb);
        this.bombViews.set(b.id, img);
      }
      // Pulses faster as the fuse burns down.
      const rate = 120 + b.fuse * 6;
      img.setScale(1 + Math.sin(time / rate) * 0.08);
    }
    prune(this.bombViews, seen);
  }

  private syncFlames(state: Readonly<GameState>): void {
    const seen = new Set<number>();
    for (const f of state.flames) {
      const key = f.y * state.width + f.x;
      seen.add(key);
      let img = this.flameViews.get(key);
      if (!img) {
        img = this.add.image(cellToScreenX(f.x), cellToScreenY(f.y), TEX.flame).setDepth(DEPTH.flame);
        this.flameViews.set(key, img);
      }
      img.setAlpha(0.5 + 0.5 * Math.min(1, f.ttl / 4));
    }
    prune(this.flameViews, seen);
  }

  private syncPlayers(state: Readonly<GameState>, alpha: number): void {
    const seen = new Set<string>();
    for (const p of Object.values(state.players)) {
      seen.add(p.id);
      let view = this.playerViews.get(p.id);
      if (!view) {
        const body = this.add.image(0, 0, TEX.player(p.slot));
        const label = this.add
          .text(0, 0, p.name, { fontFamily: FONT, fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.label);
        view = { body, label };
        this.playerViews.set(p.id, view);
      }
      const visible = p.alive && state.phase === 'playing';
      view.body.setVisible(visible);
      view.label.setVisible(visible);
      if (!visible) continue;
      const prev = this.prevPos.get(p.id);
      let x = p.x;
      let y = p.y;
      if (prev && Math.abs(prev.x - p.x) + Math.abs(prev.y - p.y) < SUB) {
        x = prev.x + (p.x - prev.x) * alpha;
        y = prev.y + (p.y - prev.y) * alpha;
      }
      const sx = subToScreenX(x);
      const sy = subToScreenY(y);
      view.body.setPosition(sx, sy).setDepth(DEPTH.player + y / (SUB * 100));
      view.label.setPosition(sx, sy - TILE / 2 - 2).setText(p.id === this.transport.playerId ? `${p.name} (tu)` : p.name);
    }
    for (const [id, view] of this.playerViews) {
      if (seen.has(id)) continue;
      view.body.destroy();
      view.label.destroy();
      this.playerViews.delete(id);
    }
  }

  private createHud(): void {
    this.add.text(HUD_X, BOARD_Y, 'Bombe și\nPetarde', { fontFamily: FONT, fontSize: '22px', color: '#ffe066' });
    this.hudInfo = this.add.text(HUD_X, BOARD_Y + 64, '', {
      fontFamily: FONT,
      fontSize: '13px',
      color: '#d0d8f0',
      lineSpacing: 4,
    });
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const y = BOARD_Y + 160 + i * 40;
      const swatch = this.add.rectangle(HUD_X + 7, y + 9, 14, 14, 0xffffff).setVisible(false);
      const text = this.add.text(HUD_X + 20, y, '', {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#ffffff',
        lineSpacing: 2,
        fixedWidth: HUD_W - 20,
      });
      this.hudRows.push({ swatch, text });
    }
    const help = ['Săgeți/WASD: mers', 'Spațiu: petardă'];
    if (this.transport.pausable) help.push('P: pauză');
    this.add.text(HUD_X, BOARD_Y + BOARD_H - help.length * 17, help.join('\n'), {
      fontFamily: FONT,
      fontSize: '12px',
      color: '#7f8bb0',
      lineSpacing: 3,
    });
  }

  private syncHud(state: Readonly<GameState>): void {
    let timer = '';
    if (state.phase === 'playing') {
      const left = SHRINK_START_TICKS - state.roundTick;
      timer = left > 0 ? `Strângere în ${formatTime(left)}` : 'Arena se strânge!';
    }
    this.hudInfo.setText([`Cod: ${state.code}`, `Runda ${Math.max(1, state.round)}/${state.roundsTotal}`, timer].join('\n'));

    const players = sortedPlayers(state);
    this.hudRows.forEach((row, i) => {
      const p = players[i];
      row.swatch.setVisible(!!p);
      row.text.setVisible(!!p);
      if (!p) return;
      const dim = state.phase === 'playing' && !p.alive;
      row.swatch.setFillStyle(PLAYER_COLORS[p.slot]!).setAlpha(dim ? 0.3 : 1);
      const name = p.id === this.transport.playerId ? `${p.name} (tu)` : p.name;
      row.text
        .setText(`${name}\n${p.points} p  ${p.kills}k ${p.wins}w`)
        .setColor(dim ? '#5c6680' : '#ffffff');
    });
  }

  private syncOverlay(state: Readonly<GameState>): void {
    let text = '';
    if (this.transport.isPaused()) {
      text = 'PAUZĂ\n\nP pentru a continua';
    } else if (state.phase === 'intermission') {
      const winner = state.players[state.roundWinner];
      const secs = Math.ceil(state.phaseTimer / TICK_RATE);
      text = `${winner ? `${winner.name} câștigă runda ${state.round}!` : 'Egalitate!'}\n\nRunda următoare în ${secs}...`;
    } else if (state.phase === 'finished') {
      const lines = computeStandings(state).map((id, i) => {
        const p = state.players[id]!;
        return `${i + 1}. ${p.name.padEnd(12)} ${String(p.points).padStart(3)} p`;
      });
      const again = state.hostId === this.transport.playerId ? '\n\nEnter: încă un meci' : '';
      text = `Meci încheiat!\n\n${lines.join('\n')}${again}`;
    } else if (state.phase === 'playing' && state.roundTick < ROUND_BANNER_TICKS) {
      text = `Runda ${state.round}!`;
    }
    this.overlayText.setText(text);
    this.overlayBg.setVisible(text !== '');
    if (text) this.overlayBg.setSize(BOARD_W * 0.6, this.overlayText.height + 40).setOrigin(0.5);
  }
}

function prune<K>(views: Map<K, Phaser.GameObjects.GameObject>, seen: Set<K>): void {
  for (const [key, obj] of views) {
    if (seen.has(key)) continue;
    obj.destroy();
    views.delete(key);
  }
}

function formatTime(ticks: number): string {
  const secs = Math.ceil(ticks / TICK_RATE);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
