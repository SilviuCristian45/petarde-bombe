import { schema, t, type SchemaType } from '@colyseus/schema';

// Synchronized mirror of the shared GameState (see mirror.ts). Server-only fields
// (rng, nextId, joinCounter, bombPressed) are left out.

export const PlayerSchema = schema(
  {
    id: t.string(),
    name: t.string(),
    slot: t.uint8(),
    joinOrder: t.uint32(),
    isBot: t.boolean(),
    botLevel: t.uint8(),
    connected: t.boolean(),
    left: t.boolean(),
    alive: t.boolean(),
    x: t.int32(),
    y: t.int32(),
    dir: t.uint8(),
    maxBombs: t.uint8(),
    range: t.uint8(),
    speed: t.uint16(),
    kick: t.boolean(),
    pierce: t.boolean(),
    shield: t.boolean(),
    graceTicks: t.uint8(),
    curseTicks: t.uint16(),
    wins: t.uint16(),
    kills: t.uint16(),
    deaths: t.uint16(),
    points: t.int16(),
    suicides: t.uint16(),
    bricks: t.uint16(),
    pickups: t.uint16(),
  },
  'Player',
);
export type PlayerSchema = SchemaType<typeof PlayerSchema>;

export const BombSchema = schema(
  {
    id: t.uint32(),
    x: t.uint8(),
    y: t.uint8(),
    owner: t.string(),
    fuse: t.uint8(),
    range: t.uint8(),
    pierce: t.boolean(),
    dir: t.uint8(),
  },
  'Bomb',
);
export type BombSchema = SchemaType<typeof BombSchema>;

export const FlameSchema = schema({ x: t.uint8(), y: t.uint8(), ttl: t.uint8(), owner: t.string() }, 'Flame');
export type FlameSchema = SchemaType<typeof FlameSchema>;

export const PowerUpSchema = schema({ x: t.uint8(), y: t.uint8(), type: t.uint8() }, 'PowerUp');
export type PowerUpSchema = SchemaType<typeof PowerUpSchema>;

export const RoomState = schema(
  {
    code: t.string(),
    phase: t.string(),
    hostId: t.string(),
    roundsTotal: t.uint8(),
    botLevel: t.uint8(),
    round: t.uint8(),
    tick: t.uint32(),
    roundTick: t.uint32(),
    phaseTimer: t.uint16(),
    endingTimer: t.uint16(),
    roundWinner: t.string(),
    shrinkIndex: t.uint16(),
    width: t.uint8(),
    height: t.uint8(),
    grid: t.array('uint8'),
    players: t.map(PlayerSchema),
    bombs: t.array(BombSchema),
    flames: t.array(FlameSchema),
    powerups: t.array(PowerUpSchema),
  },
  'RoomState',
);
export type RoomState = SchemaType<typeof RoomState>;
