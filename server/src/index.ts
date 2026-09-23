import http from 'http';
import express from 'express';
import { Server, matchMaker } from 'colyseus';
import { ShooterRoom } from './rooms/ShooterRoom.js';
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
        code: r.roomId,
        players: r.clients,
        max: r.maxClients || 8,
        phase: r.metadata?.phase || 'lobby',
      })));
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
const server = http.createServer(app);
const game = new Server({ server });
game.define('shooter', ShooterRoom);
const PORT = Number(process.env.PORT || 2567);
server.listen(PORT, () => log('info', 'shooter online', { port: PORT }));
