import http from 'http';
import express from 'express';
import { Server, matchMaker } from 'colyseus';
import { ShooterRoom } from './rooms/ShooterRoom.js';
import { reserveCode, releasePending, bindCode, releaseRoom, roomForCode, codeForRoom, CODE_RE } from './codes.js';
import { log, metrics } from './ops.js';

// crash guards: log instead of dying silently

process.on('uncaughtException', (e) => log('error', 'uncaughtException', { message: String(e?.message || e) }));
process.on('unhandledRejection', (e) => log('error', 'unhandledRejection', { message: String((e as any)?.message || e) }));

const app = express();
// permissive CORS first: web client may be served from any static host
app.use((_req: any, res: any, next: any) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/', (_req: any, res: any) => res.send('shooter-server ok'));

// ---- 4-digit join codes -------------------------------------------------
// The public handle is a 4-digit code; codes.ts binds it to the real room id
// (Colyseus assigns its own roomId and ignores ours) and owns uniqueness.
async function liveRoomIds(): Promise<Set<string>> {
  const rooms = await matchMaker.query({ name: 'shooter' });
  return new Set((rooms as any[]).map((r) => String(r.roomId)));
}

// open a lobby under a fresh code
app.post('/code', async (_req: any, res: any) => {
  let lastErr = 'no free code';
  for (let attempt = 0; attempt < 4; attempt++) {
    const live = await liveRoomIds().catch(() => new Set<string>());
    const code = reserveCode((c) => live.has(c));
    if (!code) { lastErr = 'every code is in use'; continue; }
    try {
      const room = await matchMaker.createRoom('shooter', {});
      bindCode(code, room.roomId);
      res.json({ code });
      return;
    } catch (e: any) {
      releasePending(code); // never burn a code on a failed create
      lastErr = String(e?.message || e);
    }
  }
  res.status(500).json({ error: lastErr });
});

// resolve a code to the room behind it, so the client can open its socket
app.get('/code/:code', async (req: any, res: any) => {
  const code = String(req.params.code || '');
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'codes are 4 digits' });
  const roomId = roomForCode(code);
  if (!roomId) return res.status(404).json({ error: 'no lobby with that code' });
  // a code whose room died between allocation and lookup must not resolve
  const live = await liveRoomIds().catch(() => new Set<string>());
  if (!live.has(roomId)) {
    releaseRoom(roomId);
    return res.status(404).json({ error: 'no lobby with that code' });
  }
  res.json({ code, roomId });
});
app.get('/health', async (_req: any, res: any) => {
  try {
    const rooms = await matchMaker.query({ name: 'shooter' });
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      activeRooms: rooms.length,
      players: rooms.reduce((a: number, r: any) => a + (r.clients || 0), 0),
    });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: String(e?.message || e) });
  }
});
app.get('/metrics', async (_req: any, res: any) => {
  try {
    const rooms = await matchMaker.query({ name: 'shooter' });
    const byPhase: Record<string, number> = {};
    for (const r of rooms as any[]) {
      const ph = r.metadata?.phase || 'lobby';
      byPhase[ph] = (byPhase[ph] || 0) + 1;
    }
    res.json({
      ...metrics,
      uptime: Math.round(process.uptime()),
      liveRooms: rooms.length,
      livePlayers: rooms.reduce((a: number, r: any) => a + (r.clients || 0), 0),
      byPhase,
    });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: String(e?.message || e) });
  }
});
// lobby browser: open rooms with player counts + phase (so JOIN never needs typing)
app.get('/lobbies', async (_req: any, res: any) => {
  try {
    const rooms = await matchMaker.query({ name: 'shooter', locked: false });
    res.json(rooms
      .filter((r: any) => r.clients > 0) // hide emptied rooms (autoDispose is off)
      .map((r: any) => ({
        code: codeForRoom(String(r.roomId)) || '', // public 4-digit handle
        players: r.clients,
        max: r.maxClients || 8,
        phase: r.metadata?.phase || 'lobby',
      }))
      .filter((r: any) => r.code)); // only rooms that have a code
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
const server = http.createServer(app);
const game = new Server({ server });
game.define('shooter', ShooterRoom);
const PORT = Number(process.env.PORT || 2567);
server.listen(PORT, () => log('info', 'shooter online', { port: PORT }));
