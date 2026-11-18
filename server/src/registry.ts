import type { RoomStatus } from '@petarde/shared';

// Live rooms of this process, by code. The server runs as a single Node process,
// so this is the whole picture (no Redis/presence needed).

export interface RoomEntry {
  status(): RoomStatus;
}

const rooms = new Map<string, RoomEntry>();

export function roomCount(): number {
  return rooms.size;
}

export function isCodeTaken(code: string): boolean {
  return rooms.has(code);
}

export function registerRoom(code: string, room: RoomEntry): void {
  rooms.set(code, room);
}

export function unregisterRoom(code: string): void {
  rooms.delete(code);
}

export function roomStatus(code: string): RoomStatus {
  return rooms.get(code)?.status() ?? 'missing';
}
