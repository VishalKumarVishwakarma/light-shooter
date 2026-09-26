// 4-digit join codes.
//
// Colyseus 0.15 always assigns its own roomId (handleCreateRoom calls
// generateId() and ignores clientOptions.roomId), so a code cannot BE the room
// id. Instead the code is a short public handle bound to the real room id, and
// joining resolves code -> roomId before the socket ever opens.
//
// Uniqueness is owned here, in-process, because matchMaker.query() reads a
// cached driver index that lags behind createRoom() and cannot be trusted to
// answer "is this code free?".
const CODE_MIN = 1000;
const CODE_MAX = 9999;
export const CODE_RE = /^[1-9]\d{3}$/; // exactly four digits, never leading zero

// code -> roomId, and the reverse so disposal can free the right entry
const byCode = new Map<string, string>();
const codeOf = new Map<string, string>();
// codes handed out but not yet bound to a created room
const pending = new Set<string>();

export function reserveCode(isLive: (code: string) => boolean = () => false): string {
  for (let i = 0; i < 500; i++) {
    const c = String(CODE_MIN + Math.floor(Math.random() * (CODE_MAX - CODE_MIN + 1)));
    if (pending.has(c) || byCode.has(c) || isLive(c)) continue;
    pending.add(c);
    return c;
  }
  return '';
}

// called once the room exists: code (already reserved) now points at it
export function bindCode(code: string, roomId: string) {
  if (!CODE_RE.test(code)) return;
  pending.delete(code);
  byCode.set(code, roomId);
  codeOf.set(roomId, code);
}

// a room created on some other path still needs to be reachable by a code
export function adoptRoom(roomId: string): string {
  const existing = codeOf.get(roomId);
  if (existing) return existing;
  const code = reserveCode((c) => c === roomId);
  if (code) bindCode(code, roomId);
  return code;
}

export function roomForCode(code: string): string | undefined {
  return byCode.get(code);
}

export function codeForRoom(roomId: string): string | undefined {
  return codeOf.get(roomId);
}

export function releaseRoom(roomId: string) {
  const code = codeOf.get(roomId);
  if (!code) return;
  codeOf.delete(roomId);
  byCode.delete(code);
  // in-flight reservation for a room that never came up
  pending.delete(code);
}

export function releasePending(code: string) {
  pending.delete(code);
}

export function liveCodeCount() {
  return byCode.size;
}
