# Doodl — Premium Multiplayer Drawing Game

Doodl is a lightweight multiplayer drawing-and-guessing game built with Node.js,
Express, Socket.IO, and vanilla HTML/CSS/JS. The project keeps the original
core loop intact — create a room, draw, guess, score, and advance to the next
round — while adding safer room settings, custom word banks, flexible word
selection, and a cleaner premium presentation.

## Architecture

- Client: `client/index.html` + `client/src/**/*.js` + `client/src/styles.css`
- Server: `server/src/index.js` + `server/src/socket/gameSocket.js`
- Game model: `server/src/game/Room.js`, `RoomManager.js`
- Word logic: `server/src/game/wordBank.js`, `wordMatch.js`, `scoring.js`
- Auth: `server/src/routes/authRoutes.js`, `server/src/services/authCrypto.js`
- User data: `server/src/services/UserStore.js`
- Realtime: Socket.IO room state, chat, draws, guesses, reactions, voice signaling

## Features

- Room creation and join flow with reconnect support
- Host-controlled lobby settings
- Max players validation from 2–20, enforced on the server
- Word-source options: official, custom, mixed
- 4 or 5 word choices per round, server-authoritative selection
- Custom word bank with bulk import, dedupe, validation, and count tracking
- Game phases: lobby, countdown, word selection, drawing, round end, results
- Canvas sync with drawing tools and replay support
- Guess validation, hints, scoring, and round progression
- Voice chat signaling, reactions, chat, and moderation controls

## Local setup

```bash
cd server
npm install
npm start
```

Then open `http://localhost:3001` in a browser. For local multiplayer testing,
open several tabs or windows in the same room.

## Environment variables

This project keeps a minimal configuration and does not require any external
service on startup. If you later add a deployment environment, use:

- `PORT` (optional override for the server port)
- `SESSION_SECRET` (for auth/session token hardening in production)
- `CLIENT_ORIGIN` (optional CORS allowlist in deployment environments)

## Custom words

The room host can configure a room word bank and choose how the drawer gets
word options:

- Official: use the built-in Doodl word pool
- Custom: use only that room's custom bank
- Mixed: combine the official bank with the room's custom words

The server validates the room setup before the game starts. For example, if a
room uses Custom mode with 5 choices but only 3 valid custom words are present,
start-game is rejected with a clear error.

## Room settings

Server-side validation is enforced for:

- `maxPlayers`: 2–20
- `wordChoiceCount`: 4 or 5
- `customWords`: 0–1000 sanitized entries
- `wordMode`: `official`, `custom`, or `mixed`
- `difficulty`: `easy`, `medium`, `hard`, or `mixed`
- Round duration, total rounds, hints, spectator mode, and voice settings

## Socket.IO notes

The app uses Socket.IO for room state, chat, guesses, drawing events, scoring,
reactions, and voice signaling. The server is the source of truth for room
state, word selection, and game progression.

## Auth and voice

- Guest, login, and sign-up flows stay in the existing app architecture.
- Voice chat remains optional and signaling is relayed by the server without
  moving audio through the backend.

## Deployment notes

- Keep `node_modules` out of version control.
- Use a production-grade reverse proxy or Node host for deployment.
- Add a real persistent session store and database for production workloads.
- Keep the server-authoritative game rules intact; do not trust client settings
  for word choice, scoring, room capacity, or host privileges.
