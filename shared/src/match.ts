import {
  BOT_NAMES,
  DEFAULT_ROUNDS,
  DIR_NONE,
  GRID_H,
  GRID_W,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  ROUND_OPTIONS,
  START_BOMBS,
  START_RANGE,
  START_SPEED,
} from './constants';
import { cellCenter, generateGrid, spawnPoints } from './grid';
import { seedFrom } from './rng';
import type { GameState, PlayerState } from './types';

export interface CreateOptions {
  code: string;
  seed: number | string;
  width?: number;
  height?: number;
}

export function createGameState(opts: CreateOptions): GameState {
  const width = opts.width ?? GRID_W;
  const height = opts.height ?? GRID_H;
  return {
    code: opts.code,
    phase: 'lobby',
    hostId: '',
    roundsTotal: DEFAULT_ROUNDS,
    round: 0,
    tick: 0,
    roundTick: 0,
    phaseTimer: 0,
    endingTimer: 0,
    roundWinner: '',
    rng: seedFrom(opts.seed),
    nextId: 1,
    joinCounter: 0,
    shrinkIndex: 0,
    width,
    height,
    grid: new Array(width * height).fill(0),
    players: {},
    bombs: [],
    flames: [],
    powerups: [],
  };
}

/** Players ordered by slot; every per-player loop uses this order for determinism. */
export function sortedPlayers(state: GameState): PlayerState[] {
  return Object.values(state.players).sort((a, b) => a.slot - b.slot);
}

export function sanitizeName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return clean || 'Jucător';
}

export type JoinResult = { ok: true; player: PlayerState } | { ok: false; reason: 'in-progress' | 'full' | 'duplicate' };

/** Joins are only allowed in the lobby. The first human to join becomes host. */
export function addPlayer(state: GameState, id: string, name: string, isBot = false): JoinResult {
  if (state.phase !== 'lobby') return { ok: false, reason: 'in-progress' };
  if (state.players[id]) return { ok: false, reason: 'duplicate' };
  const used = new Set(Object.values(state.players).map((p) => p.slot));
  if (used.size >= MAX_PLAYERS) return { ok: false, reason: 'full' };
  let slot = 0;
  while (used.has(slot)) slot++;
  const player: PlayerState = {
    id,
    name: sanitizeName(name),
    slot,
    joinOrder: state.joinCounter++,
    isBot,
    connected: true,
    alive: false,
    x: 0,
    y: 0,
    dir: DIR_NONE,
    bombPressed: false,
    maxBombs: START_BOMBS,
    range: START_RANGE,
    speed: START_SPEED,
    wins: 0,
    kills: 0,
    deaths: 0,
    points: 0,
  };
  state.players[id] = player;
  if (!state.hostId && !isBot) state.hostId = id;
  return { ok: true, player };
}

/** Adds a bot with a free traditional name. Host-only, lobby-only. */
export function addBot(state: GameState, byId: string, botId: string): JoinResult | { ok: false; reason: 'not-host' } {
  if (byId !== state.hostId) return { ok: false, reason: 'not-host' };
  const taken = new Set(Object.values(state.players).map((p) => p.name));
  const name = BOT_NAMES.find((n) => !taken.has(n)) ?? 'Bot';
  return addPlayer(state, botId, name, true);
}

/** Removes a player; if the host leaves, the next human by join order takes over. */
export function removePlayer(state: GameState, id: string): void {
  if (!state.players[id]) return;
  delete state.players[id];
  if (state.hostId === id) {
    const next = Object.values(state.players)
      .filter((p) => !p.isBot)
      .sort((a, b) => a.joinOrder - b.joinOrder)[0];
    state.hostId = next ? next.id : '';
  }
}

/** Marks a player as temporarily disconnected (they keep their place for reconnection). */
export function setConnected(state: GameState, id: string, connected: boolean): void {
  const p = state.players[id];
  if (p) p.connected = connected;
}

export function setRounds(state: GameState, byId: string, rounds: number): boolean {
  if (byId !== state.hostId || state.phase !== 'lobby' || !ROUND_OPTIONS.includes(rounds)) return false;
  state.roundsTotal = rounds;
  return true;
}

export function canStart(state: GameState, byId: string): boolean {
  return (
    byId === state.hostId && state.phase === 'lobby' && Object.keys(state.players).length >= MIN_PLAYERS_TO_START
  );
}

/** Host starts the match from the lobby: scores reset, round 1 begins. */
export function startMatch(state: GameState, byId: string): boolean {
  if (!canStart(state, byId)) return false;
  for (const p of Object.values(state.players)) {
    p.wins = 0;
    p.kills = 0;
    p.deaths = 0;
    p.points = 0;
  }
  state.round = 1;
  startRound(state);
  return true;
}

/** "Încă un meci": host sends everyone back to the lobby of the same room. */
export function backToLobby(state: GameState, byId: string): boolean {
  if (byId !== state.hostId || state.phase !== 'finished') return false;
  state.phase = 'lobby';
  state.round = 0;
  state.roundWinner = '';
  state.bombs = [];
  state.flames = [];
  state.powerups = [];
  for (const p of Object.values(state.players)) p.alive = false;
  return true;
}

/** Fresh seeded map, everyone back at their spawn with base stats. */
export function startRound(state: GameState): void {
  state.phase = 'playing';
  state.grid = generateGrid(state);
  state.bombs = [];
  state.flames = [];
  state.powerups = [];
  state.roundTick = 0;
  state.phaseTimer = 0;
  state.endingTimer = 0;
  state.shrinkIndex = 0;
  state.roundWinner = '';
  const spawns = spawnPoints(state.width, state.height);
  for (const p of sortedPlayers(state)) {
    const [sx, sy] = spawns[p.slot]!;
    p.alive = true;
    p.x = cellCenter(sx);
    p.y = cellCenter(sy);
    p.dir = DIR_NONE;
    p.bombPressed = false;
    p.maxBombs = START_BOMBS;
    p.range = START_RANGE;
    p.speed = START_SPEED;
  }
}

/** Player ids ranked by points, then wins, kills, fewest deaths, slot. */
export function computeStandings(state: GameState): string[] {
  return Object.values(state.players)
    .sort(
      (a, b) =>
        b.points - a.points || b.wins - a.wins || b.kills - a.kills || a.deaths - b.deaths || a.slot - b.slot,
    )
    .map((p) => p.id);
}
