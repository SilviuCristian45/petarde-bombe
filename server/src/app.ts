import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { isValidRoomCode, normalizeRoomCode, ROOM_NAME } from '@petarde/shared';
import { BombeRoom } from './BombeRoom';
import { MAX_ROOMS } from './config';
import { roomCount, roomStatus } from './registry';

const health = createEndpoint('/health', { method: 'GET' }, async (ctx) =>
  ctx.json({ ok: true, rooms: roomCount(), maxRooms: MAX_ROOMS, uptime: Math.round(process.uptime()) }),
);

/** Why a join by code failed: Colyseus reports both a full and a running room as "locked". */
const roomInfo = createEndpoint('/rooms/:code', { method: 'GET' }, async (ctx) => {
  const code = normalizeRoomCode(ctx.params.code);
  return ctx.json({ status: isValidRoomCode(code) ? roomStatus(code) : 'missing' });
});

export function createServer() {
  return defineServer({
    transport: new WebSocketTransport(),
    rooms: { [ROOM_NAME]: defineRoom(BombeRoom) },
    routes: createRouter({ health, roomInfo }),
    greet: false,
  });
}
