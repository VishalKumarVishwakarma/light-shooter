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
  // VITE_SERVER_URL, in the EXACT form Vite substitutes. Vite inlines env vars by static
  // text replacement of `import.meta.env.VITE_X`, so a cast or optional chaining here
  // (`(import.meta as any)?.env?.VITE_X`) defeats it: the expression survives into the
  // bundle, evaluates to undefined at runtime, and the client silently falls back to
  // localhost. That bug shipped unnoticed for the life of this file -- the deployed game
  // loaded fine and connected to nothing. Do not "tidy" this line.
  const env: string | undefined = import.meta.env.VITE_SERVER_URL;
  if (env) return String(env).replace(/\/$/, '');
  // Unset: local dev, or a deploy that forgot the variable. Netlify users get a client
  // that works but cannot reach a server, so DEPLOY.md tells them to set it.
  return 'http://localhost:2567';
}

export const SERVER_HTTP = base();
export const SERVER_WS = SERVER_HTTP.replace(/^http/, 'ws');
