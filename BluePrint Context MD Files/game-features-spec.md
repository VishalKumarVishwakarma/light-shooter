# Multiplayer 2D Shooter — Feature Specification
### "Mini Militia"-style, browser-based, cross-device, real-time

---

## 0. High-Level Vision

A top-down or side-view 2D multiplayer shooter, playable in a browser on any device (laptop, phone, tablet), where 2+ players connect from anywhere over the internet, join the same match via a shared URL/room code, and fight using movement, aiming, shooting, and simple tactical mechanics — all governed by clear, learnable rules (health, ammo, respawn, win condition) with no explanation needed.

This document covers **game features only** (design + rules). Architecture/hosting/networking implementation will be a separate doc.

---

## 1. Core Game Loop

1. Player opens the URL → lands on a **Lobby/Menu screen**.
2. Player enters a **name** and either **creates a room** or **joins a room** via code/link.
3. Once 2+ players are in the room, the **host (or auto-timer)** starts the match.
4. Players spawn on a shared **map**, and the **match timer / score target** begins.
5. Players move, aim, shoot, take damage, die, respawn, and collect pickups until a **win condition** is met.
6. **Post-match screen** shows results (kills/deaths/score), with an option to **rematch** or **return to lobby**.

This loop must be fully playable without any tutorial — every mechanic should be visually self-evident (health bars, ammo counters, on-screen prompts).

---

## 2. Player Controls

### 2.1 Desktop Controls
| Action | Input |
|---|---|
| Move | WASD / Arrow Keys |
| Aim | Mouse position |
| Shoot | Left Click (hold for auto weapons) |
| Jump (if platformer-style) | Spacebar |
| Reload | R |
| Switch Weapon | 1 / 2 / Scroll Wheel |
| Use Pickup / Interact | E |
| Chat / Emote (optional) | Enter |

### 2.2 Mobile / Touch Controls
- **Virtual joystick** (left thumb) for movement — floating joystick that appears where the thumb touches.
- **Virtual aim + fire button** (right thumb) — drag to aim, tap/hold to shoot, OR auto-fire toward drag direction.
- **Reload button** (small icon, top-right of fire zone).
- **Jump button** (if applicable).
- Controls must be rendered as **transparent overlays** that don't obscure gameplay, and scale properly on different screen sizes (responsive canvas).

### 2.3 Control Requirements
- Input must feel responsive (client-side prediction so local movement isn't delayed by network lag).
- Controls scheme should auto-detect device type (touch vs mouse/keyboard) on load.

---

## 3. Movement & Physics Rules

- **Grid-free, continuous movement** in 2D space (top-down) or **side-scrolling with gravity + jump/jetpack** (Mini-Militia style).
- If side-scrolling (recommended to match "Mini Militia" feel):
  - **Gravity** constantly pulls player down.
  - **Jetpack/Jump fuel bar** — holding jump consumes fuel, refills when grounded or over time.
  - **Collision with platforms/terrain** — solid ground, one-way platforms (can jump up through, stand on top).
  - **Player-vs-player collision** — optional (soft push or pass-through, must be decided and stated as a rule).
- **Map boundaries** — invisible walls or death-zones at map edges (falling off = respawn + death penalty).
- Movement speed, jump height, and gravity constants must be **fixed and identical for all players** (no pay-to-win, no randomness) — this is a "rule" players can learn by observation.

---

## 4. Combat System

### 4.1 Health & Damage
- Every player starts each life with **100 HP** (visible health bar above their character, visible to all players — this is how others learn the "rule" of damage without instruction).
- Getting hit reduces HP by a fixed, weapon-specific amount.
- **Death** occurs at 0 HP → visible death animation + kill feed message ("PlayerA eliminated PlayerB").
- **Respawn** after a fixed timer (e.g., 3 seconds) at a designated spawn point, full HP restored.
- Optional: brief **spawn invulnerability** (1–2 sec, visually flashing) to prevent spawn-killing — this is an important, learnable fairness rule.

### 4.2 Weapons (start simple, expand later)
| Weapon | Fire Rate | Damage | Ammo Capacity | Reload Time | Range/Falloff |
|---|---|---|---|---|---|
| Pistol (default/infinite ammo) | Medium | Low | Unlimited | None | Medium |
| Assault Rifle | Fast (auto) | Medium | 30/clip | 2s | Medium-Long |
| Shotgun | Slow | High (close range) | 6/clip | 2.5s | Short, spread pellets |
| Sniper | Very slow | Very high | 5/clip | 3s | Long, pinpoint |
| Grenade (throwable) | N/A | Area damage | Limited charges | Cooldown-based | Arc trajectory |

- Every player **always has the default pistol** as a fallback (never fully disarmed) — a clear, fair rule.
- Weapon pickups spawn at fixed map locations, visually marked (glowing icon), and respawn after a timer once collected.
- **Ammo count and current weapon** always visible in the HUD — self-explanatory without instruction.

### 4.3 Bullets / Projectiles
- Bullets are simulated objects with a **travel speed and trajectory** (not instant hitscan, to feel true to Mini Militia) — OR fast hitscan with visible tracer line, depending on performance needs.
- Bullets destroy on: hitting a player (damage), hitting terrain (visual spark), or exceeding max range (despawn).
- **Friendly fire rules must be explicit**: in free-for-all, everyone can hurt everyone; in team mode, teammates cannot damage each other (or damage is reduced) — displayed via colored health bars/nametags.

### 4.4 Melee (optional but great for "Mini Militia feel")
- Close-range knife/melee attack with cooldown, one-shot or high damage — encourages aggressive close encounters and adds a learnable risk/reward rule.

---

## 5. Game Modes & Win Conditions

Pick at least one to build first (Free-for-All is simplest and recommended for MVP):

### 5.1 Free-for-All (FFA) Deathmatch
- Every player fights every player.
- **Win condition**: first to reach a kill target (e.g., 15 kills) OR highest kills when the match timer expires (e.g., 5 minutes).
- Live **scoreboard** (Tab or side panel) showing all players ranked by kills/deaths — visible anytime, reinforcing the rule of "how to win" without explanation.

### 5.2 Team Deathmatch (stretch goal)
- Players auto-balanced into 2 teams (color-coded, e.g., Red vs Blue).
- Team kill count aggregated; first team to target score, or highest at timer end, wins.
- No friendly fire (or reduced) — reinforced with team-colored health bars/nametags.

### 5.3 Match Structure (applies to all modes)
- **Pre-match countdown** (e.g., "Match starts in 5...4...3...") once minimum players (2) join.
- **In-match HUD**: timer countdown, kill target/score, live scoreboard toggle.
- **Post-match summary screen**: winner announcement, final scoreboard (K/D), "Play Again" and "Leave" buttons.
- **Minimum players to start = 2**; if players drop below required minimum mid-match, the game either pauses, waits, or ends early with a clear on-screen message (a real rule, not silent failure).

---

## 6. Map Design

- Start with **one small, well-designed map** (MVP), sized appropriately for 2–8 players (avoid huge empty space with only 2 players).
- Include:
  - Multiple platforms/elevation levels (if side-scrolling) for verticality and cover.
  - **Cover objects** (walls, crates) to block line-of-sight and bullets.
  - **2–4 weapon/ammo/health pickup spawn points**, spread around the map so no single spot dominates.
  - **Multiple spawn points** (4–8), spaced apart, to reduce spawn-camping.
- Map boundaries clearly visually distinct (background art / border) so players instinctively understand where they can and can't go.

---

## 7. Pickups & Power-Ups

| Pickup | Effect | Respawn Time |
|---|---|---|
| Health Pack | Restores 50 HP (cap at 100) | 15s |
| Ammo Crate | Refills current weapon ammo | 15s |
| Weapon Spawns | Grants weapon listed above | 20–30s |
| (Stretch) Shield/Armor | Absorbs next X damage | 30s |
| (Stretch) Speed Boost | Temporary movement speed increase | 30s |

- All pickups **visibly rendered on the map** with icons and a "pop" animation when they respawn — self-explanatory design.

---

## 8. HUD (Heads-Up Display) — Critical for "rules without explanation"

Must always show:
- **Own health bar** (bottom-left or top-left, with numeric HP).
- **Current weapon + ammo count** (bottom-right).
- **Kill feed** (top-right): "PlayerX killed PlayerY" messages, fade after a few seconds.
- **Match timer** and **score/kill target** (top-center).
- **Minimap** (optional stretch) showing player positions and pickup locations.
- **Other players' health bars** floating above their characters (small, always visible) — this alone teaches the damage rule instantly.
- **Connection/ping indicator** (small icon) so players understand lag isn't a bug.

---

## 9. Lobby, Rooms & Session Management

- **Room creation**: generates a short shareable code (e.g., `ABCD12`) and a direct URL (`yourgame.com/room/ABCD12`) that others can open to join instantly.
- **Room join**: via code entry or clicking the shared link directly.
- **Player name entry** (with optional random name generator/avatar color if skipped).
- **Lobby player list**: shows connected players, ready status, and a "Start Match" button (host-controlled) or auto-start timer once 2+ players present.
- **Reconnect support**: if a player's connection drops mid-match, they should be able to rejoin the same room within a grace period without losing progress (stretch goal, but important for real cross-device play).
- **Room capacity**: define max players per room (e.g., 2–8) and show "Room Full" message if exceeded.

---

## 10. Cross-Device & Cross-Network Requirements (Feature-Level)

- Must work on **Chrome, Safari, Firefox** across **desktop, Android, iOS** without installation (pure web app).
- Must support players on **completely different networks/locations** (not just same WiFi) — implies real internet-facing hosting, not LAN-only.
- Responsive canvas that resizes to fit any screen/aspect ratio (phone portrait, phone landscape, desktop widescreen) without breaking hit detection.
- Game must tolerate **latency differences** between players gracefully (interpolation/prediction so a player with 150ms ping isn't unplayable) — a technical feature but directly affects "real rules" fairness.

---

## 11. Audio & Feedback (Polish Layer)

- Gunshot sounds per weapon type.
- Hit-marker sound/visual when you damage another player.
- Death/respawn sound cues.
- Footstep or jetpack sound (side-scrolling version).
- Background music (lobby + in-match, muteable).
- Screen shake / hit-flash on taking damage (juice, helps players *feel* the rules).

---

## 12. Accessibility & Onboarding (No-Explanation Requirement)

Since the requirement is "rules a player could follow without you explaining them," these UX features matter as much as mechanics:
- **First-launch overlay** (optional, skippable) showing control scheme icons (not mandatory text tutorial — think icon-based, like a loading screen tip).
- **Visual consistency**: red = enemy/damage, green = health, yellow = ammo/pickups — universal color language.
- **Kill feed + scoreboard** double as an implicit rulebook — players infer "shooting reduces health, 0 health = death, most kills = winning" purely by observation within the first 30 seconds.
- **Clear win/lose screen** with explicit reason (e.g., "Red Team Wins — 15 Kills").

---

## 13. MVP Scope vs. Stretch Goals

**MVP (build first):**
- 2–4 player Free-for-All
- One map
- Movement + shooting + 2 weapons (pistol + one more)
- Health/death/respawn
- Basic HUD + kill feed + scoreboard
- Room creation/joining via URL
- Match timer + kill-target win condition
- Works on desktop + mobile browsers

**Stretch Goals (after MVP works):**
- Team Deathmatch mode
- Multiple maps
- More weapons + grenades + melee
- Power-ups (shield, speed)
- Reconnect handling
- Voice/text chat or emotes
- Minimap
- Persistent player stats/leaderboard across sessions
- Spectator mode

---

## 14. Summary Rule Set (What a New Player Infers Instantly)

By the time a first-time player has played for 60 seconds, they should understand, **without being told**:
1. WASD/joystick moves me, mouse/drag aims, click/tap shoots.
2. My health bar drops when I'm hit; it hits 0, I die.
3. I respawn after dying and can keep playing.
4. Picking up glowing items gives me weapons/ammo/health.
5. The scoreboard/kill counter shows who's winning.
6. The match ends when someone hits the kill target or time runs out, and a winner is declared.

If every one of these is true from pure observation, the "real rules a player could follow without explanation" requirement is met.
