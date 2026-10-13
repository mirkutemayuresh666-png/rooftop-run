# Rooftop Run

Multiplayer parkour racing for phones and desktops. Up to **50 players per lobby**.
Public play auto-fills lobbies (a new one opens when the current one hits 50).
Friends can share a **private room code**, which is also capped at 50.

## Run locally
    npm install
    npm start          # http://localhost:3000
Open it on your phone using your computer's LAN address (same Wi-Fi), e.g. http://192.168.1.20:3000

## Put it online so anyone can play
Deploy this folder to any Node host (Render, Railway, Fly.io, a VPS). Start command: `npm start`.
The host must support WebSockets and provide HTTPS; the game connects over wss:// automatically.
Players open the URL and can use "Add to Home Screen" to play fullscreen.

## Tuning (top of server.js)
- MAX_PLAYERS: lobby limit (50)
- RUN_MS, AFTER_FIRST_FINISH_MS, BREAK_MS: round timing
Course layout is generated from a seed in public/level.js (LEVEL.SEED).
