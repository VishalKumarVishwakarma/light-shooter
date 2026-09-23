// Ops helpers: structured logs + funnel counters. Imported by index + rooms (no cycles).
export function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, extra: any = {}) {
  if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') return;
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
  } catch { console.log(msg); }
}

export const metrics = {
  roomsCreated: 0,
  matchesStarted: 0,
  matchesCompleted: 0,
  disconnects: 0,
  startedAt: Date.now(),
};
