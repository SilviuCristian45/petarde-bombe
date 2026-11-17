import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, MAX_PLAYERS } from '../src/constants';
import {
  addBot,
  addPlayer,
  backToLobby,
  canStart,
  createGameState,
  removePlayer,
  sanitizeName,
  setRounds,
  startMatch,
} from '../src/match';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET } from '../src/roomCode';

const lobby = () => createGameState({ code: 'ABCDEF', seed: 1 });

describe('room codes', () => {
  it('are 6 characters without look-alikes', () => {
    let seed = 1;
    const random = () => ((seed = (Math.imul(seed, 48271) + 1) >>> 0) / 4294967296);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(random);
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01OIL]/);
      expect(isValidRoomCode(code)).toBe(true);
    }
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('retry when a code is taken', () => {
    const values = [0, 0, 0, 0, 0, 0, 0.99, 0, 0, 0, 0, 0];
    let i = 0;
    const code = generateRoomCode(() => values[i++]!, (c) => c === 'AAAAAA');
    expect(code).toBe('9AAAAA');
  });

  it('normalize user input', () => {
    expect(normalizeRoomCode(' ab cd2f ')).toBe('ABCD2F');
    expect(isValidRoomCode('ABCD0F')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
  });
});

describe('lobby', () => {
  it('first human is host, slots are assigned in order', () => {
    const s = lobby();
    addPlayer(s, 'a', 'Ana');
    addPlayer(s, 'b', 'Bogdan');
    expect(s.hostId).toBe('a');
    expect(s.players.a!.slot).toBe(0);
    expect(s.players.b!.slot).toBe(1);
  });

  it('caps the room at 6 players', () => {
    const s = lobby();
    for (let i = 0; i < MAX_PLAYERS; i++) expect(addPlayer(s, `p${i}`, `P${i}`).ok).toBe(true);
    expect(addPlayer(s, 'extra', 'X')).toEqual({ ok: false, reason: 'full' });
  });

  it('reuses a freed slot', () => {
    const s = lobby();
    addPlayer(s, 'a', 'A');
    addPlayer(s, 'b', 'B');
    addPlayer(s, 'c', 'C');
    removePlayer(s, 'b');
    addPlayer(s, 'd', 'D');
    expect(s.players.d!.slot).toBe(1);
  });

  it('passes host to the next human by join order', () => {
    const s = lobby();
    addPlayer(s, 'a', 'A');
    addBot(s, 'a', 'bot');
    addPlayer(s, 'b', 'B');
    addPlayer(s, 'c', 'C');
    removePlayer(s, 'a');
    expect(s.hostId).toBe('b');
    removePlayer(s, 'b');
    removePlayer(s, 'c');
    expect(s.hostId).toBe('');
  });

  it('only the host can add bots; bots get traditional names', () => {
    const s = lobby();
    addPlayer(s, 'a', 'A');
    addPlayer(s, 'b', 'B');
    expect(addBot(s, 'b', 'x').ok).toBe(false);
    const r = addBot(s, 'a', 'x');
    expect(r.ok).toBe(true);
    expect(s.players.x!.isBot).toBe(true);
    expect(s.players.x!.name).toBe('Capra');
  });

  it('rejects joins during a match', () => {
    const s = lobby();
    addPlayer(s, 'a', 'A');
    addPlayer(s, 'b', 'B');
    expect(startMatch(s, 'a')).toBe(true);
    expect(addPlayer(s, 'late', 'L')).toEqual({ ok: false, reason: 'in-progress' });
  });

  it('host picks 3/5/7 rounds', () => {
    const s = lobby();
    addPlayer(s, 'a', 'A');
    addPlayer(s, 'b', 'B');
    expect(setRounds(s, 'b', 5)).toBe(false);
    expect(setRounds(s, 'a', 4)).toBe(false);
    expect(setRounds(s, 'a', 7)).toBe(true);
    expect(s.roundsTotal).toBe(7);
  });

  it('needs the host and at least 2 players (bots count) to start', () => {
    const s = lobby();
    addPlayer(s, 'a', 'A');
    expect(canStart(s, 'a')).toBe(false);
    addBot(s, 'a', 'bot');
    expect(canStart(s, 'bot')).toBe(false);
    expect(startMatch(s, 'a')).toBe(true);
    expect(s.phase).toBe('playing');
    expect(s.round).toBe(1);
    expect(Object.values(s.players).every((p) => p.alive)).toBe(true);
  });

  it('"another match" returns everyone to the lobby of the same room', () => {
    const s = lobby();
    addPlayer(s, 'a', 'A');
    addPlayer(s, 'b', 'B');
    startMatch(s, 'a');
    s.phase = 'finished';
    s.players.a!.points = 9;
    expect(backToLobby(s, 'b')).toBe(false);
    expect(backToLobby(s, 'a')).toBe(true);
    expect(s.phase).toBe('lobby');
    expect(s.code).toBe('ABCDEF');
    expect(addPlayer(s, 'c', 'C').ok).toBe(true);
    startMatch(s, 'a');
    expect(s.players.a!.points).toBe(0);
  });

  it('sanitizes nicknames', () => {
    expect(sanitizeName('  Ion  ')).toBe('Ion');
    expect(sanitizeName('x'.repeat(30))).toHaveLength(MAX_NAME_LENGTH);
    expect(sanitizeName('   ')).toBe('Jucător');
    expect(sanitizeName('a\u0007b')).toBe('ab');
  });
});
