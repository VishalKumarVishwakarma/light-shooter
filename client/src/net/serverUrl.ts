// Server address resolution: ?server= override (shareable links) then
// VITE_SERVER_URL build default, then localhost dev. HTTP(S) for REST,
// WS(S) for Colyseus — derived from the same base.
function base(): string {
  try {
    const url = new URL(location.href);
    const q = url.searchParams.get('server');
    if (q) {
      // drop only `server` from the address bar — keep ?room= invite codes
      url.searchParams.delete('server');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
      return q.replace(/\/$/, '');
    }
  } catch { /* non-browser env */ }
  try {
    const env = (import.meta as any)?.env?.VITE_SERVER_URL;
    if (env) return String(env).replace(/\/$/, '');
  } catch { /* noop */ }
  return 'http://localhost:2567';
}

export const SERVER_HTTP = base();
export const SERVER_WS = SERVER_HTTP.replace(/^http/, 'ws');
