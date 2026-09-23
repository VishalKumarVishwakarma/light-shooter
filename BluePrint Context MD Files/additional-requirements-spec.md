# Additional Project Requirements
### Supplementary items beyond game features, frontend, backend, UML, and testing

---

## 1. Non-Functional Requirements (Numeric Targets)

Concrete, measurable targets — without these, "fast," "reliable," and "scalable" are just opinions.

| Category | Target |
|---|---|
| Server tick rate | 20–30 updates/sec |
| Input-to-screen latency (local) | < 50ms (via client-side prediction) |
| Round-trip network latency tolerance | Playable up to 150–200ms ping |
| Max concurrent players per room | 8 |
| Max concurrent rooms (MVP) | 20–50 (single server instance) |
| Client frame rate target | 60 FPS desktop, 30+ FPS low-end mobile |
| Server uptime target | 99% (MVP) → 99.9% (post-MVP) |
| Page load time (first paint) | < 3 seconds on 4G |
| Match start latency (join → playable) | < 5 seconds |
| Reconnect grace period | 15–30 seconds |
| Room auto-cleanup (empty room) | 5 minutes idle |

---

## 2. Project Roadmap / Build Order

### Phase 1 — Core Loop (Weeks 1–2)
- Basic movement + rendering (single player, local only)
- WebSocket connection between 2 clients (position sync only, no combat)
- Room creation/join via URL

### Phase 2 — Combat MVP (Weeks 3–4)
- Shooting, damage, health, death, respawn (server-authoritative)
- One map, one weapon (pistol)
- Basic HUD (health, ammo, kill feed)

### Phase 3 — Game Rules & Polish (Weeks 5–6)
- Win condition (kill target/timer), scoreboard, results screen
- Second weapon + pickups
- Mobile touch controls
- Deploy to public URL (HTTPS/WSS)

### Phase 4 — Premium Frontend Pass (Weeks 7–8)
- Branded menu, animations, toasts, settings panel
- QR code join, share sheet
- Sound effects + music

### Phase 5 — Hardening (Weeks 9–10)
- Reconnect handling, anti-cheat validation
- Automated test suite (unit/integration/E2E)
- Cross-device/browser testing pass
- Load testing

### Phase 6 — Launch & Stretch
- Public launch, monitoring in place
- Team deathmatch, more maps/weapons
- Persistent stats/leaderboard (if pursuing)

---

## 3. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WebSocket hosting costs scale unexpectedly | Medium | Medium | Set concurrent player caps; monitor usage; choose pay-as-you-go host initially |
| Cheating via manipulated client input | Medium | High | Server-authoritative validation (already in backend spec); rate-limiting |
| High latency ruins gameplay feel for distant players | High | Medium | Client-side prediction/interpolation; document expected ping range |
| Server crash loses all active rooms | Medium | Medium | Accept as known MVP tradeoff; add persistence later if needed |
| Mobile browser performance issues | Medium | Medium | Graphics quality toggle; test on real low-end devices early |
| Low playtesting turnout (no one to test 2+ players) | Medium | Low | Use multiple browser contexts/devices personally; recruit friends early |
| Scope creep delays MVP launch | High | High | Strictly follow MVP vs. stretch tiering already defined in each spec |

---

## 4. Cost / Budget Estimate (Rough, MVP Stage)

| Item | Estimated Cost |
|---|---|
| Domain name | $10–15/year |
| Hosting (Render/Railway/Fly.io, small tier) | $0–20/month (many have free tiers for low traffic) |
| Frontend hosting (Vercel/Netlify) | Free tier sufficient for MVP |
| SSL certificate | Free (Let's Encrypt, auto via host) |
| Optional: Redis (stretch, scaling) | $0–10/month (small managed instance) |
| Optional: Database (stretch, stats) | $0–15/month (free tier on most providers) |
| Optional: Error/monitoring tool (e.g., Sentry) | Free tier sufficient early on |

**MVP total: roughly $10–50/month**, largely driven by hosting tier and traffic — can start near-free.

---

## 5. Database Schema (If Pursuing Persistent Stats — Stretch)

```
Table: players
- id (UUID, PK)
- display_name (string)
- avatar_color (string)
- created_at (timestamp)
- total_kills (int)
- total_deaths (int)
- total_matches (int)
- total_wins (int)

Table: matches
- id (UUID, PK)
- room_code (string)
- mode (string: ffa / team)
- map_id (string)
- started_at (timestamp)
- ended_at (timestamp)
- winner_id (UUID, FK -> players.id, nullable)

Table: match_participants
- id (UUID, PK)
- match_id (UUID, FK -> matches.id)
- player_id (UUID, FK -> players.id)
- kills (int)
- deaths (int)
- accuracy (float, nullable)
- placement (int)
```

Not needed for MVP — only build this once "Persistent player stats/leaderboard" moves from stretch goal to active scope.

---

## 6. API Contract (Formal Message/Endpoint Shapes)

### REST Endpoints

```
POST /rooms
  Request:  { hostName: string }
  Response: { roomCode: string, roomLink: string, token: string }

POST /rooms/:code/join
  Request:  { playerName: string }
  Response: { token: string, players: Player[], status: string }
  Errors:   404 Room Not Found | 409 Room Full

GET /rooms/:code
  Response: { code, status, players: Player[], mode, maxPlayers }

POST /rooms/:code/start
  Request:  { token: string }  // must be host
  Response: { status: "countdown", countdownSeconds: number }
  Errors:   403 Not Host | 400 Not Enough Players

GET /health
  Response: { status: "ok", uptime: number, activeRooms: number }
```

### WebSocket Messages (Client → Server)

```
{ type: "move", seq: number, dx: number, dy: number, timestamp: number }
{ type: "shoot", angle: number, weaponId: string, timestamp: number }
{ type: "reload" }
{ type: "ping", timestamp: number }
```

### WebSocket Messages (Server → Client)

```
{ type: "state", players: PlayerState[], bullets: BulletState[], tick: number }
{ type: "hit", targetId: string, damage: number, shooterId: string }
{ type: "death", playerId: string, killerId: string, respawnAt: number }
{ type: "respawn", playerId: string, x: number, y: number }
{ type: "matchEnd", winnerId: string, scoreboard: ScoreEntry[] }
{ type: "pong", timestamp: number }
{ type: "error", code: string, message: string }
```

---

## 7. CI/CD Pipeline

**Recommended flow (GitHub Actions or similar):**
1. **On every push/PR:**
   - Run linter (ESLint/Prettier check)
   - Run unit + integration test suite
   - Build frontend + backend (catch compile errors)
2. **On merge to `main`:**
   - Run full test suite including E2E (Playwright)
   - Deploy backend to hosting platform (Render/Railway auto-deploy from Git)
   - Deploy frontend to static host (Vercel/Netlify auto-deploy from Git)
3. **Post-deploy:**
   - Hit `/health` endpoint to confirm server is up
   - Optional: smoke test (automated script joins a room and sends a test input)

---

## 8. Error Handling & Logging Strategy

- **Structured logging** (JSON logs) for: connections, disconnections, room lifecycle events, errors, rejected/invalid inputs.
- **Log levels**: `debug` (dev only), `info` (lifecycle events), `warn` (rejected inputs, reconnect attempts), `error` (crashes, exceptions).
- **Centralized error capture** (e.g., Sentry) so unhandled exceptions on the server are visible, not silently swallowed.
- **Client-side error boundary** (React error boundary or equivalent) so a rendering crash shows a friendly "Something went wrong" screen instead of a blank page.
- **Never expose raw stack traces or internal errors to players** — always translate to a clean user-facing message.

---

## 9. Analytics Plan

**Track at minimum (even simple event logging):**
- Rooms created / matches started / matches completed (funnel: creation → completion).
- Average match duration.
- Average players per match.
- Disconnect rate (how often players drop mid-match).
- Device/browser breakdown (to prioritize compatibility fixes).

**Tools:** Plausible/Umami (privacy-friendly, lightweight) for page-level analytics; simple custom event logging to your own backend/DB for gameplay-specific funnels — avoid heavy tools like full GA for an MVP.

---

## 10. Wireframes / Screen Inventory

List of screens that need actual layout mockups before/while building UI:
1. **Splash/Loading screen**
2. **Main Menu** (Create/Join/Settings/How to Play)
3. **Create Room modal** (name entry, generated link/QR)
4. **Join Room screen** (code entry or auto-join via link)
5. **Lobby screen** (player list, ready states, start button)
6. **Countdown overlay**
7. **In-match HUD** (overlaid on gameplay canvas)
8. **Pause/Settings panel** (in-match access)
9. **Results/Post-match screen** (scoreboard, MVP, rematch)
10. **Error states** (room full, room not found, disconnected)

*(Recommend building these as a quick Figma file or even a simple HTML/design artifact before frontend development starts.)*

---

## 11. Accessibility Specification

- **Colorblind-safe HUD**: don't rely on red/green alone for health (pair with numeric value + bar length, already true if HP number is shown).
- **Minimum readable font size**: 14px+ for HUD text, scalable on mobile.
- **Sufficient contrast ratios** (WCAG AA minimum) for all text over game backgrounds — HUD text should have a subtle shadow/backdrop for legibility over any scene.
- **Remappable controls** (already in settings spec) helps players with motor differences.
- **No essential information conveyed by sound alone** (e.g., low-health warning should also be visual, not just audio).
- **Menu screens navigable via keyboard** (tab order, focus states) even if gameplay itself requires mouse/touch.

---

## 12. Terms of Service / Privacy Policy

Required the moment the game is **publicly live and collects any player data** (even just a chosen display name + IP via connection logs).

**Minimum needed:**
- Simple **Privacy Policy**: what data is collected (name, gameplay stats if persisted, IP/connection logs, no payment/personal info in MVP), how it's stored, that it's not sold/shared.
- Simple **Terms of Service**: acceptable use (no harassment via chat/names), disclaimer of liability, right to remove abusive players/rooms.
- **Cookie/local storage notice** if using browser storage for settings/session persistence, depending on your jurisdiction's requirements.

*(For an MVP/hobby project, a concise one-page version of each is sufficient — doesn't need to be a lengthy legal document, but should exist before wide public sharing.)*

---

## 13. Age / COPPA Considerations

- If there's any reasonable chance of players under 13 (likely, given the "Mini Militia" audience comparison), avoid collecting any personally identifiable information beyond a self-chosen display name.
- **No real-name requirement, no email/account requirement** for MVP — keeps COPPA exposure minimal since no personal data is being collected from children.
- If chat/voice is added later, include a **basic profanity filter** and a way to report abusive behavior.
- Avoid third-party ad/tracking SDKs that harvest data, especially if minors may play — directly relevant if monetization via ads is ever considered.

---

## 14. Monetization Plan (Optional — Only If Relevant)

Not required for the stated brief, but worth deciding explicitly rather than leaving unplanned:

| Option | Notes |
|---|---|
| **None (free hobby/portfolio project)** | Simplest, no legal/payment complexity — recommended for MVP |
| Cosmetic skins/avatar colors (one-time or free) | Low complexity, no real payment processing needed if just unlockable via play |
| Ads (banner/interstitial) | Adds complexity, potential COPPA/privacy concerns, hurts "premium feel" if done poorly |
| Optional donations (Buy Me a Coffee / Ko-fi link) | Very low complexity, no real monetization infra needed |

**Recommendation:** Keep MVP fully free with no monetization infrastructure — revisit only if the game gains real traction.

---

## 15. Priority: What to Actually Do Next

Given everything across all specs so far, the highest-leverage next steps, in order:

1. **Define non-functional requirement targets** (done above — lock these in).
2. **Build the Phase 1–2 roadmap items** (core loop + combat MVP) — this is where actual code starts.
3. **Sketch wireframes** for the 10 screens listed, even roughly, before frontend polish work.
4. **Write a one-page Privacy Policy + ToS** before the link is shared publicly, even informally.
5. Everything else (analytics, CI/CD, DB schema, monetization) can follow once the core game is playable and live.
