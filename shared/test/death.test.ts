import { describe, expect, it } from 'vitest';
import { BOMB_FUSE_TICKS, COUNTDOWN_TICKS, POINTS_SUICIDE } from '../src/constants';
import { cellCenter, cellOf } from '../src/grid';
import { addBot, addPlayer, createGameState, onlyBotsAlive, startMatch } from '../src/match';
import { applyInput } from '../src/sim';
import type { GameEvent } from '../src/types';
import { run } from './helpers';

describe('human player death', () => {
  it('dies next to their own bomb in a real match, with -1 points', () => {
    // Same setup as LocalTransport: one human host plus bots on a generated map.
    const s = createGameState({ code: 'TESTAA', seed: 'death' });
    addPlayer(s, 'local', 'Jucător');
    addBot(s, 'local', 'bot1');
    addBot(s, 'local', 'bot2');
    expect(startMatch(s, 'local')).toBe(true);
    run(s, COUNTDOWN_TICKS);
    const me = s.players.local!;
    expect(me.isBot).toBe(false);
    const [sx, sy] = [cellOf(me.x), cellOf(me.y)];

    // Drop a petard, step one cell away (still inside its range) and stand still.
    applyInput(s, { playerId: 'local', action: 'bomb' });
    applyInput(s, { playerId: 'local', action: 'right' });
    const events: GameEvent[] = run(s, 5);
    applyInput(s, { playerId: 'local', action: 'stop' });
    events.push(...run(s, 1));
    expect(s.bombs).toEqual([expect.objectContaining({ x: sx, y: sy, owner: 'local' })]);
    expect(cellOf(me.x)).toBe(sx + 1);
    expect(me.y).toBe(cellCenter(sy));
    expect(me.alive).toBe(true);

    events.push(...run(s, BOMB_FUSE_TICKS));
    expect(me.alive).toBe(false);
    expect(me.deaths).toBe(1);
    expect(me.points).toBe(POINTS_SUICIDE);
    expect(me.kills).toBe(0);
    expect(events).toContainEqual({ type: 'death', playerId: 'local', killerId: 'local', suicide: true });
    // The bots are still alive, so the round goes on without the human.
    expect(s.phase).toBe('playing');
    expect(onlyBotsAlive(s)).toBe(true);
  });

  it('onlyBotsAlive is false while a human lives or outside a round', () => {
    const s = createGameState({ code: 'TESTAA', seed: 'death' });
    addPlayer(s, 'local', 'Jucător');
    addBot(s, 'local', 'bot1');
    expect(onlyBotsAlive(s)).toBe(false); // lobby
    startMatch(s, 'local');
    expect(onlyBotsAlive(s)).toBe(false); // human alive
    s.players.local!.alive = false;
    expect(onlyBotsAlive(s)).toBe(true);
    s.players.bot1!.alive = false;
    expect(onlyBotsAlive(s)).toBe(false); // nobody alive
  });
});
