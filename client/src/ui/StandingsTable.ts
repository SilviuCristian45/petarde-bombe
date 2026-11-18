import Phaser from 'phaser';
import { computeStandings, MAX_PLAYERS, PLAYER_COLORS, type GameState } from '@petarde/shared';
import { FONT } from '../render/layout';

// Position, name in the player's color, wins, kills, deaths, points. Used by the Tab overlay
// during a match and by the full table on the final screen.

const ROW_H = 30;
const GRAY = '#5c6680';
/** Column x offsets from the table's left edge; the name takes the room up to the first number. */
const COLS = { pos: 0, swatch: 34, name: 52, wins: 290, kills: 352, deaths: 410, points: 470 } as const;
export const TABLE_W = 500;
export const TABLE_H = ROW_H * (MAX_PLAYERS + 1);

interface Row {
  pos: Phaser.GameObjects.Text;
  swatch: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  nums: Phaser.GameObjects.Text[];
}

export class StandingsTable {
  readonly container: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const style = { fontFamily: FONT, fontSize: '16px', color: '#ffffff' };
    const head = { ...style, fontSize: '13px', color: '#9aa6c8' };
    const items: Phaser.GameObjects.GameObject[] = [
      scene.add.text(COLS.pos, 0, '#', head),
      scene.add.text(COLS.name, 0, 'Jucător', head),
      ...(['wins', 'kills', 'deaths', 'points'] as const).map((col, i) =>
        scene.add.text(COLS[col], 0, ['Victorii', 'Kill', 'Morți', 'Puncte'][i]!, head).setOrigin(0.5, 0),
      ),
    ];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const ry = ROW_H * (i + 1);
      const row: Row = {
        pos: scene.add.text(COLS.pos, ry, '', style),
        swatch: scene.add.rectangle(COLS.swatch, ry + 10, 12, 12, 0xffffff).setOrigin(0, 0.5),
        name: scene.add.text(COLS.name, ry, '', style),
        nums: (['wins', 'kills', 'deaths', 'points'] as const).map((col) => scene.add.text(COLS[col], ry, '', style).setOrigin(0.5, 0)),
      };
      this.rows.push(row);
      items.push(row.pos, row.swatch, row.name, ...row.nums);
    }
    this.container = scene.add.container(x, y, items);
  }

  /** `dimDead`: during a round the dead are shown in gray. */
  update(state: Readonly<GameState>, me: string, dimDead: boolean): void {
    const ids = computeStandings(state as GameState);
    this.rows.forEach((row, i) => {
      const p = ids[i] !== undefined ? state.players[ids[i]!] : undefined;
      const parts = [row.pos, row.swatch, row.name, ...row.nums];
      for (const part of parts) part.setVisible(!!p);
      if (!p) return;
      const gray = p.left || (dimDead && !p.alive);
      const tag = p.left ? ' (a ieșit)' : p.id === me ? ' (tu)' : '';
      row.pos.setText(`${i + 1}.`).setColor(gray ? GRAY : '#ffffff');
      row.swatch.setFillStyle(PLAYER_COLORS[p.slot]!).setAlpha(gray ? 0.35 : 1);
      row.name.setText(fit(p.name + tag, 20)).setColor(gray ? GRAY : css(PLAYER_COLORS[p.slot]!));
      [p.wins, p.kills, p.deaths, p.points].forEach((value, k) => row.nums[k]!.setText(String(value)).setColor(gray ? GRAY : '#ffffff'));
    });
  }
}

function fit(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
