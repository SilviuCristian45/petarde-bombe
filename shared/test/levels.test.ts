import { describe, expect, it } from 'vitest';
import { botAct, botDecide, botParams } from '../src/bot';
import { BOT_EASY, BOT_HARD, BOT_MEDIUM, DEFAULT_BOT_LEVEL } from '../src/constants';
import {
  addBot,
  addPlayer,
  createGameState,
  nextBotLevel,
  setBotLevel,
  setDefaultBotLevel,
  startMatch,
} from '../src/match';
import { runTick } from '../src/runner';
import { addBomb, makeState } from './helpers';

function lobby() {
  const s = createGameState({ code: 'NIVELE', seed: 5 });
  addPlayer(s, 'host', 'Gazda');
  addPlayer(s, 'guest', 'Oaspete');
  return s;
}

describe('bot level settings', () => {
  it('new bots get the room level, medium by default', () => {
    const s = lobby();
    expect(s.botLevel).toBe(DEFAULT_BOT_LEVEL);
    expect(DEFAULT_BOT_LEVEL).toBe(BOT_MEDIUM);
    addBot(s, 'host', 'b1');
    expect(setDefaultBotLevel(s, 'host', BOT_EASY)).toBe(true);
    addBot(s, 'host', 'b2');
    expect(s.players.b1!.botLevel).toBe(BOT_MEDIUM);
    expect(s.players.b2!.botLevel).toBe(BOT_EASY);
  });

  it('only the host, only in the lobby, only valid levels, only bots', () => {
    const s = lobby();
    addBot(s, 'host', 'b1');
    expect(setDefaultBotLevel(s, 'guest', BOT_HARD)).toBe(false);
    expect(setDefaultBotLevel(s, 'host', 3)).toBe(false);
    expect(setDefaultBotLevel(s, 'host', 0.5)).toBe(false);
    expect(setBotLevel(s, 'guest', 'b1', BOT_HARD)).toBe(false);
    expect(setBotLevel(s, 'host', 'guest', BOT_HARD)).toBe(false);
    expect(setBotLevel(s, 'host', 'nobody', BOT_HARD)).toBe(false);
    expect(setBotLevel(s, 'host', 'b1', -1)).toBe(false);
    expect(setBotLevel(s, 'host', 'b1', BOT_HARD)).toBe(true);
    expect(s.players.b1!.botLevel).toBe(BOT_HARD);
    startMatch(s, 'host');
    expect(setBotLevel(s, 'host', 'b1', BOT_EASY)).toBe(false);
    expect(setDefaultBotLevel(s, 'host', BOT_EASY)).toBe(false);
    expect(s.players.b1!.botLevel).toBe(BOT_HARD);
  });

  it('cycles easy -> medium -> hard -> easy', () => {
    expect([BOT_EASY, BOT_MEDIUM, BOT_HARD].map(nextBotLevel)).toEqual([BOT_MEDIUM, BOT_HARD, BOT_EASY]);
  });
});

describe('bot levels in play', () => {
  it('a hard bot decides every tick; an easy one only every few ticks', () => {
    const s = makeState(['#######', '#1....#', '#.#.#.#', '#....2#', '#######']);
    s.players.p1!.isBot = true;
    s.players.p1!.botLevel = BOT_EASY;
    addBomb(s, 1, 1, 'p1', 40, 2);
    const every = botParams(BOT_EASY).thinkEvery;
    expect(every).toBeGreaterThan(botParams(BOT_MEDIUM).thinkEvery);
    expect(botParams(BOT_HARD).thinkEvery).toBe(1);
    let decided = 0;
    for (let t = 0; t < every * 4; t++) {
      s.tick = t;
      s.players.p1!.dir = 0;
      if (botAct(s, 'p1') !== null) decided++;
    }
    expect(decided).toBe(4);
    s.players.p1!.botLevel = BOT_HARD;
    for (let t = 0; t < 8; t++) {
      s.tick = t;
      expect(botAct(s, 'p1')).toBe(botDecide(s, 'p1'));
    }
  });

  it('an easy bot still escapes its own petard', () => {
    const s = makeState(['#######', '#1+...#', '#.#.#.#', '#....2#', '#######']);
    s.players.p1!.isBot = true;
    s.players.p1!.botLevel = BOT_EASY;
    s.players.p2!.isBot = true;
    s.players.p2!.botLevel = BOT_EASY;
    for (let t = 0; t < 200; t++) runTick(s, []);
    expect(s.grid[1 * s.width + 2]).toBe(0);
    expect(s.players.p1!.alive).toBe(true);
  });

  it('mixed levels stay deterministic through the game loop', () => {
    const play = () => {
      const s = createGameState({ code: 'DETNIV', seed: 99 });
      addPlayer(s, 'host', 'Gazda');
      for (const [i, level] of [BOT_EASY, BOT_MEDIUM, BOT_HARD].entries()) {
        setDefaultBotLevel(s, 'host', level);
        addBot(s, 'host', `b${i}`);
      }
      startMatch(s, 'host');
      for (let t = 0; t < 1500; t++) runTick(s, []);
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });
});
