import { describe, expect, it } from 'vitest';
import { addBot, addPlayer, backToLobby, createGameState, leavePlayer, startMatch } from '../src/match';
import { skipBotRound } from '../src/runner';
import { step } from '../src/sim';

function match() {
  const state = createGameState({ code: 'ABCDEF', seed: 7 });
  addPlayer(state, 'ana', 'Ana');
  addPlayer(state, 'ion', 'Ion');
  addBot(state, 'ana', 'bot1');
  startMatch(state, 'ana');
  return state;
}

describe('leaving', () => {
  it('in the lobby removes the player and passes the host to the next human', () => {
    const state = createGameState({ code: 'ABCDEF', seed: 1 });
    addPlayer(state, 'ana', 'Ana');
    addBot(state, 'ana', 'bot1');
    addPlayer(state, 'ion', 'Ion');
    expect(leavePlayer(state, 'ana')).toEqual([]);
    expect(state.players.ana).toBeUndefined();
    expect(state.hostId).toBe('ion');
  });

  it('mid-round kills the player without crediting a kill', () => {
    const state = match();
    const events = leavePlayer(state, 'ion');
    expect(events).toEqual([{ type: 'death', playerId: 'ion', killerId: '', suicide: false }]);
    const ion = state.players.ion!;
    expect(ion.alive).toBe(false);
    expect(ion.left).toBe(true);
    expect(ion.connected).toBe(false);
    expect(ion.deaths).toBe(0);
    expect(Object.values(state.players).every((p) => p.kills === 0 && p.points === 0)).toBe(true);
  });

  it('keeps the player in the standings until the lobby, without respawning', () => {
    const state = match();
    leavePlayer(state, 'ion');
    leavePlayer(state, 'ana'); // host leaves too: only the bot is alive
    expect(state.hostId).toBe('');
    skipBotRound(state);
    expect(state.phase).toBe('intermission');
    while (state.phase === 'intermission') step(state);
    expect(state.players.ion!.alive).toBe(false);
    expect(state.players.bot1!.alive).toBe(true);
  });

  it('passes the host to a connected human, never to a bot, and drops leavers in the lobby', () => {
    const state = match();
    leavePlayer(state, 'ana');
    expect(state.hostId).toBe('ion');
    state.phase = 'finished';
    expect(backToLobby(state, 'ion')).toBe(true);
    expect(state.players.ana).toBeUndefined();
    expect(Object.keys(state.players).sort()).toEqual(['bot1', 'ion']);
  });

  it('prefers a connected human over one waiting to reconnect', () => {
    const lobby = createGameState({ code: 'ABCDEF', seed: 1 });
    addPlayer(lobby, 'ana', 'Ana');
    addPlayer(lobby, 'ion', 'Ion');
    addPlayer(lobby, 'eva', 'Eva');
    startMatch(lobby, 'ana');
    lobby.players.ion!.connected = false;
    leavePlayer(lobby, 'ana');
    expect(lobby.hostId).toBe('eva');
  });
});
