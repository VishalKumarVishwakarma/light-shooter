import type { Room } from 'colyseus.js';
import { NetClient } from './NetClient';
import { SERVER_HTTP } from './serverUrl';

// Shared connection: MenuScene creates/joins, LobbyScene + ArenaScene reuse it.
const ADJ = ['Swift', 'Shadow', 'Blaze', 'Frost', 'Thunder', 'Ghost', 'Iron', 'Storm'];
const ANIMAL = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Viper', 'Raven', 'Tiger', 'Shark'];
export function randomName() {
  return ADJ[Math.floor(Math.random() * ADJ.length)] + ANIMAL[Math.floor(Math.random() * ANIMAL.length)];
}
export function cleanName(s: string) {
  return String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 12) || randomName();
}

export const Session = {
  net: new NetClient(),
  room: null as Room | null,
  // the PUBLIC 4-digit handle, kept alongside the room because the room id is
  // an internal string nobody should ever read out loud or type
  codeValue: '',
  // bumped by every create/join so an older, slower request can tell it has
  // been superseded and must not touch codeValue or room
  gen: 0,
  name: (() => {
    try { return cleanName(localStorage.getItem('shooter_name') || '') || randomName(); }
    catch { return randomName(); }
  })(),
  setName(n: string) {
    this.name = cleanName(n);
    try { localStorage.setItem('shooter_name', this.name); } catch { /* private mode */ }
  },
  get isHost() {
    const r: any = this.room;
    return !!r && r.sessionId === r.state?.hostId;
  },
  get code() {
    return this.codeValue || this.room?.id || '';
  },
  async leave() {
    // timeout-guarded: if the socket already died (kick/restart),
    // a bare leave() would wait forever for a confirmation that never comes
    if (!this.room) return;
    const r: any = this.room;
    this.room = null;
    try {
      await Promise.race([
        r.leave(),
        new Promise((res) => setTimeout(res, 2500)),
      ]);
    } catch { /* already gone */ }
    try { r.connection?.close(); } catch { /* noop */ }
  },
  // Serialises create/join. `await this.leave()` is not a lock: with no current
  // room it returns immediately, so two clicks interleaved freely. That burned
  // two POST /code calls (two live rooms, each holding its code for 5 minutes),
  // let the second call's leave() drop the seat the first had just taken, and --
  // worst -- left codeValue pointing at one room while this.room was the other,
  // so the host read out a code that led nowhere. Every await re-checks the
  // generation and a superseded request drops whatever it was holding.
  async createLobby(): Promise<Room> {
    const gen = ++this.gen;
    await this.leave(); // never hold ghost seats in two lobbies
    if (gen !== this.gen) throw new Error('superseded');
    // the server opens the room under a fresh 4-digit code, then we join it
    const code = await fetchNewCode();
    if (gen !== this.gen) throw new Error('superseded');
    const room = await this.net.joinById(await resolveRoom(code), this.name);
    if (gen !== this.gen) { void this.leave(); throw new Error('superseded'); }
    this.codeValue = code;
    this.room = room;
    return room;
  },
  async joinLobby(code: string): Promise<Room> {
    const clean = code.trim();
    if (!CODE_RE.test(clean)) throw new Error('codes are 4 digits');
    const gen = ++this.gen;
    await this.leave();
    if (gen !== this.gen) throw new Error('superseded');
    const roomId = await resolveRoom(clean); // 404s with a real reason
    if (gen !== this.gen) throw new Error('superseded');
    const room = await this.net.joinById(roomId, this.name);
    if (gen !== this.gen) { void this.leave(); throw new Error('superseded'); }
    this.codeValue = clean;
    this.room = room;
    return room;
  },
};

// a join code is always exactly four digits, never leading zero
export const CODE_RE = /^[1-9]\d{3}$/;

// Every fetch gets a deadline. A fetch only rejects on a network ERROR; a
// connection that is accepted but never answered (a sleeping laptop on the LAN,
// a hung process, a proxy) leaves the promise pending forever, which made every
// catch downstream unreachable dead code -- the boot screen froze at 67% and the
// lobby list latched "loading" with the manual-code link never rendered.
export const FETCH_TIMEOUT_MS = 8000;
export const fetchOpts = (init?: RequestInit): RequestInit => ({
  ...init,
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});

// the public code -> the room id Colyseus actually assigned
export async function resolveRoom(code: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_HTTP}/code/${encodeURIComponent(code)}`, fetchOpts());
  } catch {
    throw new Error('could not reach the server');
  }
  if (res.status === 404) throw new Error('no lobby with that code');
  if (!res.ok) throw new Error('could not reach the server');
  const { roomId } = await res.json();
  if (typeof roomId !== 'string' || !roomId) throw new Error('server sent a bad code');
  return roomId;
}

export async function fetchNewCode(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_HTTP}/code`, fetchOpts({ method: 'POST' }));
  } catch {
    throw new Error('could not reach the server');
  }
  if (res.status === 503) throw new Error('server is full, try again shortly');
  if (!res.ok) throw new Error('could not open a lobby');
  const { code } = await res.json();
  if (typeof code !== 'string' || !CODE_RE.test(code)) throw new Error('server sent a bad code');
  return code;
}

export async function fetchLobbies(): Promise<Array<{ code: string; players: number; max: number; phase: string }>> {
  const res = await fetch(`${SERVER_HTTP}/lobbies`, fetchOpts());
  if (!res.ok) throw new Error('lobby list failed');
  return res.json();
}
