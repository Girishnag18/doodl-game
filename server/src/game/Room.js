const crypto = require("crypto");
const { pickRandomWords } = require("./wordBank");
const { computeGuesserPoints, computeDrawerPoints } = require("./scoring");
const {
  isExactMatch,
  isCloseGuess,
  buildHiddenSlots,
  computeHintIndices,
} = require("./wordMatch");

const PHASES = {
  LOBBY: "LOBBY",
  COUNTDOWN: "COUNTDOWN",
  WORD_SELECTION: "WORD_SELECTION",
  DRAWING: "DRAWING",
  ROUND_END: "ROUND_END",
  GAME_END: "GAME_END",
  RESULTS: "RESULTS",
};

const DEFAULT_SETTINGS = {
  totalRounds: 3,
  roundDurationMs: 80_000,
  wordSelectionMs: 10_000,
  maxPlayers: 12,
  difficulty: "mixed", // easy | medium | hard | mixed
  wordMode: "official", // official | custom | mixed
  customWords: [],
  hintsEnabled: true,
  hintCount: 3,
  closeGuessEnabled: true,
  isPublic: false,
  allowSpectators: true,
  voiceChatEnabled: true,
  reconnectGraceMs: 30_000,
};

/** One instance per room. Holds ALL authoritative state. Never trust client input. */
class Room {
  constructor(code, hostSocketId, hostUsername, hostAvatar) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.settings = { ...DEFAULT_SETTINGS };
    this.players = new Map(); // socketId -> { id, username, score, isDrawer, hasGuessedThisRound, connected }
    this.spectators = new Map(); // socketId -> { id, username, avatar } — joined mid-game, watch-only
    this.phase = PHASES.LOBBY;
    this.roundNumber = 0;
    this.drawerOrder = [];
    this.currentDrawerIndex = -1;
    this.currentWord = null;
    this.wordChoices = [];
    this.usedWords = new Set();
    this.roundStartedAt = null;
    this.correctGuessOrder = []; // socketIds in guess order this round
    this.strokes = []; // for replay
    this.timers = {};
    this.stats = { drawingsGuessedCount: {}, correctGuessCount: {}, guessTimesMs: {}, roundGuessCounts: [] };
    this.mutedPlayerIds = new Set();
    this.bannedUsernames = new Set(); // lowercase usernames banned from this room
    this.reports = []; // { reporterId, reportedId, reason, ts }

    this.addPlayer(hostSocketId, hostUsername, hostAvatar);
  }

  addPlayer(socketId, username, avatar) {
    this.players.set(socketId, {
      id: socketId,
      username: username.slice(0, 20),
      avatar: sanitizeAvatar(avatar),
      score: 0,
      isDrawer: false,
      hasGuessedThisRound: false,
      connected: true,
      reconnectToken: crypto.randomUUID(),
    });
    if (!this.drawerOrder.includes(socketId)) this.drawerOrder.push(socketId);
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    this.drawerOrder = this.drawerOrder.filter((id) => id !== socketId);
  }

  /** Marks a player disconnected but keeps their seat/score for the reconnect grace period. */
  markDisconnected(socketId) {
    const player = this.players.get(socketId);
    if (player) player.connected = false;
  }

  /** @returns the reconnect token needed to resume this seat, or null if not found. */
  getReconnectToken(socketId) {
    return this.players.get(socketId)?.reconnectToken ?? null;
  }

  findDisconnectedPlayerByToken(token) {
    for (const [socketId, player] of this.players) {
      if (player.reconnectToken === token && !player.connected) return { socketId, player };
    }
    return null;
  }

  /** Re-keys a disconnected player's seat onto their new socket id after a reconnect. */
  reconnectPlayer(oldSocketId, newSocketId) {
    const player = this.players.get(oldSocketId);
    if (!player) return null;
    this.players.delete(oldSocketId);
    player.id = newSocketId;
    player.connected = true;
    this.players.set(newSocketId, player);

    const drawerIdx = this.drawerOrder.indexOf(oldSocketId);
    if (drawerIdx !== -1) this.drawerOrder[drawerIdx] = newSocketId;
    if (this.hostSocketId === oldSocketId) this.hostSocketId = newSocketId;
    this.correctGuessOrder = this.correctGuessOrder.map((id) => (id === oldSocketId ? newSocketId : id));
    if (this.mutedPlayerIds.has(oldSocketId)) {
      this.mutedPlayerIds.delete(oldSocketId);
      this.mutedPlayerIds.add(newSocketId);
    }
    return player;
  }

  // ---- Moderation (host mute/ban, player report) ----

  muteToggle(hostSocketId, targetId) {
    if (!this.isHost(hostSocketId)) throw new Error("Only the host can mute");
    if (this.mutedPlayerIds.has(targetId)) this.mutedPlayerIds.delete(targetId);
    else this.mutedPlayerIds.add(targetId);
    return this.mutedPlayerIds.has(targetId);
  }

  isMuted(socketId) {
    return this.mutedPlayerIds.has(socketId);
  }

  banPlayer(hostSocketId, targetId) {
    if (!this.isHost(hostSocketId)) throw new Error("Only the host can ban");
    const target = this.players.get(targetId);
    if (target) this.bannedUsernames.add(target.username.toLowerCase());
    this.removePlayer(targetId);
  }

  isUsernameBanned(username) {
    return this.bannedUsernames.has(String(username || "").toLowerCase());
  }

  reportPlayer(reporterId, reportedId, reason) {
    this.reports.push({ reporterId, reportedId, reason: String(reason || "").slice(0, 200), ts: Date.now() });
  }

  addSpectator(socketId, username, avatar) {
    this.spectators.set(socketId, {
      id: socketId,
      username: username.slice(0, 20),
      avatar: sanitizeAvatar(avatar),
    });
  }

  removeSpectator(socketId) {
    this.spectators.delete(socketId);
  }

  /** Called at the start of a new round: any watching spectators join as real players. */
  promoteSpectatorsToPlayers() {
    for (const [id, spec] of this.spectators) {
      this.addPlayer(id, spec.username, spec.avatar);
    }
    this.spectators.clear();
  }

  get playerCount() {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  isHost(socketId) {
    return this.hostSocketId === socketId;
  }

  get currentDrawerId() {
    return this.drawerOrder[this.currentDrawerIndex] ?? null;
  }

  /** Public snapshot safe to broadcast to ALL players — never includes the secret word. */
  publicState() {
    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      roundNumber: this.roundNumber,
      totalRounds: this.settings.totalRounds,
      hostId: this.hostSocketId,
      currentDrawerId: this.currentDrawerId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        username: p.username,
        avatar: p.avatar,
        score: p.score,
        isDrawer: p.id === this.currentDrawerId,
        hasGuessedThisRound: p.hasGuessedThisRound,
        connected: p.connected,
        isMuted: this.mutedPlayerIds.has(p.id),
      })),
      spectators: [...this.spectators.values()].map((s) => ({
        id: s.id,
        username: s.username,
        avatar: s.avatar,
      })),
    };
  }

  startGame() {
    if (this.playerCount < 2) throw new Error("Need at least 2 players");
    this.roundNumber = 0;
    this.currentDrawerIndex = -1;
    for (const p of this.players.values()) p.score = 0;
    this.phase = PHASES.COUNTDOWN;
  }

  advanceToNextRound() {
    this.promoteSpectatorsToPlayers();
    this.currentDrawerIndex = (this.currentDrawerIndex + 1) % this.drawerOrder.length;
    if (this.currentDrawerIndex === 0) this.roundNumber += 1;

    if (this.roundNumber > this.settings.totalRounds) {
      this.phase = PHASES.GAME_END;
      return;
    }
    for (const p of this.players.values()) p.hasGuessedThisRound = false;
    this.correctGuessOrder = [];
    this.strokes = [];
    this.phase = PHASES.WORD_SELECTION;

    const custom = (this.settings.customWords || []).map((w) => ({
      word: w,
      category: "Custom",
      difficulty: "medium",
    }));
    const pool =
      this.settings.wordMode === "custom" && custom.length >= 3
        ? custom
        : this.settings.wordMode === "mixed"
        ? [...custom, ...pickRandomWords(6, this.settings.difficulty, this.usedWords)]
        : pickRandomWords(6, this.settings.difficulty, this.usedWords);

    this.wordChoices = pickRandomWords === pool ? pool : shuffleSlice(pool, 3);
  }

  selectWord(socketId, word) {
    if (socketId !== this.currentDrawerId) throw new Error("Not the drawer");
    const match = this.wordChoices.find((w) => w.word === word);
    if (!match) throw new Error("Invalid word choice");
    this.currentWord = match.word;
    this.usedWords.add(match.word);
    this.wordChoices = [];
    this.roundStartedAt = Date.now();
    this.phase = PHASES.DRAWING;
  }

  autoSelectWord() {
    if (this.wordChoices.length === 0) return;
    const pick = this.wordChoices[Math.floor(Math.random() * this.wordChoices.length)];
    this.currentWord = pick.word;
    this.usedWords.add(pick.word);
    this.wordChoices = [];
    this.roundStartedAt = Date.now();
    this.phase = PHASES.DRAWING;
  }

  hiddenSlotsFor() {
    const elapsed = Date.now() - this.roundStartedAt;
    const revealed = this.settings.hintsEnabled
      ? computeHintIndices(
          this.currentWord,
          elapsed,
          this.settings.roundDurationMs,
          this.settings.hintCount
        )
      : new Set();
    return buildHiddenSlots(this.currentWord, revealed);
  }

  /** @returns {"correct"|"close"|"incorrect"|"already-guessed"|"is-drawer"|"muted"} */
  submitGuess(socketId, text) {
    const player = this.players.get(socketId);
    if (!player) return { result: "incorrect" };
    if (this.mutedPlayerIds.has(socketId)) return { result: "muted" };
    if (socketId === this.currentDrawerId) return { result: "is-drawer" };
    if (player.hasGuessedThisRound) return { result: "already-guessed" };
    if (this.phase !== PHASES.DRAWING) return { result: "incorrect" };

    if (isExactMatch(text, this.currentWord)) {
      player.hasGuessedThisRound = true;
      this.correctGuessOrder.push(socketId);
      const rank = this.correctGuessOrder.length;
      const elapsed = Date.now() - this.roundStartedAt;
      const points = computeGuesserPoints(rank, elapsed, this.settings.roundDurationMs);
      player.score += points;

      this.stats.correctGuessCount[socketId] = (this.stats.correctGuessCount[socketId] || 0) + 1;
      if (!this.stats.guessTimesMs[socketId]) this.stats.guessTimesMs[socketId] = [];
      this.stats.guessTimesMs[socketId].push(elapsed);

      return { result: "correct", rank, points };
    }
    if (this.settings.closeGuessEnabled && isCloseGuess(text, this.currentWord)) {
      return { result: "close" };
    }
    return { result: "incorrect" };
  }

  allNonDrawersGuessed() {
    const others = [...this.players.values()].filter(
      (p) => p.id !== this.currentDrawerId && p.connected
    );
    return others.length > 0 && others.every((p) => p.hasGuessedThisRound);
  }

  endRound() {
    const numCorrect = this.correctGuessOrder.length;
    const otherCount = [...this.players.values()].filter(
      (p) => p.id !== this.currentDrawerId && p.connected
    ).length;
    const drawer = this.players.get(this.currentDrawerId);
    if (drawer) {
      drawer.score += computeDrawerPoints(numCorrect, otherCount);
    }
    this.stats.drawingsGuessedCount[this.currentDrawerId] =
      (this.stats.drawingsGuessedCount[this.currentDrawerId] || 0) + numCorrect;
    this.stats.roundGuessCounts.push({
      drawerId: this.currentDrawerId,
      word: this.currentWord,
      guessedCount: numCorrect,
    });
    this.phase = PHASES.ROUND_END;
    return { word: this.currentWord, strokes: this.strokes };
  }

  addStroke(socketId, stroke) {
    if (socketId !== this.currentDrawerId) return false;
    this.strokes.push(stroke);
    return true;
  }

  finalResults() {
    const ranked = [...this.players.values()].sort((a, b) => b.score - a.score);
    return {
      scoreboard: ranked.map((p) => ({ id: p.id, username: p.username, score: p.score })),
      funStats: this.computeFunStats(),
    };
  }

  computeFunStats() {
    const usernameOf = (id) => this.players.get(id)?.username ?? "Unknown";

    let bestArtistId = null;
    let bestArtistCount = -1;
    for (const [id, count] of Object.entries(this.stats.drawingsGuessedCount)) {
      if (count > bestArtistCount) {
        bestArtistCount = count;
        bestArtistId = id;
      }
    }

    let bestGuesserId = null;
    let bestGuesserCount = -1;
    for (const [id, count] of Object.entries(this.stats.correctGuessCount)) {
      if (count > bestGuesserCount) {
        bestGuesserCount = count;
        bestGuesserId = id;
      }
    }

    let fastestGuesserId = null;
    let fastestAvgMs = Infinity;
    for (const [id, times] of Object.entries(this.stats.guessTimesMs)) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      if (avg < fastestAvgMs) {
        fastestAvgMs = avg;
        fastestGuesserId = id;
      }
    }

    let mostGuessedDrawing = null;
    for (const round of this.stats.roundGuessCounts) {
      if (!mostGuessedDrawing || round.guessedCount > mostGuessedDrawing.guessedCount) {
        mostGuessedDrawing = round;
      }
    }

    return {
      bestArtist: bestArtistId ? { id: bestArtistId, username: usernameOf(bestArtistId), count: bestArtistCount } : null,
      bestGuesser: bestGuesserId ? { id: bestGuesserId, username: usernameOf(bestGuesserId), count: bestGuesserCount } : null,
      fastestGuesser: fastestGuesserId
        ? { id: fastestGuesserId, username: usernameOf(fastestGuesserId), avgMs: Math.round(fastestAvgMs) }
        : null,
      mostGuessedDrawing: mostGuessedDrawing
        ? { word: mostGuessedDrawing.word, drawerUsername: usernameOf(mostGuessedDrawing.drawerId), guessedCount: mostGuessedDrawing.guessedCount }
        : null,
    };
  }
}

function shuffleSlice(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HAIR_STYLES = new Set(["short", "bald", "spiky", "bun", "curly"]);
const ACCESSORIES = new Set(["none", "glasses", "cap", "bow", "star"]);
const DEFAULT_AVATAR = {
  bg: "#4ecdc4",
  skin: "#ffd9b3",
  hair: "#2b2d42",
  hairStyle: "short",
  accessory: "none",
};

/** Never trust client-sent avatar config — validate every field, fall back to defaults. */
function sanitizeAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") return { ...DEFAULT_AVATAR };
  return {
    bg: HEX_RE.test(avatar.bg) ? avatar.bg : DEFAULT_AVATAR.bg,
    skin: HEX_RE.test(avatar.skin) ? avatar.skin : DEFAULT_AVATAR.skin,
    hair: HEX_RE.test(avatar.hair) ? avatar.hair : DEFAULT_AVATAR.hair,
    hairStyle: HAIR_STYLES.has(avatar.hairStyle) ? avatar.hairStyle : DEFAULT_AVATAR.hairStyle,
    accessory: ACCESSORIES.has(avatar.accessory) ? avatar.accessory : DEFAULT_AVATAR.accessory,
  };
}

module.exports = { Room, PHASES, DEFAULT_SETTINGS };
