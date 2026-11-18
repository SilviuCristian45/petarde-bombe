import Phaser from 'phaser';
import {
  CELL_BRICK,
  CELL_WALL,
  computeStandings,
  onlyBotsAlive,
  PLAYER_COLORS,
  POINTS_KILL,
  POINTS_ROUND_WIN,
  POINTS_SUICIDE,
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
import { ensureTextures, TEX } from '../render/textures';
import { load, save } from '../storage';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { TextButton } from '../ui/TextButton';

export interface GameSceneData {
  transport: GameTransport;
  debug: boolean;
  /** Debug URL start: Enter after the match restarts it at once instead of going back to the lobby. */
  quick: boolean;
}

interface PlayerView {
  body: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

interface HudRow {
  swatch: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  stats: Phaser.GameObjects.Text;
  strike: Phaser.GameObjects.Rectangle;
}

interface LocalDeath {
  killerId: string;
  suicide: boolean;
  tick: number;
}

const DEPTH = { floor: 0, powerup: 1, cell: 2, bomb: 3, flame: 4, player: 5, effect: 6, label: 7, dim: 9, popup: 9.5, overlay: 10 } as const;
const ROUND_BANNER_TICKS = TICK_RATE; // "Runda N!" shown for 1 s
const DEATH_BANNER_TICKS = Math.round(2.5 * TICK_RATE); // "Ai murit!", then spectator mode
const DEATH_EFFECT_MS = 1400;
const SCORE_POPUP_MS = 1600;
const CONTROLS_HINT_MS = 6000;
const CONTROLS_HINT_KEY = 'controlsHintSeen';

/** Renders the shared GameState and forwards local input; knows nothing about where the state comes from. */
export class GameScene extends Phaser.Scene {
  private transport!: GameTransport;
  private debugEnabled = false;
  private quick = false;
  private controls!: InputSource;
  private debug?: DebugOverlay;
  private unsubscribe?: () => void;
  private banner!: ConnectionBanner;

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
  private boardDim!: Phaser.GameObjects.Rectangle;
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayText!: Phaser.GameObjects.Text;
  private deathBg!: Phaser.GameObjects.Rectangle;
  private deathTitle!: Phaser.GameObjects.Text;
  private deathCause!: Phaser.GameObjects.Text;
  private spectatorText!: Phaser.GameObjects.Text;
  private skipButton!: Phaser.GameObjects.Text;
  private leaveButton!: Phaser.GameObjects.Text;
  private confirmParts: Phaser.GameObjects.GameObject[] = [];
  private confirmOpen = false;
  private spectating = false;
  private localDeath?: LocalDeath;

  constructor() {
    super('game');
  }

  init(data: GameSceneData): void {
    this.transport = data.transport;
    this.debugEnabled = data.debug;
    this.quick = data.quick;
    // Phaser reuses the scene instance on every start: forget the previous match's views.
    this.debug = undefined;
    this.cellImages = [];
    this.cellTypes = [];
    this.hudRows = [];
    for (const views of [this.bombViews, this.flameViews, this.powerupViews, this.playerViews, this.prevPos, this.curPos]) {
      views.clear();
    }
    this.lastTick = -1;
    this.localDeath = undefined;
    this.confirmParts = [];
    this.confirmOpen = false;
    this.spectating = false;
  }

  create(): void {
    ensureTextures(this);
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
    // Between rounds the next map is already laid out; it is shown dimmed under the scores.
    this.boardDim = this.add
      .rectangle(BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2, BOARD_W, BOARD_H, 0x0b1026, 0.65)
      .setDepth(DEPTH.dim)
      .setVisible(false);
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
    this.createDeathOverlay();
    this.createLeaveConfirm();

    this.controls = new KeyboardInput(this.input.keyboard!);
    this.input.keyboard!.on('keydown-P', () => {
      if (this.transport.pausable) this.transport.setPaused(!this.transport.isPaused());
    });
    this.input.keyboard!.on('keydown-ENTER', () => {
      if (this.canSkipRound()) this.transport.send({ type: 'skipRound' });
      else this.restartMatch();
    });
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.confirmOpen) this.setConfirm(false);
      else if (this.spectating) this.setConfirm(true);
    });
    this.unsubscribe = this.transport.onEvents((events) => this.handleEvents(events));
    if (state.phase === 'playing') this.showControlsHint();

    if (this.debugEnabled) this.debug = new DebugOverlay(this);
    this.banner = new ConnectionBanner(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.controls.destroy();
    });
  }

  update(time: number, delta: number): void {
    if (!this.banner.update(this.transport, time)) return;
    for (const action of this.controls.poll()) this.transport.send({ type: 'input', action });
    this.transport.update(delta);

    const state = this.transport.getState();
    if (state.phase === 'lobby') {
      this.scene.start('lobby', { transport: this.transport });
      return;
    }
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
    const overlayShown = this.syncOverlay(state);
    this.syncDeathOverlay(state, overlayShown);
    this.debug?.update(state, this.game.loop.actualFps, this.transport.isPaused(), (id) => {
      const view = this.playerViews.get(id);
      return view?.body.visible ? { x: view.body.x, y: view.body.y } : undefined;
    });
  }

  private handleEvents(events: GameEvent[]): void {
    // Points won or lost in this batch, per player (a double kill shows as one "+2").
    const gained = new Map<string, number>();
    const add = (id: string, points: number) => gained.set(id, (gained.get(id) ?? 0) + points);
    for (const e of events) {
      if (e.type === 'explosion') this.cameras.main.shake(120, 0.004);
      else if (e.type === 'death') {
        this.onDeath(e);
        if (e.suicide) add(e.playerId, POINTS_SUICIDE);
        else if (e.killerId) add(e.killerId, POINTS_KILL);
      } else if (e.type === 'roundEnd' && e.winnerId) add(e.winnerId, POINTS_ROUND_WIN);
      else if (e.type === 'roundStart') {
        this.controls.reset();
        this.showControlsHint();
      }
    }
    for (const [id, points] of gained) if (points !== 0) this.showScorePopup(id, points);
  }

  /** "+1" / "-1" / "+3" rising from where the player is (or was, if they just died). */
  private showScorePopup(playerId: string, points: number): void {
    const view = this.playerViews.get(playerId);
    if (!view) return;
    const label = points > 0 ? `+${points}` : `−${-points}`;
    // Starts above the head, but never so high that the rise leaves the board.
    const y = Math.max(view.body.y - TILE * 0.8, BOARD_Y + TILE * 1.2);
    const text = this.add
      .text(view.body.x, y, label, {
        fontFamily: FONT,
        fontSize: '26px',
        fontStyle: 'bold',
        color: points > 0 ? '#7cff9b' : '#ff6b81',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.popup);
    this.tweens.add({
      targets: text,
      y: y - TILE * 0.8,
      alpha: { from: 1, to: 0 },
      scale: { from: 1.3, to: 1 },
      duration: SCORE_POPUP_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  private onDeath(e: Extract<GameEvent, { type: 'death' }>): void {
    const state = this.transport.getState();
    const p = state.players[e.playerId];
    const view = this.playerViews.get(e.playerId);
    // Events arrive before syncPlayers hides the body, so it still sits where the player died.
    if (p && view?.body.visible) this.playDeathEffect(view.body.x, view.body.y, PLAYER_COLORS[p.slot]!);
    if (e.playerId === this.transport.playerId) {
      this.localDeath = { killerId: e.killerId, suicide: e.suicide, tick: state.tick };
      this.cameras.main.shake(300, 0.012);
    }
  }

  /** Firework burst and a puff of smoke in the player's color. */
  private playDeathEffect(x: number, y: number, color: number): void {
    const sparks = this.add
      .particles(x, y, TEX.spark, {
        speed: { min: 80, max: 240 },
        lifespan: { min: 500, max: 1000 },
        scale: { start: 1.2, end: 0 },
        gravityY: 220,
        tint: [color, color, 0xffffff, 0xffe066],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(DEPTH.effect);
    sparks.explode(48);
    const smoke = this.add
      .particles(x, y, TEX.smoke, {
        speed: { min: 8, max: 36 },
        angle: { min: 230, max: 310 },
        lifespan: { min: 900, max: DEATH_EFFECT_MS },
        scale: { start: 0.6, end: 1.8 },
        alpha: { start: 0.7, end: 0 },
        tint: [mixColor(color, 0x555566, 0.5), 0x555566],
        emitting: false,
      })
      .setDepth(DEPTH.effect - 0.5);
    smoke.explode(12);
    const ring = this.add.circle(x, y, TILE / 2).setStrokeStyle(3, color).setDepth(DEPTH.effect);
    this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 450, ease: 'Cubic.easeOut' });
    this.time.delayedCall(DEATH_EFFECT_MS, () => {
      sparks.destroy();
      smoke.destroy();
      ring.destroy();
    });
  }

  /** Only the host may fast-forward, and only once every human is dead (the server checks it too). */
  private canSkipRound(): boolean {
    const state = this.transport.getState();
    return state.hostId === this.transport.playerId && onlyBotsAlive(state);
  }

  private restartMatch(): void {
    const state = this.transport.getState();
    if (state.phase !== 'finished' || state.hostId !== this.transport.playerId) return;
    // Back in the lobby phase, update() hands over to the lobby scene; quick mode starts again right away.
    this.transport.send({ type: 'lobby' });
    if (this.quick) this.transport.send({ type: 'start' });
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
    this.add.text(HUD_X, BOARD_Y, 'Bombe și\nPetarde', { fontFamily: FONT, fontSize: '20px', color: '#ffe066' });
    this.hudInfo = this.add.text(HUD_X, BOARD_Y + 64, '', {
      fontFamily: FONT,
      fontSize: '13px',
      color: '#d0d8f0',
      lineSpacing: 4,
    });
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const y = BOARD_Y + 160 + i * 40;
      const swatch = this.add.rectangle(HUD_X + 7, y + 9, 14, 14, 0xffffff).setVisible(false);
      const style = { fontFamily: FONT, fontSize: '13px', color: '#ffffff' };
      const name = this.add.text(HUD_X + 20, y, '', style);
      const stats = this.add.text(HUD_X + 20, y + 17, '', { ...style, fixedWidth: HUD_W - 20 });
      const strike = this.add.rectangle(HUD_X + 18, y + 9, 1, 2, 0xff6b81).setOrigin(0, 0.5).setVisible(false);
      this.hudRows.push({ swatch, name, stats, strike });
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
    const where = this.transport.online ? `Cod: ${state.code}` : 'Joc offline';
    this.hudInfo.setText([where, `Runda ${Math.max(1, state.round)}/${state.roundsTotal}`, timer].join('\n'));

    const players = sortedPlayers(state);
    // Dead players stay crossed out until the next round starts.
    const inRound = state.phase === 'playing' || state.phase === 'intermission';
    this.hudRows.forEach((row, i) => {
      const p = players[i];
      row.swatch.setVisible(!!p);
      row.name.setVisible(!!p);
      row.stats.setVisible(!!p);
      const dead = !!p && inRound && !p.alive;
      row.strike.setVisible(dead);
      if (!p) return;
      row.swatch.setFillStyle(PLAYER_COLORS[p.slot]!).setAlpha(dead ? 0.3 : 1);
      const tag = p.id === this.transport.playerId ? ' (tu)' : p.left ? ' (a ieșit)' : !p.connected ? ' (...)' : '';
      const name = p.name + tag;
      row.name.setText(name).setColor(dead ? '#5c6680' : '#ffffff');
      row.stats.setText(`${p.points} p  ${p.kills}k ${p.wins}w`).setColor(dead ? '#5c6680' : '#ffffff');
      if (dead) row.strike.setSize(Math.min(row.name.width, HUD_W - 20) + 4, 2);
    });
  }

  /** Draws the main banner (pause, round results...). Returns whether it is showing. */
  private syncOverlay(state: Readonly<GameState>): boolean {
    let text = '';
    if (this.transport.isPaused()) {
      text = 'PAUZĂ\n\nP pentru a continua';
    } else if (state.phase === 'intermission') {
      const winner = state.players[state.roundWinner];
      const secs = Math.ceil(state.phaseTimer / TICK_RATE);
      const title = winner ? `${winner.name} câștigă runda ${state.round}!` : 'Egalitate!';
      text = `${title}\n\n${standingsLines(state).join('\n')}\n\nRunda ${state.round + 1} în ${secs}...`;
    } else if (state.phase === 'finished') {
      const again =
        state.hostId === this.transport.playerId
          ? `\n\nEnter: ${this.quick ? 'încă un meci' : 'înapoi în lobby'}`
          : '\n\nHostul vă duce înapoi în lobby.';
      text = `Meci încheiat!\n\n${standingsLines(state).join('\n')}${again}`;
    } else if (state.phase === 'playing' && state.roundTick < ROUND_BANNER_TICKS) {
      text = `Runda ${state.round}!`;
    }
    this.boardDim.setVisible(state.phase === 'intermission');
    this.overlayText.setText(text);
    this.overlayBg.setVisible(text !== '');
    if (text) this.overlayBg.setSize(BOARD_W * 0.6, this.overlayText.height + 40).setOrigin(0.5);
    return text !== '';
  }

  private createDeathOverlay(): void {
    const cx = BOARD_X + BOARD_W / 2;
    const cy = BOARD_Y + BOARD_H / 2;
    this.deathBg = this.add
      .rectangle(cx, cy, BOARD_W * 0.6, 150, 0x1a0710, 0.85)
      .setStrokeStyle(3, 0xff4d6d)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    this.deathTitle = this.add
      .text(cx, cy - 22, 'Ai murit!', { fontFamily: FONT, fontSize: '48px', color: '#ff4d6d', stroke: '#000000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    this.deathCause = this.add
      .text(cx, cy + 34, '', { fontFamily: FONT, fontSize: '20px', color: '#ffe066' })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    this.spectatorText = this.add
      .text(cx, BOARD_Y + 8, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#d0d8f0',
        backgroundColor: '#0b1026cc',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    this.skipButton = this.add
      .text(cx, BOARD_Y + 40, 'Enter: sari peste rundă', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#0b1026',
        backgroundColor: '#ffe066',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.overlay)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (this.canSkipRound()) this.transport.send({ type: 'skipRound' });
      });
    this.leaveButton = this.add
      .text(cx, BOARD_Y + 40, 'Esc: părăsește meciul', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#eaf2ff',
        backgroundColor: '#7a1f2b',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.overlay)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.setConfirm(true));
  }

  /** "Sigur ieși?" before leaving a match for good. */
  private createLeaveConfirm(): void {
    const cx = BOARD_X + BOARD_W / 2;
    const cy = BOARD_Y + BOARD_H / 2;
    const depth = DEPTH.overlay + 1;
    const bg = this.add.rectangle(cx, cy, 460, 170, 0x0b1026, 0.95).setStrokeStyle(2, 0xff8fa3).setDepth(depth);
    const text = this.add
      .text(cx, cy - 38, 'Sigur ieși?\nRămâi în clasament ca „a ieșit”.', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(depth);
    const yes = new TextButton(this, cx - 90, cy + 42, 'Da, ies', () => this.leaveMatch(), 'secondary', 18).setDepth(depth);
    const no = new TextButton(this, cx + 90, cy + 42, 'Rămân', () => this.setConfirm(false), 'primary', 18).setDepth(depth);
    this.confirmParts = [bg, text, yes, no];
    this.setConfirm(false);
  }

  private setConfirm(open: boolean): void {
    this.confirmOpen = open;
    for (const part of this.confirmParts) (part as Phaser.GameObjects.Text).setVisible(open);
  }

  /** Online the server then applies leavePlayer (dead, "a ieșit", host handed over); offline the game just ends. */
  private leaveMatch(): void {
    this.transport.dispose();
    this.scene.start('menu', {});
  }

  /** The very first round on this device: a few seconds of key reminders at the bottom. */
  private showControlsHint(): void {
    if (load(CONTROLS_HINT_KEY) === '1') return;
    save(CONTROLS_HINT_KEY, '1');
    const hint = this.add
      .text(BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H - 14, 'Săgeți / WASD = mișcare  ·  Spațiu = petardă', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#0b1026',
        backgroundColor: '#ffe066',
        padding: { x: 14, y: 7 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.overlay);
    this.tweens.add({ targets: hint, alpha: 0, delay: CONTROLS_HINT_MS, duration: 600, onComplete: () => hint.destroy() });
  }

  /** "Ai murit!" with the cause for a moment, then a spectator banner until the round ends. */
  private syncDeathOverlay(state: Readonly<GameState>, overlayShown: boolean): void {
    const me = state.players[this.transport.playerId];
    if (!me || me.alive || state.phase !== 'playing') this.localDeath = undefined;
    const death = this.localDeath;
    const big = !!death && !overlayShown && state.tick - death.tick < DEATH_BANNER_TICKS;
    this.deathBg.setVisible(big);
    this.deathTitle.setVisible(big);
    this.deathCause.setVisible(big);
    if (death && big) this.deathCause.setText(death.suicide ? `${deathCause(state, death)} (${POINTS_SUICIDE} punct)` : deathCause(state, death));

    const spectating = !!death && !big;
    // Esc works from the moment of death; the button waits for the spectator band.
    this.spectating = !!death;
    this.spectatorText.setVisible(spectating);
    if (spectating) this.spectatorText.setText(`Mod spectator · ${deathCause(state, death)}`);
    const skip = spectating && this.canSkipRound();
    this.skipButton.setVisible(skip).setX(BOARD_X + BOARD_W / 2 - (skip ? 120 : 0));
    this.leaveButton.setVisible(spectating).setX(BOARD_X + BOARD_W / 2 + (skip ? 120 : 0));
  }
}

function standingsLines(state: Readonly<GameState>): string[] {
  return computeStandings(state).map((id, i) => {
    const p = state.players[id]!;
    return `${i + 1}. ${p.name.padEnd(12)} ${String(p.points).padStart(3)} p`;
  });
}

function deathCause(state: Readonly<GameState>, death: LocalDeath): string {
  if (death.suicide) return 'de propria petardă';
  if (!death.killerId) return 'strivit de arenă';
  const killer = state.players[death.killerId];
  return killer ? `de ${killer.name}` : 'de o petardă rătăcită';
}

/** Linear blend of two 0xRRGGBB colors. */
function mixColor(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t) << shift;
  return ch(16) | ch(8) | ch(0);
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
