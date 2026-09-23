import type { Room } from 'colyseus.js';
import { NetClient } from './NetClient';

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
    return this.room?.id ?? '';
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
    this.room = await this.net.create(this.name);
    return this.room;
  },
  async joinLobby(code: string): Promise<Room> {
    await this.leave();
    this.room = await this.net.joinById(code.trim(), this.name);
    return this.room;
  },
};

export async function fetchLobbies(): Promise<Array<{ code: string; players: number; max: number; phase: string }>> {
  const res = await fetch('http://localhost:2567/lobbies');
  if (!res.ok) throw new Error('lobby list failed');
  return res.json();
}
