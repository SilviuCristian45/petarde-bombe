import Phaser from 'phaser';
import { MAX_NAME_LENGTH, sanitizeName } from '@petarde/shared';
import { FONT, GAME_W } from '../render/layout';
import { ensureTextures } from '../render/textures';
import { load, save } from '../storage';
import { addTitle, drawBackdrop } from '../ui/backdrop';
import { TextButton } from '../ui/TextButton';
import type { MenuSceneData } from './MenuScene';

export interface NameSceneData extends MenuSceneData {
  /** Opened from the menu's "schimbă": go straight to the input, prefilled. */
  edit?: boolean;
}

const CX = GAME_W / 2;
const EMPTY_MESSAGE = 'Scrie-ți porecla ca să continui.';

/** "Cum te cheamă?" — the first step after the intro. A saved name only needs confirming. */
export class NameScene extends Phaser.Scene {
  private opts!: NameSceneData;

  constructor() {
    super('name');
  }

  init(data: NameSceneData): void {
    this.opts = data;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    addTitle(this, 60, 40);
    const saved = load('name')?.trim();
    if (saved && !this.opts.edit) this.greet(saved);
    else this.ask(saved ?? '');
  }

  /** Returning player: "Salut, {nume}!" with Continuă / Schimbă numele. */
  private greet(name: string): void {
    this.add
      .text(CX, 190, `Salut, ${sanitizeName(name)}!`, { fontFamily: FONT, fontSize: '40px', color: '#ffffff' })
      .setOrigin(0.5);
    this.inviteLine(250);
    new TextButton(this, CX, 330, 'Continuă', () => this.next(), 'primary', 26);
    new TextButton(this, CX, 400, 'Schimbă numele', () => this.scene.restart({ ...this.opts, edit: true }), 'secondary', 16);
    this.input.keyboard!.once('keydown-ENTER', () => this.next());
  }

  private ask(initial: string): void {
    this.add.text(CX, 150, 'Cum te cheamă?', { fontFamily: FONT, fontSize: '34px', color: '#ffffff' }).setOrigin(0.5);

    // Fully styled before it is added: Phaser measures the element once, to center it.
    const input = document.createElement('input');
    input.className = 'field big';
    input.maxLength = MAX_NAME_LENGTH;
    input.placeholder = 'Porecla ta';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = initial;
    this.add.dom(CX, 230, input).setOrigin(0.5);

    const counter = this.add
      .text(CX + 190, 272, '', { fontFamily: FONT, fontSize: '13px', color: '#7f8bb0' })
      .setOrigin(1, 0.5);
    this.inviteLine(300);
    const message = this.add
      .text(CX, 425, '', { fontFamily: FONT, fontSize: '15px', color: '#ff8fa3' })
      .setOrigin(0.5);
    const button = new TextButton(this, CX, 365, 'Continuă', () => submit(), 'primary', 26);

    const valid = () => input.value.trim().length > 0;
    const refresh = () => {
      counter.setText(`${[...input.value].length}/${MAX_NAME_LENGTH}`);
      button.setEnabled(valid());
      if (valid()) message.setText('');
    };
    const submit = () => {
      if (!valid()) {
        message.setText(EMPTY_MESSAGE);
        input.focus();
        return;
      }
      save('name', input.value.trim());
      this.next();
    };
    // A disabled TextButton ignores clicks; still say why nothing happens.
    button.on('pointerdown', () => {
      if (!valid()) submit();
    });
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    refresh();
    input.focus();
    input.select();
  }

  private inviteLine(y: number): void {
    if (!this.opts.invite) return;
    this.add
      .text(CX, y, `Intri în camera ${this.opts.invite}`, { fontFamily: FONT, fontSize: '18px', color: '#ffe066' })
      .setOrigin(0.5);
  }

  private next(): void {
    const data: MenuSceneData = { invite: this.opts.invite, message: this.opts.message };
    this.scene.start('menu', data);
  }
}
