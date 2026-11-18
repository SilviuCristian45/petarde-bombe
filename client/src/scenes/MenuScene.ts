import Phaser from 'phaser';
import { MAX_PLAYERS, sanitizeName } from '@petarde/shared';
import type { GameTransport } from '../net/GameTransport';
import { abandonResumableRoom, createOfflineRoom, createRoom, joinRoom, onlineEnabled, resumeRoom, RoomError } from '../net/rooms';
import { FONT, GAME_H, GAME_W } from '../render/layout';
import { ensureTextures } from '../render/textures';
import { reducedEffects, setReducedEffects } from '../settings';
import { load } from '../storage';
import { addTitle, drawBackdrop } from '../ui/backdrop';
import { CodeInput } from '../ui/CodeInput';
import { TextButton } from '../ui/TextButton';
import type { LobbySceneData } from './LobbyScene';
import type { NameSceneData } from './NameScene';

export interface MenuSceneData {
  /** Code from a ?room= invite link: joined right away. */
  invite?: string;
  /** Shown on arrival, e.g. an invalid invite link or a lost connection. */
  message?: string;
  /** The tab was reloaded during an online game: reconnect to that room right away. */
  resume?: boolean;
  /** Opened a link to another room while in this one ('' = code unknown): ask before switching. */
  switchFrom?: string;
}

const CX = GAME_W / 2;
const CARD_Y = 285;
const CARD_W = 400;
const CARD_H = 240;
const LEFT_X = CX - 215;
const RIGHT_X = CX + 215;
const OFFLINE_LABEL = 'Joacă offline cu boți';

/** Two obvious choices: create a game, or join a friend's by code. Offline play is secondary. */
export class MenuScene extends Phaser.Scene {
  private opts!: MenuSceneData;
  private status!: Phaser.GameObjects.Text;
  private codeProblem!: Phaser.GameObjects.Text;
  private codeInput!: CodeInput;
  private createCard!: Phaser.GameObjects.Rectangle;
  private createButton!: TextButton;
  private offlineButton!: TextButton;
  private busy = false;

  constructor() {
    super('menu');
  }

  init(data: MenuSceneData): void {
    this.opts = data;
    this.busy = false;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    addTitle(this, 50, 40);
    this.playingAs(100);

    // Created first: everything below may write to it (the scene instance is reused between visits).
    this.status = this.add
      .text(CX, 432, this.opts.message ?? '', { fontFamily: FONT, fontSize: '15px', color: '#ff8fa3', align: 'center' })
      .setOrigin(0.5);

    this.createCreateCard();
    this.createJoinCard();
    this.offlineButton = new TextButton(this, CX, 482, OFFLINE_LABEL, () => this.onPlayOffline(), 'secondary', 14).setVisible(
      onlineEnabled,
    );

    this.effectsToggle();

    if (this.opts.switchFrom !== undefined && this.opts.invite) this.askSwitch(this.opts.switchFrom, this.opts.invite);
    else if (this.opts.resume) void this.connect(resumeRoom(), 'Se reconectează la joc...');
    else if (this.opts.invite) this.joinInvite(this.opts.invite);
    else this.codeInput.focus();
  }

  /** "Efecte reduse": fewer particles and no snow, remembered on this device. */
  private effectsToggle(): void {
    const label = () => `Efecte reduse: ${reducedEffects() ? 'da' : 'nu'}`;
    const button = new TextButton(this, 16, GAME_H - 16, label(), () => {
      setReducedEffects(!reducedEffects());
      button.setText(label());
    }, 'secondary', 12);
    button.setOrigin(0, 1);
  }

  /** A link to another room while this tab still has a game: the link wins, once confirmed. */
  private askSwitch(current: string, invite: string): void {
    this.codeInput.setVisible(false);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const close = () => {
      for (const part of parts) part.destroy();
      this.codeInput.setVisible(true);
    };
    // Blocks the menu underneath until a choice is made.
    parts.push(this.add.rectangle(CX, GAME_H / 2, GAME_W, GAME_H, 0x0b1026, 0.85).setInteractive());
    parts.push(this.add.rectangle(CX, 285, 560, 200, 0x13203d).setStrokeStyle(2, 0xffe066));
    const from = current ? ` (${current})` : '';
    parts.push(
      this.add
        .text(CX, 245, `Ieși din jocul curent${from}\nși intri în ${invite}?`, {
          fontFamily: FONT,
          fontSize: '20px',
          color: '#ffffff',
          align: 'center',
          lineSpacing: 6,
        })
        .setOrigin(0.5),
    );
    parts.push(
      new TextButton(this, CX - 120, 330, `Da, intru în ${invite}`, () => {
        close();
        this.status.setColor('#d0d8f0').setText('Ieși din jocul curent...');
        void abandonResumableRoom().then(() => this.joinInvite(invite));
      }, 'primary', 18),
    );
    parts.push(
      new TextButton(this, CX + 130, 330, 'Nu, rămân', () => {
        close();
        // Whatever happens, a later reload should not ask again.
        const url = new URL(window.location.href);
        url.searchParams.delete('room');
        window.history.replaceState(null, '', url);
        void this.connect(resumeRoom(), 'Se reconectează la joc...');
      }, 'secondary', 18),
    );
  }

  /** "Joci ca {nume} · schimbă" */
  private playingAs(y: number): void {
    const name = this.add
      .text(CX - 4, y, `Joci ca ${this.playerName()}`, { fontFamily: FONT, fontSize: '15px', color: '#9aa6c8' })
      .setOrigin(1, 0.5);
    const change = this.add
      .text(CX + 4, y, '· schimbă', { fontFamily: FONT, fontSize: '15px', color: '#ffe066' })
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });
    change.on('pointerover', () => change.setColor('#fff1a8'));
    change.on('pointerout', () => change.setColor('#ffe066'));
    change.on('pointerdown', () => {
      if (this.busy) return;
      const data: NameSceneData = { edit: true };
      this.scene.start('name', data);
    });
    // keep the pair centered as a whole
    const shift = (name.width - change.width) / 2;
    name.x += shift;
    change.x += shift;
  }

  private card(x: number): Phaser.GameObjects.Rectangle {
    return this.add.rectangle(x, CARD_Y, CARD_W, CARD_H, 0x13203d, 0.92).setStrokeStyle(2, 0x31497a);
  }

  private createCreateCard(): void {
    this.createCard = this.card(LEFT_X).setInteractive({ useHandCursor: true });
    this.createCard.on('pointerover', () => !this.busy && this.createCard.setStrokeStyle(2, 0xffe066));
    this.createCard.on('pointerout', () => this.createCard.setStrokeStyle(2, 0x31497a));
    this.createCard.on('pointerdown', () => this.onCreateRoom());
    this.add.text(LEFT_X, CARD_Y - 75, 'Creează joc', { fontFamily: FONT, fontSize: '28px', color: '#ffffff' }).setOrigin(0.5);
    this.add
      .text(LEFT_X, CARD_Y - 35, `Invită până la ${MAX_PLAYERS - 1} prieteni`, { fontFamily: FONT, fontSize: '16px', color: '#9aa6c8' })
      .setOrigin(0.5);
    this.createButton = new TextButton(this, LEFT_X, CARD_Y + 45, 'Creează', () => this.onCreateRoom(), 'primary', 24);
  }

  private createJoinCard(): void {
    this.card(RIGHT_X);
    this.add.text(RIGHT_X, CARD_Y - 75, 'Intră la un prieten', { fontFamily: FONT, fontSize: '28px', color: '#ffffff' }).setOrigin(0.5);
    this.add
      .text(RIGHT_X, CARD_Y - 35, 'Scrie codul de 6 caractere primit', { fontFamily: FONT, fontSize: '16px', color: '#9aa6c8' })
      .setOrigin(0.5);
    this.codeInput = new CodeInput(this, RIGHT_X, CARD_Y + 25, {
      onComplete: (code) => this.join(code),
      onProblem: (message) => this.codeProblem.setText(message),
    });
    this.codeProblem = this.add
      .text(RIGHT_X, CARD_Y + 85, '', {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#ff8fa3',
        align: 'center',
        wordWrap: { width: CARD_W - 30 },
      })
      .setOrigin(0.5, 0);
  }

  private playerName(): string {
    return sanitizeName(load('name') ?? '');
  }

  private onCreateRoom(): void {
    void this.connect(createRoom(this.playerName()), 'Se creează jocul...');
  }

  private onPlayOffline(): void {
    void this.connect(createOfflineRoom(this.playerName()), 'Se pregătește jocul offline...');
  }

  private join(code: string): void {
    void this.connect(joinRoom(code, this.playerName()), `Intri în ${code}...`);
  }

  private joinInvite(code: string): void {
    this.codeInput.setCode(code);
    // Whatever happens, a later reload of this page should not retry the invite.
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
    this.join(code);
  }

  private async connect(pending: Promise<GameTransport>, message: string): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.offerOffline(false);
    this.status.setColor('#d0d8f0').setText(message);
    try {
      const transport = await pending;
      const data: LobbySceneData = { transport };
      this.scene.start('lobby', data);
    } catch (err) {
      this.setBusy(false);
      this.status.setColor('#ff8fa3').setText(err instanceof Error ? err.message : 'Nu s-a putut intra în joc.');
      // The server is down or full: highlight "Joacă offline cu boți" right under the message.
      if (err instanceof RoomError && err.offline) this.offerOffline(true);
      this.codeInput.focus();
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.createButton.setEnabled(!busy);
    this.offlineButton.setEnabled(!busy);
    this.codeInput.setDisabled(busy);
  }

  private offerOffline(offer: boolean): void {
    this.offlineButton.setVariant(offer ? 'primary' : 'secondary');
  }
}
