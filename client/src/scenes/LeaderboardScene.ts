import Phaser from 'phaser';
import { LEADERBOARD_MIN_HUMANS, LEADERBOARD_SIZE, sanitizeName, type LeaderboardEntry } from '@petarde/shared';
import { fetchLeaderboard, formatRecordDate } from '../net/leaderboard';
import { ensureTextures } from '../render/textures';
import { load } from '../storage';
import { drawBackdrop } from '../ui/backdrop';
import { button, el, mountScreen, onKey, title } from '../ui/dom';

const MEDALS = ['gold', 'silver', 'bronze'];

/** "Clasament": the all-time top, opened from the menu. */
export class LeaderboardScene extends Phaser.Scene {
  private content!: HTMLElement;

  constructor() {
    super('leaderboard');
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    this.content = el('div', { class: 'leaderboard-body' }, [el('p', { class: 'message info', text: 'Se încarcă...' })]);
    const back = button('Înapoi', () => this.back(), 'primary', 'medium');
    mountScreen(this, 'leaderboard', [
      title(true),
      el('h2', { text: `Clasament: top ${LEADERBOARD_SIZE}` }),
      this.content,
      el('p', { class: 'note', text: `Intră doar meciurile online cu cel puțin ${LEADERBOARD_MIN_HUMANS} jucători, cel mai bun meci al fiecărei porecle.` }),
      back,
    ]);
    onKey(this, 'Escape', () => this.back());
    void this.fetchRows();
  }

  private async fetchRows(): Promise<void> {
    const entries = await fetchLeaderboard();
    // The player may have gone back while the request was out.
    if (!this.sys.isActive()) return;
    if (entries === null) this.content.replaceChildren(el('p', { class: 'message', text: 'Clasamentul nu e disponibil acum.' }));
    else if (entries.length === 0) this.content.replaceChildren(el('p', { class: 'message info', text: 'Încă nu e niciun meci în clasament. Fii primul!' }));
    else this.content.replaceChildren(this.table(entries));
  }

  private table(entries: LeaderboardEntry[]): HTMLElement {
    const me = sanitizeName(load('name') ?? '').toLowerCase();
    const head = el('tr', {}, ['Loc', 'Porecla', 'Puncte', 'Victorii', 'Kill-uri', 'Runde', 'Data'].map((text) => el('th', { text })));
    const rows = entries.map((e) => {
      const medal = MEDALS[e.place - 1];
      const classes = [medal, e.name.toLowerCase() === me ? 'me' : ''].filter(Boolean).join(' ');
      return el('tr', { class: classes }, [
        el('td', { class: 'place', text: String(e.place) }),
        el('td', { class: 'name', text: e.name }),
        el('td', { text: String(e.points) }),
        el('td', { text: String(e.wins) }),
        el('td', { text: String(e.kills) }),
        el('td', { text: String(e.rounds) }),
        el('td', { class: 'date', text: formatRecordDate(e.endedAt) }),
      ]);
    });
    const table = el('table', { class: 'leaderboard-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]);
    // A narrow phone scrolls the table sideways instead of squeezing it.
    return el('div', { class: 'table-scroll' }, [table]);
  }

  private back(): void {
    this.scene.start('menu', {});
  }
}
