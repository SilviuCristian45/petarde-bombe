import Phaser from 'phaser';
import {
  BOMB_SLIDE_TICKS,
  CELL_BRICK,
  CELL_WALL,
  computeStandings,
  COUNTDOWN_TICKS,
  countdownSeconds,
  onlyBotsAlive,
  PLAYER_COLORS,
  POINTS_KILL,
  POINTS_ROUND_WIN,
  POINTS_SUICIDE,
  POWERUP_BOMB,
  POWERUP_CURSE,
  POWERUP_KICK,
  POWERUP_PIERCE,
  POWERUP_RANGE,
  POWERUP_SHIELD,
  POWERUP_SPEED,
  SHRINK_START_TICKS,
  sortedPlayers,
  SUB,
  TICK_MS,
  TICK_RATE,
  type GameEvent,
  type GameState,
} from '@petarde/shared';
import { playSfx } from '../audio/sfx';
import { DebugOverlay } from '../debug/DebugOverlay';
import { isTouch } from '../device';
import { keepScreenOn, vibrate } from '../device-apis';
import { CombinedInput } from '../input/CombinedInput';
import type { InputSource } from '../input/InputSource';
import { KeyboardInput } from '../input/KeyboardInput';
import { TouchInput } from '../input/TouchInput';
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
  SIDE_W,
  subToScreenX,
  subToScreenY,
  TILE,
  TOUCH_LAYOUT,
} from '../render/layout';
import { addSnow, burst } from '../render/fx';
import { addGarlands } from '../render/garlands';
import { ensureTextures, TEX } from '../render/textures';
import { getSetting } from '../settings';
import { load, save } from '../storage';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { textureUrl, useScaleMode } from '../ui/dom';
import { fullscreenOnFirstTap } from '../ui/fullscreen';
import { requireLandscape } from '../ui/orientation';
import { Podium } from '../ui/Podium';
import { notifyPresence } from '../ui/presence';
import { StandingsTable, TABLE_H, TABLE_W } from '../ui/StandingsTable';
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
  /** Ring around a player who carries a shield. */
  aura: Phaser.GameObjects.Arc;
}

/** What each power-up says above the player who takes it. */
const POWERUP_LABELS: Record<number, { text: string; color: string }> = {
  [POWERUP_BOMB]: { text: '+1 petardă', color: '#9bb7ff' },
  [POWERUP_RANGE]: { text: '+1 rază', color: '#ffb347' },
  [POWERUP_SPEED]: { text: 'Viteză!', color: '#7fe3d4' },
  [POWERUP_KICK]: { text: 'Șut!', color: '#e0b48a' },
  [POWERUP_SHIELD]: { text: 'Scut!', color: '#90e0ef' },
  [POWERUP_PIERCE]: { text: 'Foc străpungător!', color: '#ff7070' },
  [POWERUP_CURSE]: { text: 'Mahmureală!', color: '#c77dff' },
};
/** A kicked petard covers one cell per BOMB_SLIDE_TICKS; its image follows at that pace. */
const BOMB_SLIDE_PX_PER_MS = TILE / (BOMB_SLIDE_TICKS * TICK_MS);

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

const DEPTH = {
  snow: -1,
  floor: 0,
  powerup: 1,
  cell: 2,
  garland: 2.5,
  bomb: 3,
  flame: 4,
  player: 5,
  effect: 6,
  label: 7,
  dim: 9,
  popup: 9.5,
  countdown: 9.8,
  overlay: 10,
  standings: 10.2,
  podium: 10.5,
  leave: 10.6, // the leave button stays usable over the podium
  confirm: 11,
} as const;
const FOC_SHOWN_TICKS = Math.round(0.8 * TICK_RATE); // "FOC!" stays a moment after the countdown
const DEATH_BANNER_TICKS = Math.round(2.5 * TICK_RATE); // "Ai murit!", then spectator mode
const DEATH_EFFECT_MS = 1400;
const SCORE_POPUP_MS = 1600;
const CONTROLS_HINT_MS = 6000;
const CONTROLS_HINT_KEY = 'controlsHintSeen';
/** Touch layout: HUD buttons as wide as a side zone and tall enough for a thumb. */
const TOUCH_BUTTON_W = SIDE_W - 24;
const TOUCH_BUTTON_GAP = 12;
/** Touch layout: the HUD starts below the mute / fullscreen icons. */
const TOUCH_HUD_TOP = 70;
const TOUCH_ROW_H = 34;

/** Renders the shared GameState and forwards local input; knows nothing about where the state comes from. */
export class GameScene extends Phaser.Scene {
  private transport!: GameTransport;
  private debugEnabled = false;
  private quick = false;
  private controls!: InputSource;
  private touch?: TouchInput;
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
  private confirmText!: Phaser.GameObjects.Text;
  private confirmParts: Phaser.GameObjects.GameObject[] = [];
  private confirmOpen = false;
  private localDeath?: LocalDeath;
  private countdownRound!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private lastCountdown = -1;
  private standingsParts: Phaser.GameObjects.GameObject[] = [];
  private standings!: StandingsTable;
  private tabKey!: Phaser.Input.Keyboard.Key;
  /** Touch: the "Clasament" button toggles what a held Tab shows. */
  private standingsToggled = false;
  private standingsButton?: TextButton;
  private pauseButton?: TextButton;
  private podium?: Podium;
  /** Touch layout, left-handed: HUD on the left, buttons on the right. */
  private hudX = HUD_X;
  private buttonsX = 10;

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
    this.lastCountdown = -1;
    this.standingsParts = [];
    this.standingsToggled = false;
    this.standingsButton = undefined;
    this.pauseButton = undefined;
    this.touch = undefined;
    this.podium = undefined;
    const leftHanded = TOUCH_LAYOUT && getSetting('leftHanded');
    this.hudX = leftHanded ? 10 : HUD_X;
    this.buttonsX = leftHanded ? HUD_X : 10;
  }

  create(): void {
    ensureTextures(this);
    useScaleMode(this, Phaser.Scale.FIT);
    requireLandscape(this);
    keepScreenOn(this);
    const disarmFullscreen = fullscreenOnFirstTap();
    const state = this.transport.getState();
    // Seen around the board, behind it.
    addSnow(this, DEPTH.snow);

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

    addGarlands(this, DEPTH.garland);
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
    this.createCountdown();
    this.createStandingsOverlay();
    this.createLeaveConfirm();

    const keyboard = new KeyboardInput(this.input.keyboard!);
    if (isTouch) {
      this.touch = new TouchInput({
        joystick: getSetting('joystick'),
        leftHanded: getSetting('leftHanded'),
        bombIcon: textureUrl(this.game, TEX.bomb),
      });
      this.controls = new CombinedInput([keyboard, this.touch]);
    } else {
      this.controls = keyboard;
    }
    // The left-handed layout keeps the mute / fullscreen icons above the HUD.
    document.body.classList.toggle('chrome-left', this.hudX < BOARD_X);
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    this.input.keyboard!.on('keydown-P', () => this.togglePause());
    this.input.keyboard!.on('keydown-ENTER', () => {
      if (this.canSkipRound()) this.transport.send({ type: 'skipRound' });
      else this.restartMatch();
    });
    this.input.keyboard!.on('keydown-ESC', () => this.setConfirm(!this.confirmOpen));
    // Captured so the browser does not move the focus away from the game.
    this.tabKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TAB, true);
    this.unsubscribe = this.transport.onEvents((events) => this.handleEvents(events));
    if (state.phase === 'playing') this.showControlsHint();

    if (this.debugEnabled) this.debug = new DebugOverlay(this);
    this.banner = new ConnectionBanner(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.controls.destroy();
      disarmFullscreen();
      document.body.classList.remove('chrome-left');
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    });
  }

  /**
   * The page went to the background (another app, a locked screen): let go of whatever is held, so
   * the player does not keep walking; offline the match pauses. Online the room carries on and the
   * scene picks up again on return.
   */
  private onHidden(): void {
    this.touch?.releaseAll();
    this.controls.reset();
    this.transport.send({ type: 'input', action: 'stop' });
    if (this.transport.pausable) this.transport.setPaused(true);
  }

  update(time: number, delta: number): void {
    if (!this.banner.update(this.transport, time)) return;
    for (const action of this.controls.poll()) this.transport.send({ type: 'input', action });
    this.transport.update(delta);
    notifyPresence(this.transport);

    const state = this.transport.getState();
    if (state.phase === 'lobby') {
      this.scene.start('lobby', { transport: this.transport });
      return;
    }
    const me = state.players[this.transport.playerId];
    this.touch?.setVisible(state.phase === 'playing' && !!me?.alive && !this.transport.isPaused());
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
    this.syncBombs(state, time, delta);
    this.syncFlames(state);
    this.syncPlayers(state, alpha);
    this.syncHud(state);
    const overlayShown = this.syncOverlay(state);
    this.syncDeathOverlay(state, overlayShown);
    this.syncCountdown(state);
    this.syncStandingsOverlay(state);
    this.syncPodium(state);
    this.debug?.update(state, this.game.loop.actualFps, this.transport.isPaused(), (id) => {
      const view = this.playerViews.get(id);
      return view?.body.visible ? { x: view.body.x, y: view.body.y } : undefined;
    });
  }

  private handleEvents(events: GameEvent[]): void {
    // Points won or lost in this batch, per player (a double kill shows as one "+2").
    const gained = new Map<string, number>();
    const add = (id: string, points: number) => gained.set(id, (gained.get(id) ?? 0) + points);
    const matchWon = events.some((e) => e.type === 'matchEnd');
    for (const e of events) {
      if (e.type === 'explosion') {
        this.cameras.main.shake(120, 0.004);
        playSfx('explozie');
      } else if (e.type === 'bombPlaced') {
        playSfx('petarda');
        playSfx('fitil');
        if (e.owner === this.transport.playerId) vibrate('bomb');
      } else if (e.type === 'pickup') {
        playSfx(e.powerup === POWERUP_CURSE ? 'mahmureala' : 'powerup');
        const label = POWERUP_LABELS[e.powerup];
        if (label) this.showPopup(e.playerId, label.text, label.color, 18);
      } else if (e.type === 'kick') playSfx('sut');
      else if (e.type === 'shieldLost') {
        playSfx('scut');
        this.onShieldLost(e.playerId);
      } else if (e.type === 'matchEnd') playSfx('la-multi-ani');
      else if (e.type === 'death') {
        playSfx('moarte');
        this.onDeath(e);
        if (e.suicide) add(e.playerId, POINTS_SUICIDE);
        else if (e.killerId) add(e.killerId, POINTS_KILL);
      } else if (e.type === 'roundEnd' && e.winnerId) {
        add(e.winnerId, POINTS_ROUND_WIN);
        // The last round's win is drowned by the match fanfare.
        if (!matchWon) playSfx('runda');
      }
      else if (e.type === 'roundStart') {
        this.controls.reset();
        this.showControlsHint();
      }
    }
    for (const [id, points] of gained) if (points !== 0) this.showScorePopup(id, points);
  }

  /** "+1" / "-1" / "+3" rising from where the player is (or was, if they just died). */
  private showScorePopup(playerId: string, points: number): void {
    this.showPopup(playerId, points > 0 ? `+${points}` : `−${-points}`, points > 0 ? '#7cff9b' : '#ff6b81');
  }

  /** A short text rising from where the player is (or was). */
  private showPopup(playerId: string, label: string, color: string, size = 26): void {
    const view = this.playerViews.get(playerId);
    if (!view) return;
    // Starts above the head, but never so high that the rise leaves the board.
    const y = Math.max(view.body.y - TILE * 0.8, BOARD_Y + TILE * 1.2);
    const text = this.add
      .text(view.body.x, y, label, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        fontStyle: 'bold',
        color,
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

  /** The shield bursts: a flash of shards in the shield's color. */
  private onShieldLost(playerId: string): void {
    const view = this.playerViews.get(playerId);
    if (!view?.body.visible) return;
    burst(this, view.body.x, view.body.y, {
      count: 20,
      lifespanMs: 600,
      depth: DEPTH.effect,
      config: {
        speed: { min: 60, max: 180 },
        lifespan: { min: 300, max: 600 },
        scale: { start: 1, end: 0 },
        tint: [0x90e0ef, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
      },
    });
    if (playerId === this.transport.playerId) vibrate('bomb');
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
      vibrate('death');
    }
  }

  /** Firework burst and a puff of smoke in the player's color (both within the particle budget). */
  private playDeathEffect(x: number, y: number, color: number): void {
    burst(this, x, y, {
      count: 48,
      lifespanMs: 1000,
      depth: DEPTH.effect,
      config: {
        speed: { min: 80, max: 240 },
        lifespan: { min: 500, max: 1000 },
        scale: { start: 1.2, end: 0 },
        gravityY: 220,
        tint: [color, color, 0xffffff, 0xffe066],
        blendMode: Phaser.BlendModes.ADD,
      },
    });
    burst(this, x, y, {
      count: 12,
      lifespanMs: DEATH_EFFECT_MS,
      depth: DEPTH.effect - 0.5,
      texture: TEX.smoke,
      config: {
        speed: { min: 8, max: 36 },
        angle: { min: 230, max: 310 },
        lifespan: { min: 900, max: DEATH_EFFECT_MS },
        scale: { start: 0.6, end: 1.8 },
        alpha: { start: 0.7, end: 0 },
        tint: [mixColor(color, 0x555566, 0.5), 0x555566],
      },
    });
    const ring = this.add.circle(x, y, TILE / 2).setStrokeStyle(3, color).setDepth(DEPTH.effect);
    this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 450, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  private togglePause(): void {
    if (this.transport.pausable) this.transport.setPaused(!this.transport.isPaused());
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

  private syncBombs(state: Readonly<GameState>, time: number, delta: number): void {
    const seen = new Set<number>();
    const maxStep = BOMB_SLIDE_PX_PER_MS * delta;
    for (const b of state.bombs) {
      seen.add(b.id);
      const tx = cellToScreenX(b.x);
      const ty = cellToScreenY(b.y);
      let img = this.bombViews.get(b.id);
      if (!img) {
        img = this.add.image(tx, ty, TEX.bomb).setDepth(DEPTH.bomb);
        this.bombViews.set(b.id, img);
      }
      // A kicked petard glides to its cell instead of jumping there.
      img.x += Phaser.Math.Clamp(tx - img.x, -maxStep, maxStep);
      img.y += Phaser.Math.Clamp(ty - img.y, -maxStep, maxStep);
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
          .text(0, 0, p.name, { fontFamily: FONT, fontSize: TOUCH_LAYOUT ? '14px' : '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.label);
        const aura = this.add.circle(0, 0, TILE / 2 + 3).setStrokeStyle(3, 0x90e0ef, 0.9).setFillStyle(0x90e0ef, 0.12);
        view = { body, label, aura };
        this.playerViews.set(p.id, view);
      }
      const visible = p.alive && state.phase === 'playing';
      view.body.setVisible(visible);
      view.label.setVisible(visible);
      view.aura.setVisible(visible && p.shield);
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
      view.aura.setPosition(sx, sy).setDepth(view.body.depth + 0.001);
      // Just saved by the shield: blinking. Cursed ("Mahmureală"): green and wobbly.
      view.body.setAlpha(p.graceTicks > 0 && Math.floor(this.time.now / 80) % 2 === 0 ? 0.35 : 1);
      if (p.curseTicks > 0) view.body.setTint(0xb5e48c).setRotation(Math.sin(this.time.now / 120) * 0.25);
      else view.body.clearTint().setRotation(0);
      view.label.setPosition(sx, sy - TILE / 2 - 2).setText(p.id === this.transport.playerId ? `${p.name} (tu)` : p.name);
    }
    for (const [id, view] of this.playerViews) {
      if (seen.has(id)) continue;
      view.body.destroy();
      view.label.destroy();
      view.aura.destroy();
      this.playerViews.delete(id);
    }
  }

  private createHud(): void {
    if (TOUCH_LAYOUT) {
      this.createTouchHud();
      return;
    }
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
    // Leaving is offered in every phase, alive or not; Esc does the same.
    const leave = new TextButton(this, HUD_X, BOARD_Y + BOARD_H, 'Ieși (Esc)', () => this.setConfirm(true), 'secondary', 12);
    leave.setOrigin(0, 1).setDepth(DEPTH.leave);
    const help = ['Săgeți/WASD: mers', 'Spațiu: petardă'];
    if (this.transport.pausable) help.push('P: pauză');
    this.add.text(HUD_X, leave.y - leave.height - 10 - help.length * 17, help.join('\n'), {
      fontFamily: FONT,
      fontSize: '12px',
      color: '#7f8bb0',
      lineSpacing: 3,
    });
  }

  /**
   * Touch layout: round info and a compact player list in one side zone (above the petard button),
   * thumb-sized buttons for what the keys do on a desktop in the other (above the D-pad).
   */
  private createTouchHud(): void {
    const x = this.hudX;
    this.hudInfo = this.add.text(x, TOUCH_HUD_TOP, '', { fontFamily: FONT, fontSize: '18px', color: '#d0d8f0', lineSpacing: 4 });
    const style = { fontFamily: FONT, fontSize: '18px', color: '#ffffff' };
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const y = TOUCH_HUD_TOP + 58 + i * TOUCH_ROW_H;
      const swatch = this.add.rectangle(x + 7, y + 11, 14, 14, 0xffffff).setVisible(false);
      const name = this.add.text(x + 22, y, '', style);
      const stats = this.add.text(x + HUD_W, y, '', style).setOrigin(1, 0);
      const strike = this.add.rectangle(x + 20, y + 11, 1, 2, 0xff6b81).setOrigin(0, 0.5).setVisible(false);
      this.hudRows.push({ swatch, name, stats, strike });
    }

    let y = 12;
    const addButton = (label: string, onClick: () => void): TextButton => {
      const b = new TextButton(this, this.buttonsX, y, label, onClick, 'secondary', 20).setOrigin(0, 0).setWidth(TOUCH_BUTTON_W, 18);
      y += b.height + TOUCH_BUTTON_GAP;
      return b;
    };
    // Esc, Tab and P on a desktop. Leaving stays possible over the podium too.
    addButton('Ieși', () => this.setConfirm(true)).setDepth(DEPTH.leave);
    this.standingsButton = addButton('Clasament', () => (this.standingsToggled = !this.standingsToggled));
    if (this.transport.pausable) this.pauseButton = addButton('Pauză', () => this.togglePause());
  }

  private syncHud(state: Readonly<GameState>): void {
    let timer = '';
    if (state.phase === 'playing') {
      // The countdown is not part of the two minutes.
      const left = Math.min(SHRINK_START_TICKS - state.roundTick, SHRINK_START_TICKS - COUNTDOWN_TICKS);
      timer = left > 0 ? `Strângere în ${formatTime(left)}` : 'Arena se strânge!';
    }
    const where = this.transport.online ? `Cod: ${state.code}` : 'Joc offline';
    const round = `Runda ${Math.max(1, state.round)}/${state.roundsTotal}`;
    this.hudInfo.setText((TOUCH_LAYOUT ? [round, timer] : [where, round, timer]).join('\n'));
    this.syncTouchButtons(state);

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
      if (TOUCH_LAYOUT) {
        // One line per player: the name (yours in yellow) and the points; the rest is under "Clasament".
        const mine = p.id === this.transport.playerId;
        const color = dead ? '#5c6680' : mine ? '#ffe066' : p.left || !p.connected ? '#7f8bb0' : '#ffffff';
        row.name.setText(fit(p.name, 11)).setColor(color);
        row.stats.setText(`${p.points}p`).setColor(dead ? '#5c6680' : '#ffffff');
        if (dead) row.strike.setSize(row.name.width + 4, 2);
        return;
      }
      const tag = p.id === this.transport.playerId ? ' (tu)' : p.left ? ' (a ieșit)' : !p.connected ? ' (...)' : '';
      const name = p.name + tag;
      row.name.setText(name).setColor(dead ? '#5c6680' : '#ffffff');
      row.stats.setText(`${p.points} p  ${p.kills}k ${p.wins}w`).setColor(dead ? '#5c6680' : '#ffffff');
      if (dead) row.strike.setSize(Math.min(row.name.width, HUD_W - 20) + 4, 2);
    });
  }

  /** Touch: the pause button reads "Continuă" while paused; neither it nor "Clasament" is needed on the podium. */
  private syncTouchButtons(state: Readonly<GameState>): void {
    const finished = state.phase === 'finished';
    if (finished) this.standingsToggled = false;
    this.standingsButton?.setVisible(!finished).setVariant(this.standingsToggled ? 'primary' : 'secondary');
    const paused = this.transport.isPaused();
    this.pauseButton?.setVisible(!finished).setText(paused ? 'Continuă' : 'Pauză').setVariant(paused ? 'primary' : 'secondary');
  }

  /** Draws the main banner (pause, round results...). Returns whether it is showing. */
  private syncOverlay(state: Readonly<GameState>): boolean {
    let text = '';
    if (this.transport.isPaused()) {
      text = TOUCH_LAYOUT ? 'PAUZĂ\n\nApasă Continuă' : 'PAUZĂ\n\nP pentru a continua';
    } else if (state.phase === 'intermission') {
      const winner = state.players[state.roundWinner];
      const secs = Math.ceil(state.phaseTimer / TICK_RATE);
      const title = winner ? `${winner.name} câștigă runda ${state.round}!` : 'Egalitate!';
      text = `${title}\n\n${standingsLines(state).join('\n')}\n\nRunda ${state.round + 1} în ${secs}...`;
    }
    // The countdown and the final podium have their own displays.
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
        fontSize: TOUCH_LAYOUT ? '18px' : '14px',
        color: '#d0d8f0',
        backgroundColor: '#0b1026cc',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    this.skipButton = this.add
      .text(cx, BOARD_Y + (TOUCH_LAYOUT ? 48 : 40), TOUCH_LAYOUT ? 'Sari peste rundă' : 'Enter: sari peste rundă', {
        fontFamily: FONT,
        fontSize: TOUCH_LAYOUT ? '22px' : '14px',
        color: '#0b1026',
        backgroundColor: '#ffe066',
        padding: TOUCH_LAYOUT ? { x: 22, y: 14 } : { x: 10, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.overlay)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (this.canSkipRound()) this.transport.send({ type: 'skipRound' });
      });
  }

  /** "Runda N" and a big "3, 2, 1, FOC!" over the board at the start of every round. */
  private createCountdown(): void {
    const cx = BOARD_X + BOARD_W / 2;
    const cy = BOARD_Y + BOARD_H / 2;
    this.countdownRound = this.add
      .text(cx, cy - 78, '', { fontFamily: FONT, fontSize: '24px', color: '#eaf2ff', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(DEPTH.countdown)
      .setVisible(false);
    this.countdownText = this.add
      .text(cx, cy, '', { fontFamily: FONT, fontSize: '96px', fontStyle: 'bold', color: '#ffe066', stroke: '#7a1f2b', strokeThickness: 10 })
      .setOrigin(0.5)
      .setDepth(DEPTH.countdown)
      .setVisible(false);
  }

  private syncCountdown(state: Readonly<GameState>): void {
    const running = state.phase === 'playing' && !this.transport.isPaused() && state.roundTick < COUNTDOWN_TICKS + FOC_SHOWN_TICKS;
    this.countdownRound.setVisible(running);
    this.countdownText.setVisible(running);
    if (!running) {
      this.lastCountdown = -1;
      return;
    }
    const value = countdownSeconds(state.roundTick);
    if (value === this.lastCountdown) return;
    this.lastCountdown = value;
    this.countdownRound.setText(`Runda ${state.round}`);
    this.countdownText.setText(value > 0 ? String(value) : 'FOC!').setColor(value > 0 ? '#ffe066' : '#ff4d6d');
    this.tweens.add({ targets: this.countdownText, scale: { from: 1.7, to: 1 }, alpha: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    playSfx(value > 0 ? 'numaratoare' : 'foc');
  }

  /** Held Tab: the match standings over the board. */
  private createStandingsOverlay(): void {
    const cx = BOARD_X + BOARD_W / 2;
    const cy = BOARD_Y + BOARD_H / 2;
    const bg = this.add
      .rectangle(cx, cy, TABLE_W + 60, TABLE_H + 80, 0x0b1026, 0.93)
      .setStrokeStyle(2, 0xffe066)
      .setDepth(DEPTH.standings);
    const title = this.add
      .text(cx, cy - TABLE_H / 2 - 22, 'Clasament', { fontFamily: FONT, fontSize: '20px', color: '#ffe066' })
      .setOrigin(0.5)
      .setDepth(DEPTH.standings);
    this.standings = new StandingsTable(this, cx - TABLE_W / 2, cy - TABLE_H / 2 + 6);
    this.standings.container.setDepth(DEPTH.standings);
    this.standingsParts = [bg, title, this.standings.container];
    // Touch: opened with the button, closed with it or with a tap on the table.
    if (TOUCH_LAYOUT) bg.setInteractive().on('pointerdown', () => (this.standingsToggled = false));
    for (const part of this.standingsParts) (part as Phaser.GameObjects.Rectangle).setVisible(false);
  }

  private syncStandingsOverlay(state: Readonly<GameState>): void {
    const show = (this.tabKey.isDown || this.standingsToggled) && state.phase !== 'finished';
    for (const part of this.standingsParts) (part as Phaser.GameObjects.Rectangle).setVisible(show);
    if (show) this.standings.update(state, this.transport.playerId, state.phase === 'playing' || state.phase === 'intermission');
  }

  /** The podium takes over the screen once the match is over. */
  private syncPodium(state: Readonly<GameState>): void {
    if (state.phase !== 'finished') {
      this.podium?.destroy();
      this.podium = undefined;
      return;
    }
    if (this.podium) {
      this.podium.update(state, this.transport.newRecords());
      return;
    }
    this.podium = new Podium(this, state, {
      me: this.transport.playerId,
      online: this.transport.online,
      depth: DEPTH.podium,
      onAgain: () => this.restartMatch(),
      againLabel: TOUCH_LAYOUT ? 'Încă un meci' : 'Încă un meci (Enter)',
    });
  }

  /** "Sigur ieși?" before leaving a match for good. */
  private createLeaveConfirm(): void {
    const cx = BOARD_X + BOARD_W / 2;
    const cy = BOARD_Y + BOARD_H / 2;
    const depth = DEPTH.confirm;
    const bg = this.add.rectangle(cx, cy, 460, 170, 0x0b1026, 0.95).setStrokeStyle(2, 0xff8fa3).setDepth(depth);
    this.confirmText = this.add
      .text(cx, cy - 38, '', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(depth);
    const size = TOUCH_LAYOUT ? 24 : 18;
    const yes = new TextButton(this, cx - 100, cy + 42, 'Da, ieși', () => this.leaveMatch(), 'secondary', size).setDepth(depth);
    const no = new TextButton(this, cx + 100, cy + 42, 'Rămân', () => this.setConfirm(false), 'primary', size).setDepth(depth);
    if (TOUCH_LAYOUT) for (const b of [yes, no]) b.setPadding(22, 14);
    this.confirmParts = [bg, this.confirmText, yes, no];
    this.setConfirm(false);
  }

  private setConfirm(open: boolean): void {
    if (open) this.confirmText.setText(this.leaveWarning());
    this.confirmOpen = open;
    for (const part of this.confirmParts) (part as Phaser.GameObjects.Text).setVisible(open);
  }

  private leaveWarning(): string {
    const state = this.transport.getState();
    const me = state.players[this.transport.playerId];
    if (state.phase === 'playing' && me?.alive) return 'Sigur ieși? Pierzi runda.';
    if (!this.transport.online) return 'Sigur ieși?\nMeciul offline se încheie.';
    return 'Sigur ieși?\nRămâi în clasament ca „a ieșit”.';
  }

  /**
   * For good: a consented leave and no reconnection token. Online the server then applies leavePlayer
   * (dead without a kill, "a ieșit" until the lobby, host handed over); offline the game just ends.
   */
  private leaveMatch(): void {
    this.transport.dispose();
    this.scene.start('menu', {});
  }

  /** The very first round on this device: a few seconds of key reminders at the bottom. */
  private showControlsHint(): void {
    if (load(CONTROLS_HINT_KEY) === '1') return;
    save(CONTROLS_HINT_KEY, '1');
    const hint = this.add
      .text(BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H - 14, controlsHint(), {
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
    this.spectatorText.setVisible(spectating);
    if (spectating) this.spectatorText.setText(`Mod spectator · ${deathCause(state, death)}`);
    const skip = spectating && this.canSkipRound();
    this.skipButton.setVisible(skip);
  }
}

function controlsHint(): string {
  if (!isTouch) return 'Săgeți / WASD = mișcare  ·  Spațiu = petardă';
  return getSetting('leftHanded') ? 'Dreapta = mișcare  ·  Stânga = petardă' : 'Stânga = mișcare  ·  Dreapta = petardă';
}

/** Cuts a name to `max` characters with an ellipsis. */
function fit(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
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
