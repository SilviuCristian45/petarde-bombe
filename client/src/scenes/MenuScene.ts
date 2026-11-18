import Phaser from 'phaser';
import { MAX_PLAYERS, sanitizeName } from '@petarde/shared';
import { isTouch } from '../device';
import type { GameTransport } from '../net/GameTransport';
import { abandonResumableRoom, createOfflineRoom, createRoom, joinRoom, onlineEnabled, resumeRoom, RoomError } from '../net/rooms';
import { ensureTextures } from '../render/textures';
import { reducedEffects, setReducedEffects } from '../settings';
import { load } from '../storage';
import { drawBackdrop } from '../ui/backdrop';
import { CodeInput } from '../ui/CodeInput';
import { openDialog } from '../ui/dialog';
import { button, el, mountScreen, setButtonStyle, show, title } from '../ui/dom';
import { installHint } from '../ui/installHint';
import { openSettings } from '../ui/settingsDialog';
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

const OFFLINE_LABEL = 'Joacă offline cu boți';

/** Two obvious choices: create a game, or join a friend's by code. Offline play is secondary. */
export class MenuScene extends Phaser.Scene {
  private opts!: MenuSceneData;
  private status!: HTMLElement;
  private codeProblem!: HTMLElement;
  private codeInput!: CodeInput;
  private createButton!: HTMLButtonElement;
  private offlineButton!: HTMLButtonElement;
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

    this.status = el('p', { class: 'message status', text: this.opts.message ?? '' });
    this.offlineButton = button(OFFLINE_LABEL, () => this.onPlayOffline(), 'secondary', 'small');
    show(this.offlineButton, onlineEnabled);
    mountScreen(this, 'menu', [
      title(true),
      this.playingAs(),
      el('div', { class: 'cards' }, [this.createCreateCard(), this.createJoinCard()]),
      this.status,
      // Touch: the offline game and "Setări" side by side, so a phone held sideways sees both.
      isTouch ? el('div', { class: 'menu-footer' }, [this.offlineButton, button('Setări', () => openSettings(), 'secondary', 'small')]) : this.offlineButton,
      isTouch ? null : this.effectsToggle(),
      installHint(),
    ]);

    if (this.opts.switchFrom !== undefined && this.opts.invite) this.askSwitch(this.opts.switchFrom, this.opts.invite);
    else if (this.opts.resume) void this.connect(resumeRoom(), 'Se reconectează la joc...');
    else if (this.opts.invite) this.joinInvite(this.opts.invite);
    else if (!isTouch) this.codeInput.focus();
  }

  /** Desktop: the "Efecte reduse" toggle in the corner (touch devices have it under "Setări"). */
  private effectsToggle(): HTMLElement {
    const label = () => `Efecte reduse: ${reducedEffects() ? 'da' : 'nu'}`;
    const toggle = button(label(), () => {
      setReducedEffects(!reducedEffects());
      toggle.textContent = label();
    }, 'secondary', 'small');
    toggle.classList.add('corner-toggle');
    return toggle;
  }

  /** A link to another room while this tab still has a game: the link wins, once confirmed. */
  private askSwitch(current: string, invite: string): void {
    const from = current ? ` (${current})` : '';
    const dialog = openDialog([
      el('h2', { text: `Ieși din jocul curent${from}\nși intri în ${invite}?` }),
      el('div', { class: 'btn-row' }, [
        button(`Da, intru în ${invite}`, () => {
          dialog.close();
          this.setStatus('Ieși din jocul curent...', true);
          void abandonResumableRoom().then(() => this.joinInvite(invite));
        }, 'primary'),
        button('Nu, rămân', () => {
          dialog.close();
          // Whatever happens, a later reload should not ask again.
          forgetInviteInUrl();
          void this.connect(resumeRoom(), 'Se reconectează la joc...');
        }),
      ]),
    ]);
  }

  /** "Joci ca {nume} · schimbă" */
  private playingAs(): HTMLElement {
    const change = el('button', { class: 'link', text: '· schimbă', attrs: { type: 'button' } });
    change.addEventListener('click', () => {
      if (this.busy) return;
      const data: NameSceneData = { edit: true };
      this.scene.start('name', data);
    });
    return el('p', { class: 'playing-as' }, [`Joci ca ${this.playerName()} `, change]);
  }

  private createCreateCard(): HTMLElement {
    this.createButton = button('Creează', () => this.onCreateRoom(), 'primary', 'medium');
    this.createButton.classList.add('card-action');
    const card = el('div', { class: 'card clickable' }, [
      el('h2', { text: 'Creează joc' }),
      el('p', { text: `Invită până la ${MAX_PLAYERS - 1} prieteni` }),
      this.createButton,
    ]);
    card.addEventListener('click', (e) => {
      if (e.target !== this.createButton) this.onCreateRoom();
    });
    return card;
  }

  private createJoinCard(): HTMLElement {
    this.codeProblem = el('p', { class: 'problem' });
    this.codeInput = new CodeInput({
      onComplete: (code) => this.join(code),
      onProblem: (message) => (this.codeProblem.textContent = message),
    });
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Intră la un prieten' }),
      el('p', { text: 'Scrie codul de 6 caractere primit' }),
      this.codeInput.element,
      this.codeProblem,
    ]);
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
    forgetInviteInUrl();
    this.join(code);
  }

  private async connect(pending: Promise<GameTransport>, message: string): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.offerOffline(false);
    this.setStatus(message, true);
    try {
      const transport = await pending;
      const data: LobbySceneData = { transport };
      this.scene.start('lobby', data);
    } catch (err) {
      this.setBusy(false);
      this.setStatus(err instanceof Error ? err.message : 'Nu s-a putut intra în joc.', false);
      // The server is down or full: highlight "Joacă offline cu boți" right under the message.
      if (err instanceof RoomError && err.offline) this.offerOffline(true);
      if (!isTouch) this.codeInput.focus();
    }
  }

  private setStatus(text: string, info: boolean): void {
    this.status.textContent = text;
    this.status.classList.toggle('info', info);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.createButton.disabled = busy;
    this.offlineButton.disabled = busy;
    this.codeInput.setDisabled(busy);
  }

  private offerOffline(offer: boolean): void {
    setButtonStyle(this.offlineButton, offer ? 'primary' : 'secondary');
  }
}

function forgetInviteInUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}
