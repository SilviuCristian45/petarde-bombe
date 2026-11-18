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
import { keepScreenOn } from '../device-apis';
import { isTouch } from '../device';
import type { GameTransport } from '../net/GameTransport';
import { ensureTextures, TEX } from '../render/textures';
import { drawBackdrop } from '../ui/backdrop';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { button, el, mountScreen, setButtonStyle, setText, show, textureUrl } from '../ui/dom';
import { fullscreenOnFirstTap } from '../ui/fullscreen';
import { requireLandscape } from '../ui/orientation';
import { notifyPresence } from '../ui/presence';
import { openSettings } from '../ui/settingsDialog';
import type { GameSceneData } from './GameScene';

export interface LobbySceneData {
  transport: GameTransport;
}

interface PlayerRow {
  row: HTMLElement;
  avatar: HTMLImageElement;
  name: HTMLElement;
  crown: HTMLImageElement;
}

const COPIED_MS = 1500;
/** Phones share the invite through the system sheet (WhatsApp...); desktops copy the link. */
const SHARE_LABEL = isTouch ? 'Trimite invitația' : 'Copiază link';

/** Room code and invite link, the players, and the host's round count / bots / Start. */
export class LobbyScene extends Phaser.Scene {
  private transport!: GameTransport;
  private rows: PlayerRow[] = [];
  private roundButtons: HTMLButtonElement[] = [];
  private addBotButton!: HTMLButtonElement;
  private removeBotButton!: HTMLButtonElement;
  private startButton!: HTMLButtonElement;
  private shareButton!: HTMLButtonElement;
  private copyReset?: Phaser.Time.TimerEvent;
  private hint!: HTMLElement;
  private countText!: HTMLElement;
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
    requireLandscape(this);
    keepScreenOn(this);
    const disarm = fullscreenOnFirstTap();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, disarm);

    mountScreen(this, 'lobby', [el('div', { class: 'lobby-grid' }, [this.createHead(), this.createPlayers(), this.createSide()])]);
    this.banner = new ConnectionBanner(this);
  }

  /** An offline room has no code worth sharing: nobody else can join it. */
  private createHead(): HTMLElement {
    const online = this.transport.online;
    this.shareButton = button(SHARE_LABEL, () => void this.share(), 'secondary', 'small');
    show(this.shareButton, online);
    return el('div', { class: 'lobby-head' }, [
      el('div', { class: 'label', text: online ? 'Codul jocului' : 'Joc offline' }),
      el('div', { class: 'room-code', text: online ? this.transport.getState().code : 'cu boți' }),
      this.shareButton,
      online ? el('div', { class: 'share-hint', text: 'Trimite linkul prietenilor ca să intre' }) : null,
    ]);
  }

  private createPlayers(): HTMLElement {
    this.countText = el('div', { class: 'count' });
    const list = el('ul', { class: 'player-rows' });
    const crownUrl = textureUrl(this.game, TEX.crown);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const avatar = el('img', { attrs: { alt: '' } });
      const name = el('span', { class: 'name' });
      const crown = el('img', { class: 'crown', attrs: { alt: 'host', src: crownUrl } });
      const row = el('li', { class: 'player-row' }, [avatar, name, crown]);
      list.append(row);
      this.rows.push({ row, avatar, name, crown });
    }
    const rules = [
      `Punctaj: ultimul în viață +${POINTS_ROUND_WIN} · kill +${POINTS_KILL} · propria petardă ${POINTS_SUICIDE}`,
      'Lanț de petarde: kill-ul e al celui care l-a aprins.',
    ];
    return el('div', { class: 'lobby-players' }, [this.countText, list, el('p', { class: 'rules', text: rules.join('\n') })]);
  }

  private createSide(): HTMLElement {
    this.roundButtons = ROUND_OPTIONS.map((rounds) => {
      const b = button(String(rounds), () => this.transport.send({ type: 'rounds', rounds }));
      b.classList.add('round-btn');
      return b;
    });
    this.addBotButton = button('+Bot', () => this.transport.send({ type: 'addBot' }));
    this.removeBotButton = button('-Bot', () => this.transport.send({ type: 'removeBot' }));
    this.startButton = button('Start', () => this.transport.send({ type: 'start' }), 'primary', 'medium');
    this.hint = el('div', { class: 'hint' });
    const leave = button('Ieși din joc', () => this.leave(), 'secondary', 'small');
    return el('div', { class: 'lobby-side' }, [
      el('div', { class: 'label', text: 'Runde' }),
      el('div', { class: 'btn-row' }, this.roundButtons),
      el('div', { class: 'btn-row' }, [this.addBotButton, this.removeBotButton]),
      this.startButton,
      this.hint,
      el('div', { class: 'btn-row' }, [isTouch ? button('Setări', () => openSettings(), 'secondary', 'small') : null, leave]),
    ]);
  }

  update(time: number, delta: number): void {
    if (!this.banner.update(this.transport, time)) return;
    this.transport.update(delta);
    notifyPresence(this.transport);
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
    setText(this.countText, `Jucători ${players.length}/${MAX_PLAYERS}`);
    this.rows.forEach((row, i) => {
      const p = players[i];
      row.avatar.style.visibility = p ? 'visible' : 'hidden';
      show(row.crown, !!p && p.id === state.hostId);
      row.row.classList.toggle('empty', !p);
      row.row.classList.toggle('away', !!p && !p.connected);
      if (!p) {
        setText(row.name, 'loc liber');
        return;
      }
      const src = avatarUrl(this.game, p.slot);
      if (row.avatar.getAttribute('src') !== src) row.avatar.src = src;
      const tag = p.id === this.transport.playerId ? ' (tu)' : p.isBot ? ' · bot' : '';
      setText(row.name, p.name + tag);
    });
  }

  private syncControls(state: Readonly<GameState>): void {
    const me = this.transport.playerId;
    const isHost = state.hostId === me;
    ROUND_OPTIONS.forEach((rounds, i) => {
      const b = this.roundButtons[i]!;
      setButtonStyle(b, state.roundsTotal === rounds ? 'primary' : 'secondary');
      b.disabled = !isHost && state.roundsTotal !== rounds;
    });
    const players = Object.values(state.players);
    show(this.addBotButton, isHost);
    this.addBotButton.disabled = players.length >= MAX_PLAYERS;
    show(this.removeBotButton, isHost);
    this.removeBotButton.disabled = !players.some((p) => p.isBot);
    show(this.startButton, isHost);
    this.startButton.disabled = !canStart(state, me);
    if (!isHost) setText(this.hint, 'Așteaptă ca hostul să pornească meciul.');
    else if (players.length < MIN_PLAYERS_TO_START) setText(this.hint, `Minim ${MIN_PLAYERS_TO_START} jucători pentru Start.`);
    else setText(this.hint, '');
  }

  private async share(): Promise<void> {
    const url = new URL(window.location.href);
    const code = this.transport.getState().code;
    url.search = `?room=${code}`;
    url.hash = '';
    if (isTouch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Bombe și Petarde', text: `Hai la bombe! Intră în jocul meu (cod ${code}):`, url: url.toString() });
        return;
      } catch (err) {
        // Closing the share sheet is a choice, not a failure; anything else falls back to copying.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    const ok = await copyText(url.toString());
    this.shareButton.textContent = ok ? 'Copiat!' : 'Nu s-a putut copia';
    this.copyReset?.remove();
    this.copyReset = this.time.delayedCall(COPIED_MS, () => (this.shareButton.textContent = SHARE_LABEL));
  }

  /** For good, no confirmation: the seat is freed at once and a reload does not come back. */
  private leave(): void {
    this.transport.dispose();
    this.scene.start('menu', {});
  }
}

const avatars = new Map<number, string>();

function avatarUrl(game: Phaser.Game, slot: number): string {
  let url = avatars.get(slot);
  if (!url) {
    url = textureUrl(game, TEX.player(slot));
    avatars.set(slot, url);
  }
  return url;
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
