import Phaser from 'phaser';
import { MAX_NAME_LENGTH, sanitizeName } from '@petarde/shared';
import { isTouch } from '../device';
import { ensureTextures } from '../render/textures';
import { load, save } from '../storage';
import { drawBackdrop } from '../ui/backdrop';
import { button, el, keepInViewOnFocus, mountScreen, onKey, title } from '../ui/dom';
import type { MenuSceneData } from './MenuScene';

export interface NameSceneData extends MenuSceneData {
  /** Opened from the menu's "schimbă": go straight to the input, prefilled. */
  edit?: boolean;
}

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
    const saved = load('name')?.trim();
    if (saved && !this.opts.edit) this.greet(saved);
    else this.ask(saved ?? '');
  }

  /** Returning player: "Salut, {nume}!" with Continuă / Schimbă numele. */
  private greet(name: string): void {
    mountScreen(this, 'name-screen', [
      title(true),
      el('h2', { text: `Salut, ${sanitizeName(name)}!` }),
      this.inviteLine(),
      el('div', { class: 'actions' }, [
        button('Continuă', () => this.next(), 'primary', 'medium'),
        button('Schimbă numele', () => this.scene.restart({ ...this.opts, edit: true }), 'secondary', 'small'),
      ]),
    ]);
    onKey(this, 'Enter', () => this.next());
  }

  private ask(initial: string): void {
    const input = el('input', {
      class: 'field big',
      attrs: { placeholder: 'Porecla ta', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', 'aria-label': 'Porecla ta' },
    });
    input.maxLength = MAX_NAME_LENGTH;
    input.spellcheck = false;
    input.value = initial;
    keepInViewOnFocus(input);
    const counter = el('div', { class: 'counter' });
    const message = el('p', { class: 'message' });
    const submitButton = button('Continuă', () => submit(), 'primary', 'medium');

    mountScreen(this, 'name-screen', [
      title(true),
      el('h2', { text: 'Cum te cheamă?' }),
      el('div', { class: 'field-wrap' }, [input, counter]),
      this.inviteLine(),
      el('div', { class: 'actions' }, [submitButton]),
      message,
    ]);

    const valid = () => input.value.trim().length > 0;
    const refresh = () => {
      counter.textContent = `${[...input.value].length}/${MAX_NAME_LENGTH}`;
      // Looks disabled while empty, but a tap still says why nothing happens.
      submitButton.classList.toggle('dim', !valid());
      if (valid()) message.textContent = '';
    };
    const submit = () => {
      if (!valid()) {
        message.textContent = EMPTY_MESSAGE;
        input.focus();
        return;
      }
      save('name', input.value.trim());
      this.next();
    };
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    refresh();
    // A phone would pop its keyboard over the screen before the player has even looked at it.
    if (!isTouch) {
      input.focus();
      input.select();
    }
  }

  private inviteLine(): HTMLElement | null {
    if (!this.opts.invite) return null;
    return el('p', { class: 'invite-line', text: `Intri în camera ${this.opts.invite}` });
  }

  private next(): void {
    const data: MenuSceneData = { invite: this.opts.invite, message: this.opts.message };
    this.scene.start('menu', data);
  }
}
