import {
  BOT_HARD,
  BOT_LEVELS,
  BOT_NAMES,
  DEFAULT_BOT_LEVEL,
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
import type { GameEvent, GameState, PlayerState } from './types';

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
    botLevel: DEFAULT_BOT_LEVEL,
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

/** Trimmed, at most MAX_NAME_LENGTH characters, without control or invisible formatting characters. */
export function sanitizeName(name: string): string {
  const clean = [...name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()].slice(0, MAX_NAME_LENGTH).join('').trim();
  return clean || 'Jucător';
}

export type JoinResult = { ok: true; player: PlayerState } | { ok: false; reason: 'in-progress' | 'full' | 'duplicate' };

/** Joins are only allowed in the lobby. The first human to join becomes host. */
export function addPlayer(state: GameState, id: string, name: string, isBot = false, botLevel = BOT_HARD): JoinResult {
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
    botLevel,
    connected: true,
    left: false,
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
    suicides: 0,
    bricks: 0,
    pickups: 0,
  };
  state.players[id] = player;
  if (!state.hostId && !isBot) state.hostId = id;
  return { ok: true, player };
}

/** Adds a bot with a free traditional name, at the room's current bot level. Host-only, lobby-only. */
export function addBot(state: GameState, byId: string, botId: string): JoinResult | { ok: false; reason: 'not-host' } {
  if (byId !== state.hostId) return { ok: false, reason: 'not-host' };
  const taken = new Set(Object.values(state.players).map((p) => p.name));
  const name = BOT_NAMES.find((n) => !taken.has(n)) ?? 'Bot';
  return addPlayer(state, botId, name, true, state.botLevel);
}

/** The level for bots added from now on ("Nivel boți"). Host-only, lobby-only. */
export function setDefaultBotLevel(state: GameState, byId: string, level: number): boolean {
  if (byId !== state.hostId || state.phase !== 'lobby' || !BOT_LEVELS.includes(level)) return false;
  state.botLevel = level;
  return true;
}

/** Changes one bot's level. Host-only, lobby-only. */
export function setBotLevel(state: GameState, byId: string, botId: string, level: number): boolean {
  const bot = state.players[botId];
  if (byId !== state.hostId || state.phase !== 'lobby' || !bot?.isBot || !BOT_LEVELS.includes(level)) return false;
  bot.botLevel = level;
  return true;
}

/** Easy -> medium -> hard -> easy, for the lobby's one-click level tag. */
export function nextBotLevel(level: number): number {
  return BOT_LEVELS[(BOT_LEVELS.indexOf(level) + 1) % BOT_LEVELS.length]!;
}

/** Removes the most recently added bot. Host-only, lobby-only. */
export function removeBot(state: GameState, byId: string): boolean {
  if (byId !== state.hostId || state.phase !== 'lobby') return false;
  const bot = Object.values(state.players)
    .filter((p) => p.isBot)
    .sort((a, b) => b.joinOrder - a.joinOrder)[0];
  if (!bot) return false;
  removePlayer(state, bot.id);
  return true;
}

/** Removes a player; if the host leaves, the next human by join order takes over. */
export function removePlayer(state: GameState, id: string): void {
  if (!state.players[id]) return;
  delete state.players[id];
  if (state.hostId === id) state.hostId = nextHost(state);
}

/**
 * A player gone for good (tab closed, reconnection window expired). In the lobby they are
 * removed; mid-match they die without crediting anyone and stay in the standings until the
 * lobby. Returns the death event, if any, so clients can show it.
 */
export function leavePlayer(state: GameState, id: string): GameEvent[] {
  const p = state.players[id];
  if (!p) return [];
  if (state.phase === 'lobby') {
    removePlayer(state, id);
    return [];
  }
  const events: GameEvent[] = [];
  p.left = true;
  p.connected = false;
  if (p.alive) {
    p.alive = false;
    p.dir = DIR_NONE;
    p.bombPressed = false;
    events.push({ type: 'death', playerId: id, killerId: '', suicide: false });
  }
  if (state.hostId === id) state.hostId = nextHost(state);
  return events;
}

/** The next host: the earliest-joined human still in the room, connected ones first. Never a bot. */
function nextHost(state: GameState): string {
  const next = Object.values(state.players)
    .filter((p) => !p.isBot && !p.left && p.id !== state.hostId)
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinOrder - b.joinOrder)[0];
  return next ? next.id : '';
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
    p.suicides = 0;
    p.bricks = 0;
    p.pickups = 0;
  }
  state.round = 1;
  prepareRound(state);
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
  for (const p of Object.values(state.players)) {
    if (p.left) delete state.players[p.id];
    else p.alive = false;
  }
  return true;
}

/** Lays out the next round's fresh seeded map; it is already shown (dimmed) during the intermission. */
export function prepareRound(state: GameState): void {
  state.grid = generateGrid(state);
  state.bombs = [];
  state.flames = [];
  state.powerups = [];
  state.shrinkIndex = 0;
}

/** Everyone back at their spawn with base stats, on the map laid out by prepareRound. */
export function startRound(state: GameState): void {
  state.phase = 'playing';
  state.roundTick = 0;
  state.phaseTimer = 0;
  state.endingTimer = 0;
  state.roundWinner = '';
  const spawns = spawnPoints(state.width, state.height);
  for (const p of sortedPlayers(state)) {
    const [sx, sy] = spawns[p.slot]!;
    p.alive = !p.left;
    p.x = cellCenter(sx);
    p.y = cellCenter(sy);
    p.dir = DIR_NONE;
    p.bombPressed = false;
    p.maxBombs = START_BOMBS;
    p.range = START_RANGE;
    p.speed = START_SPEED;
  }
}

/** Mid-round with no human left alive but bots still fighting; the round can be fast-forwarded. */
export function onlyBotsAlive(state: GameState): boolean {
  const alive = Object.values(state.players).filter((p) => p.alive);
  return state.phase === 'playing' && alive.length > 0 && alive.every((p) => p.isBot);
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
