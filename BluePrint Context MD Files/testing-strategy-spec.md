# Testing Strategy Specification
### All testing types applicable to the multiplayer 2D shooter

This document lays out every relevant testing category — what it means in the context of this project, what to test, and example test cases — so quality can be verified systematically before and after launch.

---

## 1. Unit Testing

**Definition:** Testing the smallest independent pieces of code (a single function/class/method) in isolation, with no network, no DOM, no server.

**What to test here:**
- `Player.takeDamage(amount)` — health decreases correctly, never goes below 0.
- `Weapon.fire()` — ammo decreases by 1, rejects fire if ammo is 0.
- `Weapon.reload()` — ammo resets to capacity after reload time.
- `Bullet.update(deltaTime)` — position updates correctly based on speed/angle/time.
- `Room.addPlayer()` / `removePlayer()` — player count and list update correctly.
- Damage/health math (e.g., 100 HP - 25 damage = 75 HP, not negative or NaN).
- Collision math (e.g., point-vs-circle or point-vs-rectangle hit detection functions).
- Input validation functions (e.g., rejecting a malformed input message).

**Example test cases:**
| Test | Input | Expected Output |
|---|---|---|
| Damage reduces health | health=100, damage=30 | health=70 |
| Health can't go negative | health=10, damage=50 | health=0 (clamped) |
| Shooting with 0 ammo | ammo=0, fire() | fire rejected, no bullet created |
| Reload restores full ammo | ammo=2, capacity=30, reload() | ammo=30 |
| Respawn resets health | health=0, respawn() | health=100, isAlive=true |

**Tools:** Jest / Vitest / Mocha (JavaScript/TypeScript), run in CI on every commit.

---

## 2. Component Testing (Frontend)

**Definition:** Testing individual UI components in isolation (rendered, but without full app/network context).

**What to test:**
- Health bar component renders correct width/color at various HP values (100%, 50%, 10%, 0%).
- Ammo counter displays correct number and updates on prop change.
- Room code input field validates format (rejects empty/invalid codes).
- Kill feed component correctly renders and auto-dismisses entries after timeout.
- Settings sliders (sensitivity, volume) update and reflect state changes.
- Buttons trigger correct callback/event on click/tap.

**Tools:** React Testing Library / Vue Test Utils / Playwright Component Testing (framework-dependent).

---

## 3. Module / Integration Testing

**Definition:** Testing how multiple units/modules work together — e.g., does the "combat module" (Weapon + Bullet + Player + collision) behave correctly as a group, even though each piece passed unit tests individually.

**What to test:**
- Firing a weapon creates a bullet, the bullet travels, and it correctly applies damage to a player it collides with (chaining Weapon → Bullet → Player.takeDamage).
- Room module: adding players, starting a match, and reaching the kill target correctly triggers the "Ended" state (chaining Room + Player + scoring logic).
- Pickup module: player walks into a health pickup → health increases → pickup becomes inactive → respawns after timer (chaining Player + Pickup + Timer).
- Input handler → prediction → reconciliation module works together without desyncing position.
- Lobby API module: create room → join room → both reflected correctly in shared Room state.

**Tools:** Same as unit (Jest/Vitest) but testing multiple real modules together instead of mocking everything.

---

## 4. API / Backend Testing

**Definition:** Testing backend HTTP endpoints and WebSocket message handlers directly, independent of the frontend UI.

**What to test:**
- `POST /rooms` returns a valid room code and link.
- `POST /rooms/:code/join` succeeds for a valid room, fails correctly for a full/nonexistent room.
- `GET /rooms/:code` returns accurate current player list and status.
- WebSocket `shoot` message: valid input is processed and broadcast; invalid input (bad ammo count, malformed JSON) is rejected without crashing the server.
- Rate limiting: rapid-fire room creation requests get throttled as expected.
- Session token validation: expired/invalid tokens are rejected on reconnect attempts.

**Tools:** Supertest (REST), a WebSocket test client script, or Postman/Insomnia collections for manual + automated checks.

---

## 5. System Testing

**Definition:** Testing the entire application end-to-end as a whole (frontend + backend + network) against the full requirements — closest to how a real user experiences it.

**What to test:**
- Full flow: open URL → create room → second device joins via link → match starts → play → match ends → results shown.
- Two real separate devices/networks (not just two browser tabs on one machine) can connect and play together.
- All core game rules hold under real conditions: damage applies, death/respawn works, win condition triggers correctly.
- Game remains playable and synced when one player has significantly higher latency than the other.

**Tools:** Manual testing across real devices + automated E2E tools like Playwright/Cypress for the reproducible parts (menu flow, room creation).

---

## 6. End-to-End (E2E) Testing

**Definition:** A specific, usually automated form of system testing that scripts full user journeys through the real UI, simulating actual player behavior.

**Example E2E scripts:**
1. Open app → enter name → click "Create Room" → assert room code is displayed.
2. Open second browser context → paste room link → assert player appears in lobby list on both sides.
3. Both players click ready/start → assert countdown appears → assert match screen loads for both.
4. Simulate movement input → assert player position updates on both clients within an acceptable time window.
5. Simulate a shot connecting → assert target's health bar decreases on both clients and a kill feed entry appears if it's a kill.
6. Drive kill count to the target → assert results screen appears with correct winner.

**Tools:** Playwright or Cypress with multiple browser contexts to simulate multiple simultaneous players.

---

## 7. Black Box Testing

**Definition:** Testing the application purely from the outside — as a real player would — without knowledge of or reference to the internal code. Focuses entirely on inputs and observable outputs/behavior.

**What to test:**
- Given the game is live at the URL, can a completely new player join without instructions and figure out how to move/shoot within a minute? (Directly validates your "no explanation needed" requirement.)
- Does clicking every visible button do something sensible (no dead buttons, no silent failures)?
- Does entering an invalid/expired room code show a clear error, not a blank screen or crash?
- Does the health bar visually and correctly reflect damage taken, from a pure observer's perspective?
- Does the win condition trigger and display correctly from the player's point of view, regardless of how it's implemented internally?

**Method:** Testers (ideally people unfamiliar with the codebase, even non-technical friends) play the game with zero briefing and report anything confusing, broken, or unclear.

---

## 8. White Box Testing

**Definition:** Testing with full knowledge of the internal code/logic — verifying that internal paths, branches, and logic states behave as designed.

**What to test:**
- Every branch of the server's shot-validation logic (valid shot / no ammo / rate-limited / out of range) is exercised by at least one test.
- Every state transition in the Player state machine (Spawning → Invulnerable → Alive → Dead → Spawning) is triggered and verified.
- Every state transition in the Room/Match state machine (Waiting → Countdown → InProgress → Ended → Closed) is triggered and verified.
- Edge cases in code logic: exactly 0 HP, exactly at kill target, exactly at timer expiry (off-by-one style bugs).
- Code coverage tooling used to identify untested branches in critical modules (combat, room lifecycle).

**Tools:** Jest/Vitest with coverage reporting (Istanbul/c8); manually reason through each conditional branch in combat and room-state code.

---

## 9. Regression Testing

**Definition:** Re-running existing tests after any code change to confirm nothing that used to work has broken.

**What to test:**
- Full existing unit + integration + E2E suite re-run automatically on every pull request/commit (CI pipeline).
- Specifically re-verify core "rule" behaviors after any gameplay-affecting change: damage math, respawn timing, win conditions, room join flow.
- Maintain a small **regression checklist** of previously-found-and-fixed bugs, manually re-checked before each release (e.g., "player could shoot through walls — fixed in v0.3, re-verify each release").

**Tools:** CI pipeline (GitHub Actions) running the full automated test suite on every push.

---

## 10. Performance Testing

**Definition:** Testing how the system behaves under load or stress — critical for a real-time multiplayer game.

**Sub-types:**
- **Load testing:** simulate the target number of concurrent rooms/players (e.g., 20 rooms × 4 players) and confirm server tick rate and response times stay stable.
- **Stress testing:** push beyond expected limits (e.g., 100 simultaneous connections) to find the breaking point and confirm it fails gracefully (clear "server full" message) rather than crashing.
- **Latency/network testing:** artificially throttle/add latency (e.g., using browser devtools network throttling or a tool like `tc` on Linux) to verify client prediction and interpolation still feel playable at 100–200ms ping.
- **Client performance testing:** confirm stable frame rate on lower-end mobile devices, not just high-end desktops.

**Tools:** Artillery.io or k6 for WebSocket load simulation; Chrome DevTools Performance tab + Lighthouse for client-side frame rate/load time.

---

## 11. Compatibility / Cross-Device Testing

**Definition:** Testing across the actual range of browsers, devices, and networks players will realistically use — directly validates the "works across devices" requirement.

**What to test:**
- Browsers: Chrome, Safari, Firefox, Edge (desktop); Chrome/Safari (mobile).
- Devices: at least one Android phone, one iPhone, one laptop/desktop, at varying screen sizes.
- Orientation: portrait vs landscape on mobile, if relevant.
- Networks: WiFi vs mobile data (4G/5G), and players on genuinely different networks/locations (not just same WiFi) — validates "not in the same room" requirement directly.
- Touch controls vs mouse/keyboard controls both function correctly on their respective device types.

**Tools:** BrowserStack/LambdaTest for automated cross-browser coverage; real physical device testing for touch/mobile feel (emulators don't fully substitute).

---

## 12. Security Testing

**Definition:** Testing for vulnerabilities and abuse vectors, especially important since this is a publicly reachable, real-time multiplayer service.

**What to test:**
- Attempt to send manipulated WebSocket messages (fake high damage, impossible movement speed) — server must reject/ignore them (validates server-authoritative design).
- Attempt to join a room without a valid code/token — must be rejected.
- Attempt XSS via player name/chat fields (e.g., `<script>` in name) — must be sanitized/escaped, not executed.
- Rate-limit abuse: rapid repeated room-creation requests — must be throttled, not allowed to exhaust server resources.
- Confirm HTTPS/WSS are enforced (no fallback to insecure HTTP/WS in production).

**Tools:** Manual penetration-style testing using browser devtools/Postman to craft malicious payloads; OWASP ZAP for automated basic scanning.

---

## 13. Usability Testing

**Definition:** Testing with real (ideally first-time) users to evaluate how intuitive and enjoyable the experience is — directly supports your "real rules without explanation" and "premium feel" goals.

**What to test:**
- Time-to-first-kill for a brand-new player with zero instructions.
- Whether users understand the HUD (health, ammo, kill feed) without being told what it means.
- Whether the room creation/join flow is clear enough that a non-technical friend can join via a shared link unaided.
- Post-session interviews/surveys: "What was confusing?" "What did you expect to happen that didn't?"

**Method:** Sit real testers down (in person or via screen share) with no explanation, observe silently, record friction points.

---

## 14. Acceptance Testing (UAT)

**Definition:** Final validation that the built product actually satisfies the original project requirements — the last gate before calling it "done."

**Acceptance criteria checklist (directly from your brief):**
- [ ] At least two players can join and play simultaneously from **physically separate devices**.
- [ ] Players on **different networks/locations** (not just same WiFi) can connect and play together.
- [ ] The game enforces **real, consistent rules** (health, damage, death, respawn, win condition) that a first-time player can learn purely by observation.
- [ ] The game is **live and reachable at a public URL** by anyone with the link, with no local setup required.
- [ ] Core actions (move, aim, shoot, reload, win/lose) all function correctly end-to-end in a live session.

**Method:** Run this checklist manually against the deployed production URL before considering any milestone "shippable."

---

## 15. Testing Type Summary Table

| Testing Type | Scope | When Run | Primary Goal |
|---|---|---|---|
| Unit | Single function/class | Every commit (CI) | Correctness of small logic pieces |
| Component | Single UI component | Every commit (CI) | UI renders/behaves correctly in isolation |
| Module/Integration | Multiple units together | Every commit (CI) | Modules cooperate correctly |
| API/Backend | Endpoints & socket handlers | Every commit (CI) | Backend contracts hold |
| System | Whole app end-to-end | Before each release | Full requirements met |
| E2E | Scripted user journeys | Before each release / nightly | Automated real-flow verification |
| Black Box | External behavior only | Before each release | Real player experience is intuitive & correct |
| White Box | Internal logic/branches | During development | All code paths verified |
| Regression | Full existing suite | Every commit (CI) | Nothing previously working has broken |
| Performance | Load/stress/latency | Before major releases | System stays stable & fair under real conditions |
| Compatibility | Devices/browsers/networks | Before each release | Truly cross-device as required |
| Security | Abuse & attack vectors | Before launch, periodically | Server-authoritative integrity holds |
| Usability | Real first-time users | Before launch, periodically | "No explanation needed" goal is actually met |
| Acceptance (UAT) | Full requirement checklist | Before each milestone/launch | Product matches original brief |

---

## 16. Recommended Testing Priority for MVP

**Must-have before first public link is shared:**
1. Unit tests for combat math (damage, ammo, respawn).
2. Integration tests for the Room/Player/Weapon flow.
3. Manual black-box test: a friend plays with zero explanation.
4. Manual cross-device test: two different devices, two different networks.
5. Basic security check: confirm server rejects obviously invalid inputs (no client-trusted damage).
6. Acceptance checklist run against the live deployed URL.

**Add once MVP is stable:**
- Automated E2E suite (Playwright multi-context).
- Load/performance testing before advertising the game more broadly.
- Full regression suite wired into CI.
- Formal usability sessions with multiple testers.
