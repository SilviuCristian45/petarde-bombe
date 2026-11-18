import Phaser from 'phaser';
import {
  isValidRoomCode,
  MAX_NAME_LENGTH,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  sanitizeName,
} from '@petarde/shared';
import type { GameTransport } from '../net/GameTransport';
import { createRoom, joinRoom } from '../net/rooms';
import { FONT, GAME_W } from '../render/layout';
import { ensureTextures } from '../render/textures';
import { load, save } from '../storage';
import { addTitle, drawBackdrop } from '../ui/backdrop';
import { TextButton } from '../ui/TextButton';
import type { LobbySceneData } from './LobbyScene';

export interface MenuSceneData {
  /** Code from a ?room= invite link: the menu only asks for a nickname, then joins. */
  invite?: string;
  /** Shown on arrival, e.g. an invalid invite link. */
  message?: string;
}

const CX = GAME_W / 2;
const CODE_HINT = 'Codul are 6 caractere: litere și cifre, fără 0, O, 1, I, L.';

/** Nickname plus "create room" / "join by code". Inputs are DOM elements over the canvas. */
export class MenuScene extends Phaser.Scene {
  private opts!: MenuSceneData;
  private nameInput!: HTMLInputElement;
  private codeInput?: HTMLInputElement;
  private status!: Phaser.GameObjects.Text;
  private buttons: TextButton[] = [];
  private joinButton?: TextButton;
  private busy = false;

  constructor() {
    super('menu');
  }

  init(data: MenuSceneData): void {
    this.opts = data;
    this.buttons = [];
    this.codeInput = undefined;
    this.joinButton = undefined;
    this.busy = false;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    addTitle(this, 70, 44);

    this.label(150, 'Nickname');
    this.nameInput = this.field(188, 300, MAX_NAME_LENGTH, 'Jucător');
    this.nameInput.value = load('name') ?? '';

    const invite = this.opts.invite;
    if (invite) {
      this.label(258, 'Ai fost invitat în room-ul');
      this.add
        .text(CX, 298, invite, { fontFamily: FONT, fontSize: '40px', color: '#ffe066', letterSpacing: 6 })
        .setOrigin(0.5);
      this.joinButton = this.button(370, `Intră în ${invite}`, () => this.join(invite), 'primary');
      this.button(430, 'Alt room', () => this.leaveInvite());
      this.onEnter(this.nameInput, () => this.join(invite));
    } else {
      this.button(256, 'Creează room', () => this.onCreateRoom(), 'primary');
      this.label(316, 'sau intră cu un cod');
      this.codeInput = this.field(354, 180, ROOM_CODE_LENGTH, 'COD');
      this.codeInput.classList.add('code');
      this.codeInput.addEventListener('input', () => this.onCodeInput());
      this.joinButton = this.button(414, 'Intră cu cod', () => this.join(this.codeInput!.value));
      this.onEnter(this.nameInput, () => this.onCreateRoom());
      this.onEnter(this.codeInput, () => this.join(this.codeInput!.value));
      this.onCodeInput();
    }

    this.status = this.add
      .text(CX, 480, this.opts.message ?? '', { fontFamily: FONT, fontSize: '15px', color: '#ff8fa3', align: 'center' })
      .setOrigin(0.5);
    this.nameInput.focus();
  }

  private label(y: number, text: string): void {
    this.add.text(CX, y, text, { fontFamily: FONT, fontSize: '16px', color: '#d0d8f0' }).setOrigin(0.5);
  }

  private field(y: number, width: number, maxLength: number, placeholder: string): HTMLInputElement {
    const el = this.add.dom(CX, y, 'input').setOrigin(0.5);
    const input = el.node as HTMLInputElement;
    input.className = 'field';
    input.style.width = `${width}px`;
    input.maxLength = maxLength;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    return input;
  }

  private button(y: number, label: string, onClick: () => void, variant: 'primary' | 'secondary' = 'secondary'): TextButton {
    const b = new TextButton(this, CX, y, label, onClick, variant);
    this.buttons.push(b);
    return b;
  }

  private onEnter(input: HTMLInputElement, action: () => void): void {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') action();
    });
  }

  /** Upper-cases as you type and flags characters outside the room code alphabet. */
  private onCodeInput(): void {
    const input = this.codeInput!;
    const code = normalizeRoomCode(input.value);
    if (code !== input.value) input.value = code;
    const bad = [...code].some((ch) => !ROOM_CODE_ALPHABET.includes(ch));
    input.classList.toggle('invalid', bad);
    if (this.status) this.status.setText(bad ? CODE_HINT : '');
    this.joinButton!.setEnabled(!this.busy && isValidRoomCode(code));
  }

  private playerName(): string {
    const raw = this.nameInput.value.trim();
    if (raw) save('name', raw);
    return sanitizeName(raw);
  }

  private onCreateRoom(): void {
    void this.connect(createRoom(this.playerName()), 'Se creează room-ul...');
  }

  private join(input: string): void {
    const code = normalizeRoomCode(input);
    if (!isValidRoomCode(code)) {
      this.status.setText(CODE_HINT);
      return;
    }
    void this.connect(joinRoom(code, this.playerName()), `Intri în ${code}...`);
  }

  private async connect(pending: Promise<GameTransport>, message: string): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.status.setColor('#d0d8f0').setText(message);
    try {
      const transport = await pending;
      const data: LobbySceneData = { transport };
      this.scene.start('lobby', data);
    } catch (err) {
      this.setBusy(false);
      this.status.setColor('#ff8fa3').setText(err instanceof Error ? err.message : 'Nu s-a putut intra în room.');
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const b of this.buttons) b.setEnabled(!busy);
    if (this.codeInput && !busy) this.onCodeInput();
  }

  private leaveInvite(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
    this.scene.restart({});
  }
}
