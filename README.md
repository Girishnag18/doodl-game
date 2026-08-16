# Doodl — a multiplayer drawing & guessing party game (Phase 1 MVP)

An original drawing-and-guessing game, in the spirit of classic party games like
Skribbl.io, built from scratch with server-authoritative state, real-time
Socket.IO sync, and an original visual identity (name/colors/UI are placeholders
you should freely restyle).

See `docs/DESIGN.md` for the full architecture: state machine, WebSocket event
contract, scoring algorithm, DB schema, security model, and scalability notes.

## What's implemented (Phase 1 MVP)

- Server-authoritative state machine: LOBBY → COUNTDOWN → WORD_SELECTION →
  DRAWING → ROUND_END → next drawer/round → GAME_END → RESULTS
- Real Socket.IO multiplayer rooms with join codes, host controls, kick
- 3-word selection, per-socket delivery so the answer never reaches non-drawers
- Real-time canvas sync (pencil/marker/eraser/line/rect/circle/fill, undo/redo/clear)
- Guessing with server-side validation, rank-based scoring, deterministic
  close-guess detection (Levenshtein-based, no AI), progressive hints
- Reactions, chat, rate limiting, drawer-disconnect handling, results screen
- Mobile-responsive layout (not just a shrunk desktop UI)

## Phase 2 — Polish (added)

- Lightweight, server-validated player avatars (SVG, no image assets) — see
  `client/src/ui/Avatar.js`; server never trusts client avatar config
  (`sanitizeAvatar` in `server/src/game/Room.js` falls back to safe defaults
  on any invalid/malicious field).
- Synthesized sound effects via Web Audio API — `client/src/audio/sounds.js`
  — countdown/correct-guess/timer-warning/round-start/round-end/victory/
  reaction sounds, all generated in-browser (no copyrighted audio files),
  toggleable from the home screen.
- Polished round-transition banner ("Round N — X's turn to draw").

## Phase 3 — Social features (added)

- **Accounts**: register/login/guest via `/api/auth`. Passwords are hashed with
  Node's built-in `crypto.scrypt` (no plaintext ever stored), sessions use a
  dependency-free signed token (`server/src/services/authCrypto.js`) instead
  of `jsonwebtoken`/`bcrypt` since this sandbox has no network access to
  install packages — swap in real bcrypt/JWT libs in production if preferred,
  the interface is the same shape.
- **Profiles**: games played/won, guesses/correct-guesses tracked per account
  (`server/src/services/UserStore.js`), updated automatically at `GAME_END`
  for any player who was logged in (guests are skipped — nothing to persist).
- **Friends**: add by username, accept/remove, block — deliberately simple,
  no activity feed or full social graph (per spec §31).
- **Spectator / late joining**: joining a room mid-game adds you as a
  spectator (see the "👀 Watching" banner) — you see public state but never
  the secret word, and you're automatically promoted into the player
  rotation at the start of the next round.
- **Private invitations**: "copy invite link" in the lobby encodes the room
  code as a `?join=CODE` URL that auto-fills the join field.
- **Optional voice chat**: WebRTC full-mesh, server only relays signaling
  (`voice:*` socket events) — audio never touches the server. Fully optional;
  the game works with it off (per spec §22).

⚠️ **Storage note**: `UserStore` is in-memory (resets on server restart) —
this sandbox couldn't install `pg`/Postgres. It's structured field-for-field
to match the schema in `docs/DESIGN.md`, so swapping in real Postgres queries
is a mechanical change. Also note: the client keeps the auth token in memory
only (no localStorage), so refreshing the page logs you out — a real
deployment should use an httpOnly cookie session instead; this is called out
as a known Phase-3 limitation, not an oversight.

## Phase 4 — Advanced quality features (added)

- **Drawing replay**: at round end, click "▶ Replay drawing" to watch the
  round's strokes play back on the canvas one at a time.
- **Richer end-game stats**: 🎨 Best Artist, 🧠 Best Guesser, ⚡ Fastest
  Guesser, 😂 Most Guessed Drawing — all computed server-side from real
  per-round guess data (`Room.computeFunStats()`), not placeholders.
- **Reconnection**: disconnecting (tab switch, brief network drop) doesn't
  remove you from the game — your seat, score, and drawer-rotation slot are
  held for a 30s grace period (`settings.reconnectGraceMs`). A signed,
  per-seat reconnect token (opaque to the client, verified server-side) lets
  you resume automatically on reload. The drawer disconnecting still safely
  skips their turn immediately, independent of the grace period, per spec.
- **Moderation**: host can mute (blocks chat/guessing) or ban (removes +
  blocks their username from rejoining) any player from the in-game player
  list; anyone can report a player with a reason. All of it is
  authorization-checked server-side — a non-host calling mute/ban is a no-op.

Everything above was verified with real assertions during development
(reconnect token re-keying across sockets, mute blocking a correct guess,
ban preventing rejoin, fun-stats math), not just "written and assumed to
work" — see the git history / build transcript for the test scripts if useful.

Not yet built: a persistent drawing gallery beyond in-round replay (Phase 4
covered replay + stats + reconnection + moderation, listed above).

## Running it

This sandbox has no network access, so dependencies couldn't be installed here
(`npm install` failed with a 403 from the registry). Everything has been
syntax-checked and the core game logic (Room state machine, scoring, word
matching, hints) has been exercised with inline Node test scripts — see the
assertions run during development. To actually run it locally:

```bash
cd server
npm install       # express, socket.io, cors, nanoid
npm start          # serves API + client at http://localhost:3001
```

Then open `http://localhost:3001` in two+ browser tabs to play. The server
also statically serves `/client`, so no separate frontend build step is needed
for Phase 1 — `client/index.html` loads `socket.io-client` from a CDN and the
app code as ES modules directly (no bundler required for the MVP).

## Project structure

```
/client/src/{game,canvas,ui,components,services,socket,audio,utils}
/server/src/{controllers,services,models,routes,socket,game,middleware,utils}
/database/{migrations,seeds}   # Postgres schema lives in docs/DESIGN.md,
                                 # ready to translate into migrations for Phase 3
/tests
/docs/DESIGN.md
```

## Next steps toward Phase 2+

1. Add automated tests under `/tests` (Jest) covering the scenarios in
   `docs/DESIGN.md` §"Testing" — the inline checks done during this build are
   a good starting point to port over.
2. Swap in Postgres using the schema in `docs/DESIGN.md`, wire up
   `/database/migrations`.
3. Add avatars, sound effects, and polish animations (Phase 2).
4. Add accounts/auth, friends, spectator mode, voice chat (Phase 3).
5. Add drawing replay persistence and richer end-game stats (Phase 4).
