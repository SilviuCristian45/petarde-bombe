import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/index';

describe('shared', () => {
  it('runs at 20 ticks per second', () => {
    expect(TICK_RATE).toBe(20);
  });
});
