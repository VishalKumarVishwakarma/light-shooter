# Deploying

The short version: **Netlify hosts the game client. Something else hosts the game
server.** They cannot be the same deploy, and the reason is architectural rather than a
matter of configuration.

---

## Why the server cannot go on Netlify

This project is **server-authoritative**. The browser sends intent (`move`, `shoot`,
`switch`) and the server owns the simulation: a 30Hz tick, bullet sweeps, collision,
damage, scoring. Clients are not trusted with any of it.

That requires a **long-lived process holding a WebSocket open per player**. Netlify
Functions cannot be that. From Netlify's own documentation:

> For web requests, the function receives a `Request` and a `Context`, and returns a
> `Response` that is delivered back to the client.

and the runtime is ephemeral. There is no WebSocket server model — a function is invoked
per request and torn down afterwards, so a room cannot persist between moves, let alone
between players' connections.

This is the same reason Vercel was ruled out for the server earlier in this project
(Hobby caps function execution, and two players in the same lobby are not guaranteed to
reach the same instance, so rooms cannot be authoritative).

**What Netlify can host is the client**, which is a static Vite build. That part is
configured and ready.

---

## Part 1 — the game server (Koyeb, free tier)

Already set up: `server/Dockerfile` (two-stage) and `server/koyeb.yaml`.

```
Koyeb dashboard -> New Service -> pick this repo -> Dockerfile
  Dockerfile path:  server/Dockerfile
  Config file:      server/koyeb.yaml
```

Or with the CLI:

```
koyeb app deploy myapp --dockerfile server/Dockerfile
```

Notes:

- **`instance_count: 1` is mandatory, not a default.** Colyseus keeps rooms in memory and
  players join by a 4-digit code. With two instances, two players entering the same code
  land in two separate rooms and never see each other. Never raise this without moving
  room state into shared storage.
- The free instance (0.25 vCPU) is enough — the sim is a 30Hz tick over ≤8 players of
  axis-aligned movement and a bullet sweep, not a physics engine.
- When it is up you get something like `https://shooter-server-<name>.koyeb.app`.
  `/health` should answer once it is live.

---

## Part 2 — the client (Netlify)

Already configured: `netlify.toml` at the repo root.

```
Netlify dashboard -> Add new site -> Import an existing project
  Build command:    npm run build      (from netlify.toml; safe to leave blank)
  Publish directory: client/dist       (from netlify.toml; safe to leave blank)
```

Then **set one environment variable**, which is the step that is easy to miss:

```
Netlify -> Site settings -> Environment variables
  VITE_SERVER_URL = https://shooter-server-<name>.koyeb.app
```

It must be set **before** the first build. Vite inlines `VITE_*` variables at build
time, so it is baked into the deployed JavaScript — adding it afterwards does nothing
until you redeploy.

Leave it unset and `client/src/net/serverUrl.ts` falls back to `http://localhost:2567`,
which in a player's browser means *their own machine*. The game will load and look
perfect, and nobody will ever be able to connect.

The client derives the WebSocket address from the same value (`http`→`ws`,
`https`→`wss`), so one variable covers both.

### Testing a server change without redeploying

`?server=` overrides the build-time value at runtime:

```
https://your-site.netlify.app/?server=https://shooter-server-<name>.koyeb.app
```

Handy for pointing a deployed client at a local server, or at a staging server, without
touching the Netlify build.

---

## Verifying a deploy

```bash
# 1. the site is up and serving the bundle
curl -sI https://your-site.netlify.app/            | head -1     # HTTP/2 200
curl -s  https://your-site.netlify.app/ | grep -c assets/        # > 0

# 2. the client was built WITH the server URL, not the localhost fallback
curl -s https://your-site.netlify.app/assets/index-*.js | grep -c localhost:2567
#   0  -> correct
#   >0 -> VITE_SERVER_URL was not set at build time

# 3. the server answers and is reachable over wss
curl -s https://shooter-server-<name>.koyeb.app/health

# 4. end to end, from the test suite against the deployed server
#    (temporarily point the suite's URL at the deployed host)
node client/test-integration.mjs
```

Step 2 is the one that catches the mistake everybody makes.

---

## Local development, unchanged

Nothing about local work changes.

```bash
cd server && node dist/index.js      # ws://localhost:2567
cd client && npm run dev             # http://localhost:5173
```

`VITE_SERVER_URL` is unset locally, so `?server=` and the localhost default both behave
exactly as before.

---

## What is in `netlify.toml`, and why

| setting | reason |
|---|---|
| `base = "client"` | Netlify treats `client/` as the project root, so `command` and `publish` stay relative to it |
| `NODE_VERSION = "22"` | pinned, so a Netlify default Node bump cannot fail the build |
| `VITE_SERVER_URL = ""` | documented placeholder; empty means the localhost fallback, which is wrong in production |
| `Cache-Control: immutable` on `/assets/*` | those filenames are content-hashed, so they can be cached for a year |
| `Cache-Control: must-revalidate` on HTML | otherwise a deploy leaves players holding a stale bundle hash |
| CSP + `nosniff` + `Referrer-Policy` | every texture is drawn procedurally on a canvas, so the policy can be tight |
| `/* -> /index.html 200` | routing uses query parameters, not paths; this only stops an unknown path returning Netlify's 404 |

`.netlify/` and `.env` are already in `.gitignore`, so the CLI state directory and any
token file stay out of git.