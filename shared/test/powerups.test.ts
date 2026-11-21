import { describe, expect, it } from 'vitest';
import {
  CELL_BRICK,
  CELL_EMPTY,
  CURSE_TICKS,
  DIR_NONE,
  POWERUP_CURSE,
  POWERUP_KICK,
  POWERUP_PIERCE,
  POWERUP_SHIELD,
  POWERUP_WEIGHTS,
} from '../src/constants';
import { botAct } from '../src/bot';
import { cellCenter } from '../src/grid';
import { applyInput, explodeBombs, moveDir } from '../src/sim';
import type { GameEvent } from '../src/types';
import { addBomb, cellType, makeState, run } from './helpers';

describe('new power-ups', () => {
  it('picking them up sets the flags', () => {
    const s = makeState(['#######', '#1....#', '#######']);
    s.powerups.push({ x: 2, y: 1, type: POWERUP_KICK }, { x: 3, y: 1, type: POWERUP_SHIELD });
    s.powerups.push({ x: 4, y: 1, type: POWERUP_PIERCE });
    applyInput(s, { playerId: 'p1', action: 'right' });
    run(s, 16);
    const p = s.players.p1!;
    expect([p.kick, p.shield, p.pierce]).toEqual([true, true, true]);
    expect(p.pickups).toBe(3);
  });

  it('a kicked petard slides until something is in the way, keeping its fuse', () => {
    const s = makeState(['########', '#1.....#', '########']);
    s.players.p1!.kick = true;
    const bomb = addBomb(s, 2, 1, 'p1', 200);
    applyInput(s, { playerId: 'p1', action: 'right' });
    const events = run(s, 2);
    expect(events).toContainEqual({ type: 'kick', playerId: 'p1', x: 2, y: 1 });
    run(s, 12); // well before a lone player wins the round
    expect([bomb.x, bomb.y, bomb.dir]).toEqual([6, 1, DIR_NONE]);
    expect(bomb.fuse).toBe(200 - 14);
  });

  it('without the kick power-up a petard is just in the way', () => {
    const s = makeState(['########', '#1.....#', '########']);
    const bomb = addBomb(s, 2, 1, 'p1', 200);
    applyInput(s, { playerId: 'p1', action: 'right' });
    run(s, 10);
    expect([bomb.x, bomb.dir]).toEqual([2, DIR_NONE]);
    expect(s.players.p1!.x).toBe(cellCenter(1));
  });

  it('a sliding petard stops in front of a player', () => {
    const s = makeState(['########', '#1...2.#', '########']);
    s.players.p1!.kick = true;
    const bomb = addBomb(s, 2, 1, 'p1', 200);
    applyInput(s, { playerId: 'p1', action: 'right' });
    run(s, 20);
    expect(bomb.x).toBe(4);
  });

  it('a shield absorbs one blast, then the next one kills', () => {
    const s = makeState(['#######', '#1...2#', '#######']);
    s.players.p1!.shield = true;
    addBomb(s, 2, 1, 'p2', 1);
    const events: GameEvent[] = run(s, 1);
    expect(events).toContainEqual({ type: 'shieldLost', playerId: 'p1' });
    expect(s.players.p1!.alive).toBe(true);
    expect(s.players.p1!.shield).toBe(false);
    run(s, 40); // the flames die out and the grace period ends
    addBomb(s, 2, 1, 'p2', 1);
    run(s, 1);
    expect(s.players.p1!.alive).toBe(false);
    expect(s.players.p2!.kills).toBe(1);
  });

  it('a piercing blast goes through gifts and breaks them all', () => {
    const s = makeState(['#######', '#.++..#', '#######']);
    addBomb(s, 1, 1, 'x', 1, 3).pierce = true;
    explodeBombs(s, []);
    expect(cellType(s, 2, 1)).toBe(CELL_EMPTY);
    expect(cellType(s, 3, 1)).toBe(CELL_EMPTY);
    expect(s.flames.some((f) => f.x === 4 && f.y === 1)).toBe(true);

    const plain = makeState(['#######', '#.++..#', '#######']);
    addBomb(plain, 1, 1, 'x', 1, 3);
    explodeBombs(plain, []);
    expect(cellType(plain, 3, 1)).toBe(CELL_BRICK);
  });

  it('the curse reverses the controls for a while', () => {
    const s = makeState(['#######', '#..1..#', '#######']);
    const p = s.players.p1!;
    s.powerups.push({ x: 3, y: 1, type: POWERUP_CURSE });
    run(s, 1);
    expect(p.curseTicks).toBe(CURSE_TICKS);
    applyInput(s, { playerId: 'p1', action: 'right' });
    expect(moveDir(p)).not.toBe(p.dir);
    run(s, 3);
    expect(p.x).toBeLessThan(cellCenter(3));
    p.curseTicks = 1;
    run(s, 1);
    const x = p.x;
    run(s, 3);
    expect(p.x).toBeGreaterThan(x);
  });

  it('bots never go for the curse', () => {
    const s = makeState(['#######', '#1.+..#', '#######']);
    const p = s.players.p1!;
    p.isBot = true;
    s.powerups.push({ x: 2, y: 1, type: POWERUP_CURSE });
    for (let t = 0; t < 60; t++) {
      s.tick = t;
      const action = botAct(s, 'p1');
      if (action) applyInput(s, { playerId: 'p1', action });
      run(s, 1);
    }
    expect(p.curseTicks).toBe(0);
  });

  it('every type can drop', () => {
    expect(POWERUP_WEIGHTS.map(([type]) => type).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
