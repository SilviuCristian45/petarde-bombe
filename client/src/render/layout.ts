import { GRID_H, GRID_W, SUB } from '@petarde/shared';
import { isTouch } from '../device';

// Screen layout. Desktop: a 960x540 canvas, the board on the left, the HUD on the right.
// Touch: a wider canvas with a thumb zone on each side of the board (D-pad / buttons on one,
// HUD / petard button on the other), so the controls never cover the arena.

export const TOUCH_LAYOUT = isTouch;
export const TILE = 40;
export const BOARD_W = GRID_W * TILE;
export const BOARD_H = GRID_H * TILE;
/** Touch: width of each zone beside the board. */
export const SIDE_W = 230;
export const GAME_W = TOUCH_LAYOUT ? BOARD_W + 2 * SIDE_W : 960;
export const GAME_H = 540;
export const BOARD_X = TOUCH_LAYOUT ? SIDE_W : 10;
export const BOARD_Y = 10;
export const HUD_X = BOARD_X + BOARD_W + (TOUCH_LAYOUT ? 14 : 16);
export const HUD_W = GAME_W - HUD_X - 10;

export function cellToScreenX(cx: number): number {
  return BOARD_X + cx * TILE + TILE / 2;
}

export function cellToScreenY(cy: number): number {
  return BOARD_Y + cy * TILE + TILE / 2;
}

/** Sub-unit position (player center) to screen pixels. */
export function subToScreenX(x: number): number {
  return BOARD_X + (x / SUB) * TILE;
}

export function subToScreenY(y: number): number {
  return BOARD_Y + (y / SUB) * TILE;
}

// Consolas is what "monospace" already meant on Windows; iOS would otherwise fall back to Courier.
export const FONT = "Consolas, Menlo, 'Roboto Mono', 'Droid Sans Mono', monospace";
