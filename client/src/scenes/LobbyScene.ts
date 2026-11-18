import Phaser from 'phaser';
import {
  canStart,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  POINTS_KILL,
  POINTS_ROUND_WIN,
  POINTS_SUICIDE,
  ROUND_OPTIONS,
  sortedPlayers,
  type GameState,
} from '@petarde/shared';
import type { GameTransport } from '../net/GameTransport';
import { FONT, GAME_H, GAME_W } from '../render/layout';
import { ensureTextures, TEX } from '../render/textures';
import { drawBackdrop } from '../ui/backdrop';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { TextButton } from '../ui/TextButton';
import type { GameSceneData } from './GameScene';

export interface LobbySceneData {
  transport: GameTransport;
}

interface PlayerRow {
  avatar: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  crown: Phaser.GameObjects.Image;
}

const LIST_X = 150; // avatar column
const LIST_Y = 210;
const ROW_H = 44;
const SIDE_X = 700; // settings column center
const COPIED_MS = 1500;

/** Room code and invite link, the players, and the host's round count / bots / Start. */
export class LobbyScene extends Phaser.Scene {
  private transport!: GameTransport;
  private rows: PlayerRow[] = [];
  private roundButtons: TextButton[] = [];
  private addBotButton!: TextButton;
  private removeBotButton!: TextButton;
  private startButton!: TextButton;
  private copyButton!: TextButton;
  private copyReset?: Phaser.Time.TimerEvent;
  private hint!: Phaser.GameObjects.Text;
  private countText!: Phaser.GameObjects.Text;
  private banner!: ConnectionBanner;

  constructor() {
    super('lobby');
  }

  init(data: LobbySceneData): void {
    this.transport = data.transport;
    this.rows = [];
    this.roundButtons = [];
    this.copyReset = undefined;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    const state = this.transport.getState();

    // An offline room has no code worth sharing: nobody else can join it.
    const online = this.transport.online;
    this.add
      .text(GAME_W / 2, 34, online ? 'Codul room-ului' : 'Joc offline', { fontFamily: FONT, fontSize: '16px', color: '#d0d8f0' })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 80, online ? state.code : 'cu boți', {
        fontFamily: FONT,
        fontSize: '56px',
        color: '#ffe066',
        stroke: '#7a1f2b',
        strokeThickness: 6,
        letterSpacing: 8,
      })
      .setOrigin(0.5);
    this.copyButton = new TextButton(this, GAME_W / 2, 140, 'Copiază link', () => void this.copyLink(), 'secondary', 16).setVisible(online);

    this.countText = this.add.text(LIST_X - 20, LIST_Y - 40, '', { fontFamily: FONT, fontSize: '16px', color: '#d0d8f0' });
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const y = LIST_Y + i * ROW_H;
      this.add.rectangle(LIST_X + 150, y, 360, ROW_H - 6, 0x13203d, 0.8).setStrokeStyle(1, 0x24365e);
      const avatar = this.add.image(LIST_X, y, TEX.player(0)).setScale(0.85);
      const name = this.add.text(LIST_X + 30, y, '', { fontFamily: FONT, fontSize: '18px', color: '#ffffff' }).setOrigin(0, 0.5);
      const crown = this.add.image(0, y - 1, TEX.crown).setOrigin(0, 0.5);
      this.rows.push({ avatar, name, crown });
    }

    this.add.text(SIDE_X, LIST_Y - 30, 'Runde', { fontFamily: FONT, fontSize: '16px', color: '#d0d8f0' }).setOrigin(0.5);
    ROUND_OPTIONS.forEach((rounds, i) => {
      const x = SIDE_X + (i - 1) * 64;
      this.roundButtons.push(
        new TextButton(this, x, LIST_Y + 10, String(rounds), () => this.transport.send({ type: 'rounds', rounds }), 'secondary', 20),
      );
    });
    this.addBotButton = new TextButton(this, SIDE_X - 54, LIST_Y + 80, '+Bot', () => this.transport.send({ type: 'addBot' }));
    this.removeBotButton = new TextButton(this, SIDE_X + 54, LIST_Y + 80, '-Bot', () => this.transport.send({ type: 'removeBot' }));
    this.startButton = new TextButton(this, SIDE_X, LIST_Y + 160, 'Start', () => this.transport.send({ type: 'start' }), 'primary', 26);
    this.hint = this.add
      .text(SIDE_X, LIST_Y + 214, '', { fontFamily: FONT, fontSize: '14px', color: '#9aa6c8', align: 'center', wordWrap: { width: 300 } })
      .setOrigin(0.5, 0);
    new TextButton(this, SIDE_X, GAME_H - 50, 'Ieși din room', () => this.leave(), 'secondary', 14);

    const rules = [
      `Punctaj: ultimul în viață +${POINTS_ROUND_WIN} · kill +${POINTS_KILL}`,
      `         propria petardă ${POINTS_SUICIDE}`,
      'Lanț de petarde: kill-ul e al celui care l-a aprins.',
    ];
    this.add
      .text(LIST_X - 20, LIST_Y + MAX_PLAYERS * ROW_H - 16, rules.join('\n'), {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#9aa6c8',
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
    this.banner = new ConnectionBanner(this);
  }

  update(time: number, delta: number): void {
    if (!this.banner.update(this.transport, time)) return;
    this.transport.update(delta);
    const state = this.transport.getState();
    if (state.phase !== 'lobby') {
      const data: GameSceneData = { transport: this.transport, debug: false, quick: false };
      this.scene.start('game', data);
      return;
    }
    this.syncPlayers(state);
    this.syncControls(state);
  }

  private syncPlayers(state: Readonly<GameState>): void {
    const players = sortedPlayers(state);
    this.countText.setText(`Jucători ${players.length}/${MAX_PLAYERS}`);
    this.rows.forEach((row, i) => {
      const p = players[i];
      row.avatar.setVisible(!!p);
      row.crown.setVisible(!!p && p.id === state.hostId);
      if (!p) {
        row.name.setText('loc liber').setColor('#4f5a78');
        return;
      }
      row.avatar.setTexture(TEX.player(p.slot));
      const tag = p.id === this.transport.playerId ? ' (tu)' : p.isBot ? ' · bot' : '';
      row.name.setText(p.name + tag).setColor(p.connected ? '#ffffff' : '#7f8bb0');
      row.crown.x = row.name.x + row.name.width + 8;
    });
  }

  private syncControls(state: Readonly<GameState>): void {
    const me = this.transport.playerId;
    const isHost = state.hostId === me;
    ROUND_OPTIONS.forEach((rounds, i) => {
      this.roundButtons[i]!.setVariant(state.roundsTotal === rounds ? 'primary' : 'secondary').setEnabled(isHost || state.roundsTotal === rounds);
    });
    const players = Object.values(state.players);
    this.addBotButton.setVisible(isHost).setEnabled(players.length < MAX_PLAYERS);
    this.removeBotButton.setVisible(isHost).setEnabled(players.some((p) => p.isBot));
    this.startButton.setVisible(isHost).setEnabled(canStart(state, me));
    if (!isHost) this.hint.setText('Așteaptă ca hostul să pornească meciul.');
    else if (players.length < MIN_PLAYERS_TO_START) this.hint.setText(`Minim ${MIN_PLAYERS_TO_START} jucători pentru Start.`);
    else this.hint.setText('');
  }

  private async copyLink(): Promise<void> {
    const url = new URL(window.location.href);
    url.search = `?room=${this.transport.getState().code}`;
    url.hash = '';
    const ok = await copyText(url.toString());
    this.copyButton.setText(ok ? 'Copiat!' : 'Nu s-a putut copia');
    this.copyReset?.remove();
    this.copyReset = this.time.delayedCall(COPIED_MS, () => this.copyButton.setText('Copiază link'));
  }

  private leave(): void {
    this.transport.dispose();
    this.scene.start('menu', {});
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to the legacy copy command.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
