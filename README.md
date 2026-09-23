# Lightweight 8P 2D Shooter (Phaser Arcade + Colyseus)

Target: <1.5MB client, 2-8 players, 20Hz tick.

## Run
1. `npm.cmd --prefix server install && npm.cmd --prefix client install`
2. Terminal 1: `npm.cmd --prefix server run dev` (ws://localhost:2567)
3. Terminal 2: `npm.cmd --prefix client run dev` (http://localhost:5173)

Controls: WASD move, Mouse aim, Click shoot. HP 100, 25 dmg, 3s respawn.
