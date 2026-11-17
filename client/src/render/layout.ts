import { GRID_H, GRID_W, SUB } from '@petarde/shared';

// Screen layout for the 960x540 canvas: the board on the left, the HUD on the right.

export const GAME_W = 960;
export const GAME_H = 540;
export const TILE = 40;
export const BOARD_X = 10;
export const BOARD_Y = 10;
export const BOARD_W = GRID_W * TILE;
export const BOARD_H = GRID_H * TILE;
export const HUD_X = BOARD_X + BOARD_W + 16;
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

export const FONT = 'monospace';
