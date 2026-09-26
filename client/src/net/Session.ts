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
  async createLobby(): Promise<Room> {
    await this.leave(); // never hold ghost seats in two lobbies
    // the server opens the room under a fresh 4-digit code, then we join it
    const code = await fetchNewCode();
    this.codeValue = code;
    this.room = await this.net.joinById(await resolveRoom(code), this.name);
    return this.room;
  },
  async joinLobby(code: string): Promise<Room> {
    await this.leave();
    const clean = code.trim();
    if (!CODE_RE.test(clean)) throw new Error('codes are 4 digits');
    const roomId = await resolveRoom(clean); // 404s with a real reason
    this.codeValue = clean;
    this.room = await this.net.joinById(roomId, this.name);
    return this.room;
  },
};

// a join code is always exactly four digits, never leading zero
export const CODE_RE = /^[1-9]\d{3}$/;

// the public code -> the room id Colyseus actually assigned
export async function resolveRoom(code: string): Promise<string> {
  const res = await fetch(`${SERVER_HTTP}/code/${encodeURIComponent(code)}`);
  if (res.status === 404) throw new Error('no lobby with that code');
  if (!res.ok) throw new Error('could not reach the server');
  const { roomId } = await res.json();
  if (typeof roomId !== 'string' || !roomId) throw new Error('server sent a bad code');
  return roomId;
}

export async function fetchNewCode(): Promise<string> {
  const res = await fetch(`${SERVER_HTTP}/code`, { method: 'POST' });
  if (!res.ok) throw new Error('could not open a lobby');
  const { code } = await res.json();
  if (typeof code !== 'string' || !CODE_RE.test(code)) throw new Error('server sent a bad code');
  return code;
}

export async function fetchLobbies(): Promise<Array<{ code: string; players: number; max: number; phase: string }>> {
  const res = await fetch(`${SERVER_HTTP}/lobbies`);
  if (!res.ok) throw new Error('lobby list failed');
  return res.json();
}
