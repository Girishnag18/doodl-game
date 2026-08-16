const roomManager = require("../game/RoomManager");
const rateLimiter = require("../middleware/rateLimiter");
const { PHASES } = require("../game/Room");
const { verifyToken } = require("../services/authCrypto");
const userStore = require("../services/UserStore");

const TIMER_TICK_MS = 1000;

function sanitizeUsername(name) {
  return String(name || "Player")
    .replace(/[^\w \-']/g, "")
    .slice(0, 20)
    .trim() || "Player";
}

/** Resolves a real account id from a client-supplied auth token, or null for guests.
 *  Never trusts anything else the client claims about its identity. */
function resolveUserId(authToken) {
  const payload = verifyToken(authToken);
  if (!payload || payload.guest) return null;
  const user = userStore.getById(payload.sub);
  return user ? user.id : null;
}

function attachGameSocket(io) {
  const roomTimers = new Map(); // code -> { intervalId, endsAt, wordSelectTimeout }
  const socketToUserId = new Map(); // socketId -> real account id (omitted for guests)
  const pendingRemovals = new Map(); // "code:socketId" -> timeoutId, cleared on reconnect

  function clearRoomTimers(code) {
    const t = roomTimers.get(code);
    if (t?.intervalId) clearInterval(t.intervalId);
    if (t?.timeoutId) clearTimeout(t.timeoutId);
    roomTimers.delete(code);
  }

  function broadcastState(room) {
    io.to(room.code).emit("room:state", room.publicState());
  }

  /** Only updates real accounts (guests are skipped — nothing to persist for them). */
  function recordGameStats(room, results) {
    const winnerId = results.scoreboard[0]?.id;
    for (const entry of results.scoreboard) {
      const userId = socketToUserId.get(entry.id);
      if (!userId) continue;
      userStore.recordGameResult(userId, {
        won: entry.id === winnerId,
        guessesMade: undefined, // per-guess counts aren't tracked at this granularity yet
        correctGuesses: undefined,
      });
    }
  }

  function sendPrivateWordInfoToNonDrawers(room) {
    for (const player of room.players.values()) {
      if (player.id === room.currentDrawerId) continue;
      io.to(player.id).emit("word:hiddenSlots", { slots: room.hiddenSlotsFor() });
    }
  }

  function startWordSelection(room) {
    room.advanceToNextRound();
    if (room.phase === PHASES.GAME_END) {
      const results = room.finalResults();
      recordGameStats(room, results);
      io.to(room.code).emit("game:ended", results);
      broadcastState(room);
      clearRoomTimers(room.code);
      return;
    }
    broadcastState(room);
    io.to(room.currentDrawerId).emit(
      "word:choices",
      room.wordChoices.map((w) => w.word)
    );
    io.to(room.code).emit("round:starting", {
      roundNumber: room.roundNumber,
      drawerId: room.currentDrawerId,
    });

    clearRoomTimers(room.code);
    const timeoutId = setTimeout(() => {
      if (room.phase !== PHASES.WORD_SELECTION) return;
      room.autoSelectWord();
      beginDrawingPhase(room);
    }, room.settings.wordSelectionMs);
    roomTimers.set(room.code, { timeoutId });
  }

  function beginDrawingPhase(room) {
    broadcastState(room);
    sendPrivateWordInfoToNonDrawers(room);
    io.to(room.currentDrawerId).emit("word:selected", { word: room.currentWord });
    io.to(room.code).emit("round:started", {
      durationMs: room.settings.roundDurationMs,
      drawerId: room.currentDrawerId,
    });

    clearRoomTimers(room.code);
    const startedAt = Date.now();
    const intervalId = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (room.settings.hintsEnabled) {
        io.to(room.code).emit("hint:tick", { elapsed });
        sendPrivateWordInfoToNonDrawers(room);
      }
      if (elapsed >= room.settings.roundDurationMs || room.allNonDrawersGuessed()) {
        finishRound(room);
      }
    }, TIMER_TICK_MS);
    roomTimers.set(room.code, { intervalId });
  }

  function finishRound(room) {
    clearRoomTimers(room.code);
    const { word, strokes } = room.endRound();
    broadcastState(room);
    io.to(room.code).emit("round:ended", {
      word,
      replayStrokes: strokes,
      scores: [...room.players.values()].map((p) => ({ id: p.id, score: p.score })),
    });

    const timeoutId = setTimeout(() => startWordSelection(room), 5000);
    roomTimers.set(room.code, { timeoutId });
  }

  io.on("connection", (socket) => {
    socket.on("room:create", ({ username, settings, avatar, authToken } = {}, cb) => {
      try {
        const room = roomManager.createRoom(socket.id, sanitizeUsername(username), avatar);
        const userId = resolveUserId(authToken);
        if (userId) socketToUserId.set(socket.id, userId);
        if (settings) Object.assign(room.settings, sanitizeSettings(settings));
        socket.join(room.code);
        cb?.({ ok: true, room: room.publicState(), reconnectToken: room.getReconnectToken(socket.id) });
        broadcastState(room);
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });

    socket.on("room:join", ({ roomCode, username, avatar, authToken } = {}, cb) => {
      try {
        const code = String(roomCode || "").toUpperCase();
        const existingRoom = roomManager.rooms.get(code);
        if (existingRoom?.isUsernameBanned(sanitizeUsername(username))) {
          return cb?.({ ok: false, error: "You've been banned from this room" });
        }
        const room = roomManager.joinRoom(
          code,
          socket.id,
          sanitizeUsername(username),
          avatar,
          { asSpectatorIfInProgress: true }
        );
        const userId = resolveUserId(authToken);
        if (userId) socketToUserId.set(socket.id, userId);
        socket.join(room.code);
        const joinedAsSpectator = room.spectators.has(socket.id);
        cb?.({
          ok: true,
          room: room.publicState(),
          asSpectator: joinedAsSpectator,
          reconnectToken: joinedAsSpectator ? null : room.getReconnectToken(socket.id),
        });
        broadcastState(room);
        io.to(room.code).emit("chat:system", {
          text: `${sanitizeUsername(username)} ${joinedAsSpectator ? "joined to watch" : "joined"}.`,
        });
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });

    // Resume a seat after a temporary disconnect (tab switch, brief network loss).
    // The reconnect token is opaque and per-seat — never trust a client-claimed identity otherwise.
    socket.on("room:rejoin", ({ roomCode, reconnectToken } = {}, cb) => {
      const code = String(roomCode || "").toUpperCase();
      const room = roomManager.rooms.get(code);
      if (!room) return cb?.({ ok: false, error: "Room not found" });
      const found = room.findDisconnectedPlayerByToken(reconnectToken);
      if (!found) return cb?.({ ok: false, error: "Nothing to reconnect to" });

      const pending = pendingRemovals.get(`${code}:${found.socketId}`);
      if (pending) clearTimeout(pending);
      pendingRemovals.delete(`${code}:${found.socketId}`);

      room.reconnectPlayer(found.socketId, socket.id);
      roomManager.socketToRoom.delete(found.socketId);
      roomManager.socketToRoom.set(socket.id, code);
      socket.join(code);
      cb?.({ ok: true, room: room.publicState(), reconnectToken });
      broadcastState(room);
      io.to(code).emit("chat:system", { text: `${found.player.username} reconnected.` });
    });

    socket.on("host:updateSettings", ({ settings } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || !room.isHost(socket.id) || room.phase !== PHASES.LOBBY) return;
      Object.assign(room.settings, sanitizeSettings(settings));
      broadcastState(room);
    });

    socket.on("host:kick", ({ playerId } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || !room.isHost(socket.id)) return;
      io.sockets.sockets.get(playerId)?.leave(room.code);
      room.removePlayer(playerId);
      broadcastState(room);
    });

    socket.on("host:mute", ({ playerId } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      try {
        const isMuted = room.muteToggle(socket.id, playerId);
        broadcastState(room);
        io.to(playerId).emit("you:muted", { muted: isMuted });
      } catch {
        /* not host — ignore */
      }
    });

    socket.on("host:ban", ({ playerId } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      try {
        room.banPlayer(socket.id, playerId);
        io.sockets.sockets.get(playerId)?.leave(room.code);
        io.to(playerId).emit("you:banned");
        roomManager.socketToRoom.delete(playerId);
        broadcastState(room);
      } catch {
        /* not host — ignore */
      }
    });

    socket.on("player:report", ({ playerId, reason } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      if (!rateLimiter.allow(`report:${socket.id}`, { capacity: 3, refillPerSec: 0.1 })) return;
      room.reportPlayer(socket.id, playerId, reason);
    });

    socket.on("host:startGame", (_payload, cb) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || !room.isHost(socket.id)) return cb?.({ ok: false });
      try {
        room.startGame();
        broadcastState(room);
        cb?.({ ok: true });
        setTimeout(() => startWordSelection(room), 3000); // COUNTDOWN
      } catch (err) {
        cb?.({ ok: false, error: err.message });
      }
    });

    socket.on("word:select", ({ word } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || room.phase !== PHASES.WORD_SELECTION) return;
      try {
        room.selectWord(socket.id, word);
        beginDrawingPhase(room);
      } catch {
        /* ignore invalid selection attempts */
      }
    });

    socket.on("draw:stroke", (stroke) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || room.phase !== PHASES.DRAWING) return;
      if (!rateLimiter.allow(`stroke:${socket.id}`, { capacity: 40, refillPerSec: 30 })) return;
      if (!room.addStroke(socket.id, stroke)) return;
      socket.to(room.code).emit("draw:stroke", stroke);
    });

    socket.on("draw:clear", () => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || socket.id !== room.currentDrawerId) return;
      room.strokes = [];
      socket.to(room.code).emit("draw:clear");
    });

    socket.on("guess:submit", ({ text } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      if (!rateLimiter.allow(`guess:${socket.id}`, { capacity: 5, refillPerSec: 1 })) return;
      const clean = String(text || "").slice(0, 60);
      if (!clean.trim()) return;

      const { result, rank, points } = room.submitGuess(socket.id, clean);
      const player = room.players.get(socket.id);

      if (result === "correct") {
        io.to(room.code).emit("guess:correct", {
          playerId: socket.id,
          username: player.username,
          rank,
        });
        io.to(socket.id).emit("guess:youGotIt", { points });
        broadcastState(room);
        if (room.allNonDrawersGuessed()) finishRound(room);
      } else if (result === "close") {
        io.to(socket.id).emit("guess:close");
        io.to(room.code).emit("chat:message", {
          playerId: socket.id,
          username: player.username,
          text: clean,
          isGuess: true,
        });
      } else if (result === "incorrect") {
        io.to(room.code).emit("chat:message", {
          playerId: socket.id,
          username: player.username,
          text: clean,
          isGuess: true,
        });
      } else if (result === "muted") {
        io.to(socket.id).emit("you:muted", { muted: true });
      }
      // "already-guessed" / "is-drawer": silently ignored, no leak
    });

    socket.on("chat:message", ({ text } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      if (room.isMuted(socket.id)) return;
      if (!rateLimiter.allow(`chat:${socket.id}`, { capacity: 8, refillPerSec: 1 })) return;
      const clean = String(text || "").slice(0, 200);
      if (!clean.trim()) return;
      const player = room.players.get(socket.id);
      io.to(room.code).emit("chat:message", {
        playerId: socket.id,
        username: player.username,
        text: clean,
        isGuess: false,
      });
    });

    socket.on("reaction:send", ({ emoji } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      if (!rateLimiter.allow(`reaction:${socket.id}`, { capacity: 3, refillPerSec: 0.5 })) return;
      const allowed = ["😂", "🔥", "👏", "😭", "🤯", "❤️", "💀"];
      if (!allowed.includes(emoji)) return;
      io.to(room.code).emit("reaction:show", { playerId: socket.id, emoji });
    });

    socket.on("disconnect", () => {
      socketToUserId.delete(socket.id);
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;

      if (room.spectators.has(socket.id)) {
        room.removeSpectator(socket.id);
        broadcastState(room);
        return;
      }

      const wasDrawer = socket.id === room.currentDrawerId;

      // Soft-disconnect: keep the seat (score, drawer rotation slot) for a grace
      // period so a brief network drop or tab switch doesn't kick the player out
      // of the game — see spec §37 "Reconnection".
      room.markDisconnected(socket.id);
      broadcastState(room);
      io.to(room.code).emit("voice:peerLeft", { peerId: socket.id });

      // The drawer disconnecting still safely skips their turn immediately,
      // even though their seat is preserved for reconnection (spec §19).
      if (wasDrawer && room.phase === PHASES.DRAWING) {
        finishRound(room);
      }

      const key = `${room.code}:${socket.id}`;
      const timeoutId = setTimeout(() => {
        pendingRemovals.delete(key);
        const stillThere = room.players.get(socket.id);
        if (!stillThere || stillThere.connected) return; // already reconnected under a new id
        const updated = roomManager.leaveRoom(socket.id);
        if (updated) broadcastState(updated);
        else clearRoomTimers(room.code);
      }, room.settings.reconnectGraceMs);
      pendingRemovals.set(key, timeoutId);
    });

    // ---- Optional WebRTC voice chat: server only relays signaling messages,
    // it never touches audio itself. Voice chat is off by default per-room
    // (host toggles it) and the game is fully playable without it (spec §22).
    socket.on("voice:join", () => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || !room.settings.voiceChatEnabled) return;
      const existingPeers = [...room.players.keys(), ...room.spectators.keys()].filter(
        (id) => id !== socket.id
      );
      io.to(socket.id).emit("voice:existingPeers", { peers: existingPeers });
      socket.to(room.code).emit("voice:peerJoined", { peerId: socket.id });
    });

    socket.on("voice:signal", ({ targetId, signal } = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || !targetId || !signal) return;
      const targetInRoom = room.players.has(targetId) || room.spectators.has(targetId);
      if (!targetInRoom) return; // never relay to sockets outside this room
      io.to(targetId).emit("voice:signal", { fromId: socket.id, signal });
    });

    socket.on("voice:leave", () => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      socket.to(room.code).emit("voice:peerLeft", { peerId: socket.id });
    });
  });
}

function sanitizeSettings(settings = {}) {
  const out = {};
  if (Number.isInteger(settings.totalRounds)) out.totalRounds = Math.min(20, Math.max(1, settings.totalRounds));
  if (Number.isInteger(settings.roundDurationMs)) out.roundDurationMs = Math.min(180000, Math.max(20000, settings.roundDurationMs));
  if (Number.isInteger(settings.maxPlayers)) out.maxPlayers = Math.min(16, Math.max(2, settings.maxPlayers));
  if (["easy", "medium", "hard", "mixed"].includes(settings.difficulty)) out.difficulty = settings.difficulty;
  if (["official", "custom", "mixed"].includes(settings.wordMode)) out.wordMode = settings.wordMode;
  if (Array.isArray(settings.customWords)) {
    out.customWords = settings.customWords
      .map((w) => String(w).trim().toLowerCase())
      .filter((w) => w.length >= 3 && w.length <= 24 && /^[a-z ]+$/.test(w))
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 200);
  }
  if (typeof settings.hintsEnabled === "boolean") out.hintsEnabled = settings.hintsEnabled;
  if (typeof settings.closeGuessEnabled === "boolean") out.closeGuessEnabled = settings.closeGuessEnabled;
  if (typeof settings.allowSpectators === "boolean") out.allowSpectators = settings.allowSpectators;
  if (typeof settings.voiceChatEnabled === "boolean") out.voiceChatEnabled = settings.voiceChatEnabled;
  return out;
}

module.exports = { attachGameSocket };
