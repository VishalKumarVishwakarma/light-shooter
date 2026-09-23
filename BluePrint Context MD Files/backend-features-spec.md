# Backend & Networking Feature Specification
### Real-time multiplayer infrastructure for a cross-device 2D shooter

---

## 1. High-Level Architecture

- **Authoritative server model**: the server is the single source of truth for game state (positions, health, hits, deaths). Clients send *inputs*, not outcomes — this prevents cheating and keeps all players' game state in sync.
- **Client-side prediction + server reconciliation**: client moves the local player instantly for responsiveness, then corrects position if the server disagrees (standard for low-latency-feel multiplayer).
- **Entity interpolation**: other players' movements are smoothed between server updates so remote players don't appear to teleport/jitter.
- Split into two logical layers:
  1. **Matchmaking/Lobby Service** (HTTP/REST) — room creation, joining, player metadata.
  2. **Real-Time Game Server** (WebSockets) — live position/combat sync during a match.

---

## 2. Real-Time Communication Layer

- **WebSocket connection** per player (persistent, bidirectional) — required for real-time movement/shooting sync; plain HTTP polling is too slow.
- **Message protocol**: lightweight, binary or compact JSON, e.g.:
  - `input`: `{ type: "move", dx, dy, seq }`
  - `shoot`: `{ type: "shoot", angle, weaponId, timestamp }`
  - `state`: server broadcast of all player positions/health/etc., sent at a fixed tick rate.
- **Server tick rate**: fixed loop (e.g., 20–30 updates/sec) that processes all queued inputs, updates game state, and broadcasts snapshots to all clients in the room.
- **Delta compression** (stretch): only send what changed since the last snapshot, not full state every tick, to reduce bandwidth on mobile networks.
- **Heartbeat/ping-pong messages**: detect dead connections, measure latency per player, show it in-game.

---

## 3. Room & Session Management (Server-Side)

- **Room object** holds: room code, list of connected players (socket refs), game mode, map, match state (lobby/in-progress/ended), start time, host ID.
- **Room code generation**: short, unique, human-shareable (e.g., 6-character alphanumeric), collision-checked against active rooms.
- **Room lifecycle**:
  - Created → Waiting for players → Countdown → In-Match → Post-Match → Closed/Cleaned up.
  - Auto-expire/destroy empty rooms after a timeout to free memory.
- **Player-to-room mapping**: server tracks which socket belongs to which room/player so messages route correctly (no cross-room leakage).
- **Room capacity enforcement**: reject joins beyond max players with a clear error message sent back to the client.
- **Host migration** (stretch): if the host disconnects, auto-promote another player so the room doesn't die.

---

## 4. Game State Authority & Combat Validation

- **Server-authoritative hit detection**: when a client reports "I shot," the server (not the client) determines whether it actually hit another player, based on server-known positions — prevents client-side cheating (aimbots reporting fake hits).
- **Damage application**: server applies weapon damage values, updates health, and broadcasts the result to all clients — client only *renders* what the server says happened.
- **Death/respawn logic**: server decides when HP hits 0, triggers respawn timer, assigns new spawn point, resets health — fully server-controlled so no client can fake immortality.
- **Ammo/weapon state**: tracked server-side per player so a client can't send unlimited "shoot" messages without valid ammo.
- **Basic anti-cheat / sanity checks**:
  - Reject movement inputs that imply impossible speed (teleport hacks).
  - Rate-limit shoot messages to weapon fire-rate.
  - Validate all inputs server-side before trusting them.

---

## 5. Matchmaking / Lobby API (REST or WS-based)

Endpoints needed (naming illustrative):
- `POST /rooms` — create a new room, returns room code + link.
- `POST /rooms/:code/join` — validate room exists/has space, returns connection token.
- `GET /rooms/:code` — fetch current lobby state (players, status) for UI display before joining the socket.
- `POST /rooms/:code/start` — host triggers match start (or auto-start once min players reached).
- Basic **player session/token** issuance so reconnect and identity can be verified without full login (e.g., short-lived signed token tied to room+player).

---

## 6. Hosting & Deployment Requirements

- **Publicly reachable server** with a real domain/URL (not localhost) — required since players are on different networks.
- **HTTPS + WSS (secure WebSockets)** mandatory — browsers block insecure mixed content, and mobile networks/corporate firewalls often block plain WS.
- **Stateful server hosting** suited for persistent WebSocket connections (Node.js/Colyseus/Socket.IO-style server on a VM, container, or platform like Fly.io, Render, Railway, or a small cloud VM) — note: pure serverless/Lambda is a poor fit for persistent real-time connections.
- **Process manager** (e.g., PM2) or container orchestration to keep the server alive, auto-restart on crash.
- **Environment separation**: dev/staging/production configs (different ports, debug flags).
- **CORS configuration**: backend must explicitly allow the frontend's domain to connect via HTTP and WS.

---

## 7. Scalability Considerations

- **Single-server-per-room model** is fine for MVP (a handful of rooms, few players each) — simplest to build and reason about.
- **Horizontal scaling (stretch/future)**: if many concurrent rooms are needed, introduce a lightweight matchmaking layer that assigns rooms to one of several game-server instances, with a shared registry (e.g., Redis) tracking which server hosts which room.
- **Load limits defined up front**: know and document max players per room and max concurrent rooms per server instance so the game degrades gracefully (clear "server full" message) instead of crashing.

---

## 8. Reliability & Reconnection

- **Disconnect detection**: server notices dropped socket (via heartbeat timeout), marks player as "disconnected" but keeps their state for a grace period (e.g., 15–30s) instead of instantly removing them.
- **Reconnect flow**: player reopens the link/app, server matches them back to their room/player slot using their session token, resumes their character state (health, position) — critical for real cross-device play where mobile connections drop often.
- **Graceful room cleanup**: if a player never reconnects within the grace period, remove them properly (free their spawn slot, update scoreboard).
- **Server crash recovery**: persist minimal room state (or accept room loss) — document the chosen tradeoff explicitly (MVP can accept "room lost on crash," but this should be a conscious decision, not an accident).

---

## 9. Latency & Fairness Handling

- **Per-player ping measurement**, exposed to the client for the HUD indicator.
- **Lag compensation** (stretch, more advanced): server slightly "rewinds" hit detection based on shooter's ping so fast-reacting shots register fairly even with latency — common in premium shooters, complex to implement, can be deferred post-MVP.
- **Consistent simulation constants**: gravity, speed, damage values all live server-side as the single source of truth, sent to clients once at match start — prevents any client from having an "edge" via modified local values.

---

## 10. Data & Persistence (Light for MVP, Expandable)

- **MVP**: no database required — all state lives in server memory per active room, discarded after match ends.
- **Stretch — persistent layer** (e.g., lightweight DB like PostgreSQL, MongoDB, or even simple Redis):
  - Player profiles (name, avatar, stats).
  - Match history (kills/deaths/wins) for a basic leaderboard.
  - Room analytics (matches played, peak concurrent players) for monitoring growth.

---

## 11. Security Basics

- **Input sanitization** on player names/chat (prevent XSS if names/messages are rendered as HTML).
- **Rate limiting** on room creation and join endpoints (prevent spam/DOS of the matchmaking API).
- **Token-based room access** so someone can't join a room they weren't given the code/link for without guessing (6-char codes with enough entropy + optional simple room capacity/rate limits deter brute force).
- **No sensitive data stored** in MVP (no passwords/payment info), keeping security surface small.

---

## 12. Monitoring & Ops (Even for MVP)

- **Basic server logging**: connections, disconnections, errors, room lifecycle events — essential for debugging real-world cross-network issues that won't show up in local testing.
- **Simple health-check endpoint** (`GET /health`) so hosting platform / uptime monitor can verify the server is alive.
- **Crash reporting**: catch and log unhandled errors instead of silently killing the process.
- **Basic metrics** (stretch): concurrent players, active rooms, average tick time — useful once real users start playing.

---

## 13. Recommended Tech Stack (Concrete Starting Point)

| Layer | Suggested Choice | Why |
|---|---|---|
| Real-time server | **Node.js + Socket.IO** (or Colyseus, which is purpose-built for authoritative multiplayer rooms) | Mature, huge community, handles WS fallbacks automatically |
| Matchmaking API | Same Node.js process (Express routes) or separate lightweight service | Keeps MVP simple — one deployable unit |
| Hosting | **Render / Railway / Fly.io** (or a small DigitalOcean/AWS Lightsail VM) | Supports persistent WebSocket servers, easy HTTPS/WSS setup, simple deploy from Git |
| Frontend hosting | **Vercel/Netlify** (static) or same server if bundled | Fast global CDN for game assets |
| Domain + SSL | Any registrar + auto SSL via hosting platform (Let's Encrypt) | Required for WSS |
| (Stretch) DB | **Redis** for ephemeral room registry across servers; **PostgreSQL/Mongo** for persistent stats | Only needed at scale/stretch stage |

---

## 14. MVP vs. Stretch Recap

**MVP (must work for the "real, live, cross-device" requirement):**
- WebSocket server with authoritative tick loop
- Room creation/join via REST + shareable link
- Server-validated movement, shooting, damage, death, respawn
- Basic disconnect handling (player removed cleanly)
- Deployed publicly with HTTPS/WSS on a real domain
- CORS + basic input rate limiting

**Stretch (once MVP is solid):**
- Reconnect with grace period + session tokens
- Host migration
- Lag compensation for hit detection
- Horizontal scaling across multiple server instances
- Persistent player stats/leaderboard (DB-backed)
- Monitoring/metrics dashboard

---

## 15. The One Non-Negotiable

Everything above supports this single requirement from your brief: **the game must be authoritative and server-validated enough that two strangers on different networks get a fair, cheat-resistant, real-time match** — not just two browsers guessing at each other's state. That's what separates a "real multiplayer game" from a tech demo.
