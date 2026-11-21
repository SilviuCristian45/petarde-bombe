import type { ArraySchema, MapSchema } from '@colyseus/schema';
import type { GameState } from '@petarde/shared';
import { BombSchema, FlameSchema, PlayerSchema, PowerUpSchema, type RoomState } from './schema';

// Copies the authoritative GameState into the schema after every tick. Only values that
// differ are assigned, so a patch carries just what changed. The simulation never reads
// the schema: determinism lives entirely in GameState.

const STATE_KEYS = [
  'code',
  'phase',
  'hostId',
  'roundsTotal',
  'botLevel',
  'round',
  'tick',
  'roundTick',
  'phaseTimer',
  'endingTimer',
  'roundWinner',
  'shrinkIndex',
  'width',
  'height',
] as const;
const PLAYER_KEYS = [
  'id',
  'name',
  'slot',
  'joinOrder',
  'isBot',
  'botLevel',
  'connected',
  'left',
  'alive',
  'x',
  'y',
  'dir',
  'maxBombs',
  'range',
  'speed',
  'kick',
  'pierce',
  'shield',
  'graceTicks',
  'curseTicks',
  'wins',
  'kills',
  'deaths',
  'points',
  'suicides',
  'bricks',
  'pickups',
] as const;
const BOMB_KEYS = ['id', 'x', 'y', 'owner', 'fuse', 'range', 'pierce', 'dir'] as const;
const FLAME_KEYS = ['x', 'y', 'ttl', 'owner'] as const;
const POWERUP_KEYS = ['x', 'y', 'type'] as const;

export function mirror(src: Readonly<GameState>, dst: RoomState): void {
  assign(dst, src, STATE_KEYS);

  const grid = dst.grid;
  while (grid.length > src.grid.length) grid.pop();
  for (let i = 0; i < src.grid.length; i++) {
    const cell = src.grid[i]!;
    if (i >= grid.length) grid.push(cell);
    else if (grid[i] !== cell) grid[i] = cell;
  }

  syncPlayers(src, dst.players);
  syncList(dst.bombs, src.bombs, () => new BombSchema(), BOMB_KEYS);
  syncList(dst.flames, src.flames, () => new FlameSchema(), FLAME_KEYS);
  syncList(dst.powerups, src.powerups, () => new PowerUpSchema(), POWERUP_KEYS);
}

function syncPlayers(src: Readonly<GameState>, dst: MapSchema<PlayerSchema>): void {
  for (const id of [...dst.keys()]) if (!src.players[id]) dst.delete(id);
  for (const p of Object.values(src.players)) {
    let view = dst.get(p.id);
    if (!view) {
      view = new PlayerSchema();
      assign(view, p, PLAYER_KEYS);
      dst.set(p.id, view);
    } else assign(view, p, PLAYER_KEYS);
  }
}

/** Keeps `dst` the same length as `src`, updating elements in place by index. */
function syncList<K extends string, D extends Fields<K>>(
  dst: ArraySchema<D>,
  src: readonly Fields<K>[],
  create: () => D,
  keys: readonly K[],
): void {
  while (dst.length > src.length) dst.pop();
  src.forEach((item, i) => {
    if (i < dst.length) assign(dst[i]!, item, keys);
    else {
      const view = create();
      assign(view, item, keys);
      dst.push(view);
    }
  });
}

type Fields<K extends string> = { [P in K]: unknown };

/** Both sides must have every key; values are copied as-is (the schema field types mirror GameState). */
function assign<K extends string>(dst: Fields<K>, src: Readonly<Fields<K>>, keys: readonly K[]): void {
  for (const key of keys) {
    if (dst[key] !== src[key]) dst[key] = src[key];
  }
}
