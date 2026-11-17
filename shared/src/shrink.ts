import { SHRINK_INTERVAL_TICKS, SHRINK_START_TICKS } from './constants';

// The arena closes in from the edges in a clockwise spiral, outermost ring first.

const cache = new Map<string, number[]>();

/** Interior cell indices in the order they get walled in. */
export function shrinkOrder(width: number, height: number): number[] {
  const key = `${width}x${height}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const order: number[] = [];
  let left = 1;
  let top = 1;
  let right = width - 2;
  let bottom = height - 2;
  while (left <= right && top <= bottom) {
    for (let x = left; x <= right; x++) order.push(top * width + x);
    for (let y = top + 1; y <= bottom; y++) order.push(y * width + right);
    if (top < bottom) for (let x = right - 1; x >= left; x--) order.push(bottom * width + x);
    if (left < right) for (let y = bottom - 1; y > top; y--) order.push(y * width + left);
    left++;
    top++;
    right--;
    bottom--;
  }
  cache.set(key, order);
  return order;
}

/** Whether the arena closes one more cell on this round tick. */
export function isShrinkTick(roundTick: number): boolean {
  return roundTick >= SHRINK_START_TICKS && (roundTick - SHRINK_START_TICKS) % SHRINK_INTERVAL_TICKS === 0;
}
