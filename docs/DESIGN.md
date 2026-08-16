# Doodl.io — Design Document (original name, placeholder — swap freely)

An original drawing-and-guessing party game. Server-authoritative, Socket.IO real-time,
Node/Express backend, vanilla Canvas frontend, Postgres for persistence.

## 1. Authoritative State Machine

The server owns a `GameStateMachine` per room. Client never sets state — it only receives
`state:update` events and renders.

```
LOBBY -> COUNTDOWN -> WORD_SELECTION -> DRAWING -> ROUND_END -> (NEXT_DRAWER loop)
                                                        |
                                            (all rounds done) -> GAME_END -> RESULTS -> LOBBY
```

State transition rules (server/src/game/StateMachine.js):
- `LOBBY`: waiting for host to start. Requires >= 2 players.
- `COUNTDOWN`: 3s fixed timer, purely cosmetic, cannot be skipped by clients.
- `WORD_SELECTION`: current drawer gets 3 words (weighted by difficulty setting).
  10s auto-pick timer — if the drawer doesn't choose, server picks randomly.
- `DRAWING`: round timer starts (configurable, default 80s). Drawing events, guesses,
  hints all flow here. Ends early if all non-drawer players have guessed correctly.
- `ROUND_END`: 5s reveal — shows the word, awards drawer points, optional stroke replay.
- `NEXT_DRAWER` / `NEXT_ROUND`: internal transitions, not player-visible states — just
  advance `currentDrawerIndex` and `roundNumber`, then jump back to `WORD_SELECTION`
  or to `GAME_END` if `roundNumber > totalRounds`.
- `GAME_END` -> `RESULTS`: final scoreboard + fun stats, "Play Again" resets to `LOBBY`
  keeping the same room/players.

Each room's state lives in a single in-memory object (or Redis hash if scaled across
multiple server instances) — never in the browser, never trusted from the browser.

## 2. WebSocket Event Contract

**Client -> Server**
| Event | Payload | Notes |
|---|---|---|
| `room:create` | `{ username, settings }` | returns room code |
| `room:join` | `{ roomCode, username }` | rejected if full/locked |
| `room:leave` | `{}` | |
| `host:updateSettings` | `{ settings }` | host only |
| `host:startGame` | `{}` | host only, needs >=2 players |
| `host:kick` | `{ playerId }` | host only |
| `word:select` | `{ word }` | drawer only, validated against the 3 offered |
| `draw:stroke` | `{ points, tool, color, size, strokeId }` | drawer only, throttled |
| `draw:clear` | `{}` | drawer only |
| `draw:undo` / `draw:redo` | `{}` | drawer only |
| `guess:submit` | `{ text }` | rate-limited, non-drawers only |
| `reaction:send` | `{ emoji }` | cooldown enforced server-side |
| `chat:message` | `{ text }` | |

**Server -> Client**
| Event | Payload |
|---|---|
| `room:state` | full public room snapshot (never includes the secret word) |
| `word:choices` | 3 words — sent **only** to the drawer's socket |
| `word:hiddenSlots` | e.g. `"_ _ _ _ _"` — sent to everyone else |
| `round:started` | drawer id, timer length, round number |
| `draw:stroke` | broadcast to non-drawer sockets |
| `guess:correct` | `{ playerId, rank }` — no word text, broadcast |
| `guess:close` | private to the guessing player only, `{}` (no clue content) |
| `guess:incorrect` | private, so it renders in that player's own chat |
| `hint:update` | new partially-revealed word string |
| `round:ended` | `{ word, scores, replayStrokes? }` — word only revealed now |
| `game:ended` | final scoreboard + fun stats |
| `error` | `{ code, message }` |

Key rule: **the secret word never appears in any payload sent to a socket that isn't the
current drawer**, until `round:ended`. This is enforced by using per-socket `emit`, never
`io.to(room).emit`, for anything word-related during `WORD_SELECTION`/`DRAWING`.

## 3. Scoring Algorithm (configurable, not hardcoded)

```js
// server/src/game/scoring.js
const SCORING_CONFIG = {
  basePoints: 100,
  rankDecay: 0.15,        // each subsequent correct guesser gets 15% less
  minGuesserPoints: 20,
  timeBonusWeight: 0.5,   // reward faster guesses within their rank bucket
  drawerPointsPerGuesser: 40,
  drawerNoGuessPenaltyFloor: 0, // drawer never goes negative
};
```
- Guesser score = `max(minGuesserPoints, basePoints * (1 - rankDecay)^(rank-1) * timeFactor)`
  where `timeFactor` scales 1.0 → 0.6 across the round timer.
- Drawer score = `drawerPointsPerGuesser * numberOfCorrectGuessers` (capped at basePoints * playerCount).
- No ELO/MMR/ranks — just a running room-scoped total shown in the sidebar and final results.

## 4. Database Schema (Postgres)

Only durable data goes here. Live round state (strokes-in-progress, timers) stays in
memory/Redis and is persisted in batch only if replay/history features are enabled.

```
users(id, username, email, password_hash, created_at)
profiles(user_id fk, avatar_json, games_played, games_won, total_guesses,
         correct_guesses, created_at)
rooms(id, code, host_user_id fk nullable, settings_json, is_public, created_at, closed_at)
games(id, room_id fk, started_at, ended_at, total_rounds)
rounds(id, game_id fk, round_number, drawer_user_id fk nullable, word,
       category, difficulty, started_at, ended_at)
players(id, game_id fk, user_id fk nullable, guest_name, score, joined_at, left_at)
scores(id, round_id fk, player_id fk, points, rank, guessed_at)
words(id, text, category, difficulty, language, is_active)
categories(id, name)
drawings(id, round_id fk, created_at)
drawing_strokes(id, drawing_id fk, tool, color, size, points_json, ts_offset_ms)
friends(id, user_id fk, friend_user_id fk, status, created_at)
reports(id, reporter_id fk, reported_id fk, room_id fk, reason, created_at)
bans(id, room_id fk, user_id fk nullable, ip_hash, created_at, expires_at)
messages(id, room_id fk, player_id fk, text, created_at)
```
Indexes: `rooms.code` (unique), `words(category, difficulty, is_active)`,
`scores(round_id, player_id)`, `friends(user_id, friend_user_id)` composite.

## 5. Security Risks & Mitigations

- **Answer leakage**: enforced by per-socket emit discipline (see §2) + server-side
  guess validation only (client never receives the plaintext word early).
- **Score manipulation**: all score math happens server-side from `guess:submit`;
  client-submitted scores are never accepted.
- **Fake/forged socket messages**: every inbound event validated against current
  state machine phase + sender identity (e.g. `draw:stroke` rejected unless
  `socket.id === room.currentDrawerSocketId`).
- **Spam/abuse**: per-socket rate limiter (token bucket) on `guess:submit`,
  `chat:message`, `reaction:send`; message length caps; profanity/username filter.
- **Auth**: bcrypt password hashing, httpOnly secure cookies or short-lived JWT +
  refresh, CSRF protection on non-socket routes, env-based secrets.
- **Room hijacking**: host actions require a signed host-token issued at room
  creation, checked server-side on every `host:*` event.

## 6. Scalability Notes

- Single Node process is fine for MVP (rooms held in-memory `Map`).
- To scale horizontally: move room state to Redis, use the Socket.IO Redis adapter
  for cross-instance broadcast, and make rooms sticky-routed (or fully
  stateless via Redis pub/sub) behind a load balancer.
- Drawing strokes are throttled/batched client-side (~40-60ms) before emission to
  cap WebSocket message rate.

## 7. MVP Plan (Phase 1 — this repo)

In-memory rooms (no DB yet, added in Phase 3+), full state machine, real Socket.IO
multiplayer, 3-word selection, canvas draw/sync, guessing, scoring, hints, timers,
round rotation, results screen, play again. This is what's implemented in
`/server` and `/client` in this repo.
