import type { Action } from '@petarde/shared';

/** Turns a device (keyboard now, touch later) into game actions. Polled once per frame. */
export interface InputSource {
  /** Actions produced since the last poll, in order. */
  poll(): Action[];
  /** Forget what was sent, so a still-held direction is sent again (e.g. at round start). */
  reset(): void;
  destroy(): void;
}
