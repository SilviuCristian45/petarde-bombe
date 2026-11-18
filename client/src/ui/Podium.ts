import Phaser from 'phaser';
import { computeAwards, computeStandings, PLAYER_COLORS, type AwardId, type GameState, type NewRecord } from '@petarde/shared';
import { firework } from '../render/fx';
import { FONT, GAME_H, GAME_W } from '../render/layout';
import { TEX } from '../render/textures';
import { css, StandingsTable, TABLE_W } from './StandingsTable';
import { TextButton } from './TextButton';

// End of the match: the top three climb onto a 2-1-3 podium one after the other (third,
// second, then the winner with fireworks in their color), then the full table and the awards.

/** The layout is drawn for 960 px; a wider (touch) canvas keeps it centered. */
const OFFSET_X = (GAME_W - 960) / 2;
const BASE_Y = 300;
const PODIUM_CX = 230 + OFFSET_X;
const STEP_W = 104;
/** Index = place - 1: x offset from PODIUM_CX and step height. */
const STEPS = [
  { dx: 0, h: 130 },
  { dx: -STEP_W - 6, h: 92 },
  { dx: STEP_W + 6, h: 64 },
];
const RISE_MS = 650;
/** Third place starts, then second, then first. */
const RISE_DELAYS = [2000, 1100, 300];
const TABLE_DELAY = 3000;
const TABLE_X = GAME_W - OFFSET_X - TABLE_W - 30;
const TABLE_Y = 92;

const AWARD_TEXT: Record<AwardId, { title: string; detail: (n: number) => string }> = {
  artificier: { title: 'Artificierul', detail: (n) => `cele mai multe kill-uri (${n})` },
  kamikaze: { title: 'Kamikaze', detail: (n) => `cele mai multe sinucideri (${n})` },
  supravietuitor: { title: 'Supraviețuitorul', detail: (n) => `cele mai puține morți (${n})` },
  spargator: { title: 'Spărgătorul de cadouri', detail: (n) => `${n} cadouri sparte` },
  colectionar: { title: 'Colecționarul', detail: (n) => `${n} power-up-uri adunate` },
};

export interface PodiumOptions {
  me: string;
  /** Online matches may set all-time records; offline ones get a note that they do not count. */
  online: boolean;
  depth: number;
  /** "Încă un meci" (host only). */
  onAgain: () => void;
  againLabel: string;
}

export class Podium {
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private readonly table: StandingsTable;
  private readonly againButton: TextButton;
  private readonly waitText: Phaser.GameObjects.Text;
  /** "Record nou! Locul X" once the server has saved the match, or the offline note. */
  private readonly recordText: Phaser.GameObjects.Text;
  private recordsShown: readonly NewRecord[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    state: Readonly<GameState>,
    private readonly opts: PodiumOptions,
  ) {
    const depth = opts.depth;
    const add = <T extends Phaser.GameObjects.GameObject & { setDepth(d: number): T }>(obj: T): T => {
      this.parts.push(obj.setDepth(depth));
      return obj;
    };
    add(scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0b1026, 0.94).setInteractive());
    add(
      scene.add
        .text(GAME_W / 2, 34, 'Meci încheiat!', { fontFamily: FONT, fontSize: '30px', color: '#ffe066', stroke: '#7a1f2b', strokeThickness: 5 })
        .setOrigin(0.5),
    );

    this.recordText = add(
      scene.add
        .text(GAME_W / 2, 66, opts.online ? '' : 'Meciurile offline nu intră în clasament', {
          fontFamily: FONT,
          fontSize: opts.online ? '18px' : '13px',
          color: opts.online ? '#ffe066' : '#6f7a9a',
          align: 'center',
          wordWrap: { width: 900 },
        })
        .setOrigin(0.5),
    );

    const ranking = computeStandings(state as GameState).slice(0, 3);
    ranking.forEach((id, place) => this.addStep(state, id, place));

    this.table = new StandingsTable(scene, TABLE_X, TABLE_Y);
    this.table.update(state, opts.me, false);
    this.table.container.setDepth(depth).setAlpha(0);
    this.parts.push(this.table.container);
    scene.tweens.add({ targets: this.table.container, alpha: 1, delay: TABLE_DELAY, duration: 500 });

    this.addAwards(state);

    this.againButton = new TextButton(scene, GAME_W / 2, GAME_H - 38, opts.againLabel, opts.onAgain, 'primary', 20);
    add(this.againButton);
    this.waitText = add(
      scene.add
        .text(GAME_W / 2, GAME_H - 38, 'Hostul poate porni încă un meci.', { fontFamily: FONT, fontSize: '15px', color: '#9aa6c8' })
        .setOrigin(0.5),
    );
    this.update(state);
  }

  /** Keeps the table and the host's button current (players may leave, the host may change). */
  update(state: Readonly<GameState>, records: readonly NewRecord[] = []): void {
    this.table.update(state, this.opts.me, false);
    if (records !== this.recordsShown) this.showRecords(records);
    const isHost = state.hostId === this.opts.me;
    this.againButton.setVisible(isHost);
    this.waitText.setVisible(!isHost);
  }

  /** Mine first, as "Record nou! Locul X"; the others by name. */
  private showRecords(records: readonly NewRecord[]): void {
    this.recordsShown = records;
    if (!this.opts.online) return;
    const sorted = [...records].sort((a, b) => Number(b.playerId === this.opts.me) - Number(a.playerId === this.opts.me) || a.place - b.place);
    const parts = sorted.map((r) => (r.playerId === this.opts.me ? `Record nou! Locul ${r.place}` : `${r.name}: record nou, locul ${r.place}`));
    this.recordText.setText(parts.length > 0 ? `★ ${parts.join('  ·  ')} ★` : '');
    if (parts.length > 0) this.scene.tweens.add({ targets: this.recordText, scale: { from: 1.4, to: 1 }, duration: 400, ease: 'Back.easeOut' });
  }

  destroy(): void {
    for (const part of this.parts) part.destroy();
  }

  private addStep(state: Readonly<GameState>, id: string, place: number): void {
    const scene = this.scene;
    const depth = this.opts.depth;
    const p = state.players[id]!;
    const color = PLAYER_COLORS[p.slot]!;
    const { dx, h } = STEPS[place]!;
    const x = PODIUM_CX + dx;
    const delay = RISE_DELAYS[place]!;

    const step = scene.add.rectangle(x, BASE_Y, STEP_W, h, 0x24365e).setOrigin(0.5, 1).setStrokeStyle(2, color).setDepth(depth);
    const number = scene.add
      .text(x, BASE_Y - h / 2, String(place + 1), { fontFamily: FONT, fontSize: '36px', color: '#ffe066' })
      .setOrigin(0.5)
      .setDepth(depth)
      .setAlpha(0);
    const avatar = scene.add.image(x, BASE_Y - h - 26, TEX.player(p.slot)).setScale(1.5).setDepth(depth).setAlpha(0);
    const name = scene.add
      .text(x, BASE_Y - h - 64, p.name, { fontFamily: FONT, fontSize: '15px', color: css(color), stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(depth)
      .setAlpha(0);
    this.parts.push(step, number, avatar, name);

    step.scaleY = 0;
    scene.tweens.add({ targets: step, scaleY: 1, delay, duration: RISE_MS, ease: 'Back.easeOut' });
    scene.tweens.add({ targets: number, alpha: 1, delay: delay + RISE_MS * 0.6, duration: 250 });
    scene.tweens.add({ targets: avatar, alpha: 1, y: { from: avatar.y - 30, to: avatar.y }, delay: delay + RISE_MS, duration: 350, ease: 'Bounce.easeOut' });
    scene.tweens.add({ targets: name, alpha: 1, delay: delay + RISE_MS, duration: 300 });

    if (place === 0) {
      // The winner's fireworks, a few volleys over the podium.
      for (let i = 0; i < 7; i++) {
        scene.time.delayedCall(delay + RISE_MS + i * 380, () => {
          const fx = PODIUM_CX + Phaser.Math.Between(-170, 170);
          const fy = Phaser.Math.Between(70, 170);
          firework(scene, fx, fy, color, depth + 0.1, 36);
        });
      }
    }
  }

  private addAwards(state: Readonly<GameState>): void {
    const awards = computeAwards(state);
    if (awards.length === 0) return;
    const scene = this.scene;
    const depth = this.opts.depth;
    const top = BASE_Y + 32;
    const header = scene.add
      .text(GAME_W / 2, top, 'Premii', { fontFamily: FONT, fontSize: '15px', color: '#9aa6c8' })
      .setOrigin(0.5, 0)
      .setDepth(depth)
      .setAlpha(0);
    this.parts.push(header);
    const items: Phaser.GameObjects.GameObject[] = [header];
    awards.forEach((award, i) => {
      const y = top + 26 + i * 24;
      const text = AWARD_TEXT[award.id];
      const names = award.playerIds.map((id) => state.players[id]!.name).join(', ');
      const title = scene.add.text(GAME_W / 2 - 8, y, `★ ${text.title}`, { fontFamily: FONT, fontSize: '16px', color: '#ffe066' }).setOrigin(1, 0);
      const rest = scene.add.text(GAME_W / 2 + 8, y, `${names} · ${text.detail(award.value)}`, { fontFamily: FONT, fontSize: '16px', color: '#eaf2ff' });
      for (const part of [title, rest]) {
        part.setDepth(depth).setAlpha(0);
        this.parts.push(part);
        items.push(part);
      }
    });
    scene.tweens.add({ targets: items, alpha: 1, delay: TABLE_DELAY + 300, duration: 500 });
  }
}
