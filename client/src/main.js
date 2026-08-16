import { socket, createRoom, joinRoom, startGame, updateSettings, selectWord,
  sendStroke, sendClear, sendGuess, sendChat, sendReaction,
  rejoinRoom, hostMute, hostBan, reportPlayer } from "./socket/socketService.js";
import { DrawingCanvas } from "./canvas/DrawingCanvas.js";
import { randomAvatar, avatarToSvg } from "./ui/Avatar.js";
import { sounds, setSoundEnabled } from "./audio/sounds.js";
import * as auth from "./services/authService.js";
import { VoiceChat } from "./webrtc/VoiceChat.js";

const $ = (sel) => document.querySelector(sel);
const screens = {
  home: $("#screen-home"),
  lobby: $("#screen-lobby"),
  game: $("#screen-game"),
  results: $("#screen-results"),
};
function showScreen(name) {
  for (const s of Object.values(screens)) s.classList.remove("active");
  screens[name].classList.add("active");
}

let myId = null;
let currentRoom = null; // last known public room state
let canvas = null;
let myAvatar = randomAvatar();
let iAmSpectator = false;
let voiceChat = null;
let voiceActive = false;
let myReconnectToken = null;
let lastReplayStrokes = [];

function showToast(message, type = "info") {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function setButtonLoading(button, isLoading, label) {
  if (!button) return;
  button.disabled = isLoading;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
}

function showModal({ title, message, confirmText = "Confirm", isPrompt = false, onConfirm }) {
  const root = $("#modal-root");
  const titleEl = $("#modal-title");
  const messageEl = $("#modal-message");
  const inputWrap = $("#modal-input-wrap");
  const input = $("#modal-input");
  const cancelBtn = $("#modal-cancel");
  const confirmBtn = $("#modal-confirm");

  titleEl.textContent = title;
  messageEl.textContent = message;
  inputWrap.classList.toggle("hidden", !isPrompt);
  input.value = "";
  confirmBtn.textContent = confirmText;
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");

  const cleanup = () => {
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    cancelBtn.onclick = null;
    confirmBtn.onclick = null;
  };

  cancelBtn.onclick = () => {
    cleanup();
  };
  confirmBtn.onclick = () => {
    const value = isPrompt ? input.value.trim() : "";
    cleanup();
    if (onConfirm) onConfirm(value);
  };

  if (isPrompt) {
    setTimeout(() => input.focus(), 40);
  }
}

// ---------- RECONNECTION ----------
// Uses localStorage (this is a real standalone web app, not a Claude.ai
// artifact) so a page refresh or brief network drop can resume the same
// seat instead of losing your spot in the game (spec §19, §37).
function saveReconnectInfo(roomCode, token) {
  if (!token) return;
  myReconnectToken = token;
  try {
    localStorage.setItem("doodl:reconnect", JSON.stringify({ roomCode, token }));
  } catch { /* storage unavailable (private browsing etc.) — reconnection just won't persist */ }
}
function clearReconnectInfo() {
  myReconnectToken = null;
  try { localStorage.removeItem("doodl:reconnect"); } catch { /* ignore */ }
}
async function tryAutoRejoin() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem("doodl:reconnect") || "null");
  } catch { return; }
  if (!saved) return;
  const res = await rejoinRoom(saved.roomCode, saved.token);
  if (res.ok) {
    iAmSpectator = false;
    myReconnectToken = saved.token;
    enterLobby(res.room);
    addChatLine("Reconnected to your game.", "msg-system");
  } else {
    clearReconnectInfo();
  }
}
socket.on("connect", () => { tryAutoRejoin(); });

// Auto-fill room code if arriving via an invite link (?join=CODE)
const inviteCode = new URLSearchParams(location.search).get("join");
if (inviteCode) $("#home-roomcode").value = inviteCode.toUpperCase();

// ---------- HOME: avatar + sound preferences ----------
function renderAvatarPreview() {
  $("#avatar-preview").innerHTML = avatarToSvg(myAvatar, 56);
}
renderAvatarPreview();
$("#btn-shuffle-avatar").addEventListener("click", () => {
  myAvatar = randomAvatar();
  renderAvatarPreview();
});
$("#home-sound").addEventListener("change", (e) => setSoundEnabled(e.target.checked));

// ---------- AUTH TABS ----------
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".auth-panel").forEach((p) => p.classList.add("hidden"));
    $(`#auth-panel-${tab.dataset.tab}`).classList.remove("hidden");
  });
});

$("#btn-register").addEventListener("click", async () => {
const button = $("#btn-register");
setButtonLoading(button, true, "Signing up...");
try {
  const user = await auth.register(
    $("#register-username").value.trim(),
    $("#register-email").value.trim(),
    $("#register-password").value
  );
  $("#auth-status").textContent = `Signed up as ${user.username} ✅`;
  $("#home-username").value = user.username;
  showToast("Account created", "success");
} catch (err) {
  $("#auth-status").textContent = err.message;
  showToast(err.message, "error");
} finally {
  setButtonLoading(button, false);
}
});

$("#btn-login").addEventListener("click", async () => {
const button = $("#btn-login");
setButtonLoading(button, true, "Logging in...");
try {
  const user = await auth.login($("#login-email").value.trim(), $("#login-password").value);
  $("#auth-status").textContent = `Logged in as ${user.username} ✅`;
  $("#home-username").value = user.username;
  showToast("Logged in successfully", "success");
} catch (err) {
  $("#auth-status").textContent = err.message;
  showToast(err.message, "error");
} finally {
  setButtonLoading(button, false);
}
});

// ---------- FRIENDS ----------
$("#btn-toggle-friends").addEventListener("click", async () => {
  const panel = $("#friends-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) await refreshFriends();
});

$("#btn-add-friend").addEventListener("click", async () => {
  const username = $("#friend-username-input").value.trim();
  if (!username) return;
  try {
    await auth.sendFriendRequest(username);
    $("#friend-username-input").value = "";
    await refreshFriends();
    showToast(`Friend request sent to ${username}`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

async function refreshFriends() {
  if (auth.isGuest()) {
    $("#friends-pending").innerHTML = "";
    $("#friends-list").innerHTML = `<p class="hint-text">Log in or sign up to add friends.</p>`;
    return;
  }
  try {
    const { friends, pending } = await auth.getFriends();
    $("#friends-pending").innerHTML = pending.length
      ? `<b>Requests</b>` + pending.map((p) => `
        <div class="friend-row">${escapeHtml(p.username)}
          <button class="btn-mini" data-accept="${p.id}">Accept</button>
        </div>`).join("")
      : "";
    $("#friends-list").innerHTML = `<b>Friends</b>` + (friends.length
      ? friends.map((f) => `<div class="friend-row">${escapeHtml(f.username)}</div>`).join("")
      : `<p class="hint-text">No friends yet.</p>`);
    document.querySelectorAll("[data-accept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await auth.acceptFriendRequest(btn.dataset.accept);
        refreshFriends();
      });
    });
  } catch (err) {
    $("#friends-list").innerHTML = `<p class="hint-text">${escapeHtml(err.message)}</p>`;
  }
}

// ---------- HOME ----------
$("#btn-create-room").addEventListener("click", async () => {
  const button = $("#btn-create-room");
  setButtonLoading(button, true, "Creating...");
  const username = $("#home-username").value.trim() || "Player";
  try {
    const res = await createRoom(username, {}, myAvatar, auth.getAuthToken());
    if (!res.ok) return showHomeError(res.error);
    saveReconnectInfo(res.room.code, res.reconnectToken);
    showToast(`Room ${res.room.code} created`, "success");
    enterLobby(res.room);
  } catch (err) {
    showToast(err.message || "Could not create room", "error");
  } finally {
    setButtonLoading(button, false);
  }
});

$("#btn-join-room").addEventListener("click", async () => {
  const button = $("#btn-join-room");
  setButtonLoading(button, true, "Joining...");
  const username = $("#home-username").value.trim() || "Player";
  const code = $("#home-roomcode").value.trim().toUpperCase();
  if (!code) {
    showHomeError("Enter a room code");
    setButtonLoading(button, false);
    return;
  }
  try {
    const res = await joinRoom(code, username, myAvatar, auth.getAuthToken());
    if (!res.ok) return showHomeError(res.error);
    iAmSpectator = !!res.asSpectator;
    if (res.reconnectToken) saveReconnectInfo(res.room.code, res.reconnectToken);
    showToast(`Joined room ${code}`, "success");
    enterLobby(res.room);
  } catch (err) {
    showToast(err.message || "Could not join room", "error");
  } finally {
    setButtonLoading(button, false);
  }
});

function showHomeError(msg) { $("#home-error").textContent = msg; }

function enterLobby(room) {
  myId = socket.id;
  currentRoom = room;
  if (iAmSpectator || room.phase !== "LOBBY") {
    showScreen("game");
    setupCanvas();
    canvas.setEnabled(false);
    renderGameHeader(room);
    $("#spectator-banner").classList.toggle("hidden", !iAmSpectator);
  } else {
    showScreen("lobby");
    renderLobby(room);
  }
}

// ---------- LOBBY ----------
$("#btn-copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard?.writeText(currentRoom.code);
    showToast("Room code copied", "success");
  } catch {
    showToast("Copy failed", "error");
  }
});
$("#btn-copy-link").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?join=${currentRoom.code}`;
  try {
    await navigator.clipboard?.writeText(url);
    showToast("Invite link copied", "success");
  } catch {
    showToast("Copy failed", "error");
  }
});

["set-rounds", "set-duration", "set-max-players", "set-word-mode", "set-word-choice-count", "set-difficulty", "set-hints", "set-closeguess", "set-spectators", "set-voice"].forEach((id) => {
  $(`#${id}`).addEventListener("change", pushSettings);
});
$("#custom-words-input").addEventListener("input", pushSettings);

$("#btn-import-custom-words").addEventListener("click", () => {
  pushSettings();
});
$("#btn-clear-custom-words").addEventListener("click", () => {
  $("#custom-words-input").value = "";
  pushSettings();
});

function parseCustomWords(rawText) {
  const seen = new Set();
  const values = [];
  const rawItems = String(rawText || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const item of rawItems) {
    const cleaned = item.replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
    if (!cleaned || cleaned.length < 2 || cleaned.length > 40) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(cleaned);
    if (values.length >= 1000) break;
  }

  return values;
}

function updateCustomWordStatus(rawText) {
  const words = parseCustomWords(rawText);
  const mode = $("#set-word-mode").value;
  const required = Number($("#set-word-choice-count").value || 5);
  const duplicates = String(rawText || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 2 && item.length <= 40)
    .reduce((set, item) => {
      const key = item.toLowerCase();
      if (set.has(key)) return set;
      set.add(key);
      return set;
    }, new Set());
  const duplicateCount = Math.max(0, String(rawText || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).length - duplicates.size);
  const status = $("#custom-word-status");
  if (mode === "custom" && words.length < required) {
    status.textContent = `Need at least ${required} custom words for ${required} choices.`;
    status.classList.add("warning");
    status.classList.remove("success");
  } else if (mode === "mixed" && words.length + 40 < required) {
    status.textContent = `Mixed mode needs at least ${required} total available words.`;
    status.classList.add("warning");
    status.classList.remove("success");
  } else if (duplicateCount > 0) {
    status.textContent = `${duplicateCount} duplicate${duplicateCount > 1 ? "s" : ""} removed.`;
    status.classList.add("success");
    status.classList.remove("warning");
  } else {
    status.textContent = `${words.length} words ready`; 
    status.classList.add("success");
    status.classList.remove("warning");
  }
  $("#custom-words-meta").textContent = `${words.length} words`;
  return words;
}

function pushSettings() {
  const customWords = updateCustomWordStatus($("#custom-words-input").value);

  updateSettings({
    totalRounds: Number($("#set-rounds").value),
    roundDurationMs: Number($("#set-duration").value) * 1000,
    maxPlayers: Number($("#set-max-players").value),
    wordMode: $("#set-word-mode").value,
    wordChoiceCount: Number($("#set-word-choice-count").value),
    difficulty: $("#set-difficulty").value,
    customWords,
    hintsEnabled: $("#set-hints").checked,
    closeGuessEnabled: $("#set-closeguess").checked,
    allowSpectators: $("#set-spectators").checked,
    voiceChatEnabled: $("#set-voice").checked,
  });
}

$("#btn-start-game").addEventListener("click", async () => {
  const btn = $("#btn-start-game");
  setButtonLoading(btn, true, "Starting...");
  try {
    // Ensure latest settings (including custom words) are pushed to the server
    pushSettings();
    const res = await startGame();
    if (!res || !res.ok) {
      const msg = res?.error || "Failed to start game";
      showToast(msg, "error");
    }
  } catch (err) {
    showToast(err?.message || "Failed to start game", "error");
  } finally {
    setButtonLoading(btn, false);
  }
});

function renderLobby(room) {
  $("#lobby-code").textContent = room.code;
  $("#lobby-player-count").textContent = `${room.players.length} / ${room.settings.maxPlayers || 8}`;
  const list = $("#lobby-player-list");
  list.innerHTML = "";
  for (const p of room.players) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="player-row"><span class="player-avatar">${avatarToSvg(p.avatar, 26)}</span>${escapeHtml(p.username)}${p.id === room.hostId ? " 👑" : ""}</span><span class="status-pill">${p.connected ? "online" : "reconnecting"}</span>`;
    list.appendChild(li);
  }
  const isHost = room.hostId === myId;
  $("#btn-start-game").style.display = isHost ? "block" : "none";
  $("#set-max-players").value = String(room.settings.maxPlayers || 8);
  $("#set-word-mode").value = room.settings.wordMode || "official";
  $("#set-word-choice-count").value = String(room.settings.wordChoiceCount || 5);
  $("#set-rounds").value = String(room.settings.totalRounds || 3);
  $("#set-duration").value = String(Math.round((room.settings.roundDurationMs || 80000) / 1000));
  $("#set-difficulty").value = room.settings.difficulty || "mixed";
  $("#set-hints").checked = !!room.settings.hintsEnabled;
  $("#set-closeguess").checked = !!room.settings.closeGuessEnabled;
  $("#set-spectators").checked = !!room.settings.allowSpectators;
  $("#set-voice").checked = !!room.settings.voiceChatEnabled;
  $("#custom-words-input").value = (room.settings.customWords || []).join("\n");
  updateCustomWordStatus($("#custom-words-input").value);
  document.querySelectorAll(".lobby-settings input, .lobby-settings select, .lobby-settings textarea, .custom-word-actions button")
    .forEach((el) => (el.disabled = !isHost));
}

// ---------- GAME ----------
function setupCanvas() {
  if (canvas) return;
  canvas = new DrawingCanvas($("#draw-canvas"), {
    onLocalStroke: (stroke) => sendStroke(stroke),
  });
  document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      canvas.setTool(btn.dataset.tool);
    });
  });
  $("#color-picker").addEventListener("input", (e) => canvas.setColor(e.target.value));
  $("#brush-size").addEventListener("input", (e) => canvas.setSize(e.target.value));
  $("#btn-undo").addEventListener("click", () => canvas.undo());
  $("#btn-redo").addEventListener("click", () => canvas.redo());
  $("#btn-clear").addEventListener("click", () => { canvas.clear(); sendClear(); });
}

function renderGameHeader(room) {
  $("#game-round").textContent = `Round ${room.roundNumber}/${room.totalRounds}`;
  const list = $("#game-player-list");
  list.innerHTML = "";
  const isHost = room.hostId === myId;
  for (const p of room.players) {
    const li = document.createElement("li");
  li.className = `player-card ${p.isDrawer ? "drawer" : ""} ${p.hasGuessedThisRound ? "guessed" : ""}`;
  const status = [];
  if (p.isDrawer) status.push("DRAWING");
  if (p.hasGuessedThisRound) status.push("GUESSED");
  if (p.isMuted) status.push("MUTED");
  if (!p.connected) status.push("RECONNECTING");
  li.innerHTML = `
    <div class="player-row">
      <span class="player-avatar">${avatarToSvg(p.avatar, 22)}</span>
      <div class="player-meta">
        <span class="player-name">${escapeHtml(p.username)}</span>
        <small>${status.join(" • ") || "READY"}</small>
      </div>
    </div>
    <div class="player-score-box">
      <span class="score-value">${p.score}</span>
      ${p.id === room.hostId ? '<span class="host-badge">HOST</span>' : ""}
    </div>
  `;
  if (p.id !== myId) {
    if (isHost) {
      li.innerHTML += ` <div class="player-actions"><button class="btn-mini" data-mute="${p.id}">${p.isMuted ? "Unmute" : "Mute"}</button><button class="btn-mini" data-ban="${p.id}">Ban</button></div>`;
    } else {
      li.innerHTML += ` <button class="btn-mini" data-report="${p.id}">⚑</button>`;
    }
  }
  list.appendChild(li);
  }
  document.querySelectorAll("[data-mute]").forEach((btn) =>
  btn.addEventListener("click", () => hostMute(btn.dataset.mute))
  );
  document.querySelectorAll("[data-ban]").forEach((btn) =>
  btn.addEventListener("click", () => {
    showModal({
      title: "Ban player",
      message: "This player will be removed from the room and blocked from rejoining.",
      confirmText: "Ban",
      onConfirm: () => hostBan(btn.dataset.ban),
    });
  })
  );
  document.querySelectorAll("[data-report]").forEach((btn) =>
  btn.addEventListener("click", () => {
    showModal({
      title: "Report player",
      message: "Tell the host what happened.",
      isPrompt: true,
      confirmText: "Send report",
      onConfirm: (reason) => {
        if (reason) reportPlayer(btn.dataset.report, reason);
        else showToast("Report cancelled", "warning");
      },
    });
  })
  );
}

function isMeDrawer(room) {
  return room.currentDrawerId === myId;
}

let timerInterval = null;
function startCountdownTimer(durationMs) {
  clearInterval(timerInterval);
  const timerEl = $("#game-timer");
  const endsAt = Date.now() + durationMs;
  let warned = false;
  const tick = () => {
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    timerEl.textContent = `${remaining}`;
    timerEl.classList.remove("warning", "critical", "pulse");
    if (remaining <= 5) {
      timerEl.classList.add("critical", "pulse");
    } else if (remaining <= 10) {
      timerEl.classList.add("warning");
    }
    if (remaining <= 10 && !warned) {
      warned = true;
      sounds.timerWarning();
    }
    if (remaining <= 0) clearInterval(timerInterval);
  };
  tick();
  timerInterval = setInterval(tick, 500);
}

function addChatLine(html, cls) {
  const log = $("#chat-log");
  const div = document.createElement("div");
  div.className = cls || "";
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---------- SOCKET EVENT WIRING ----------
socket.on("room:state", (room) => {
  currentRoom = room;
  myId = socket.id;
  if (iAmSpectator && room.players.some((p) => p.id === myId)) {
    iAmSpectator = false; // promoted to a real player at the start of the next round
  }
  $("#spectator-banner").classList.toggle("hidden", !iAmSpectator);
  if (screens.lobby.classList.contains("active")) renderLobby(room);
  if (screens.game.classList.contains("active") || room.phase !== "LOBBY") {
    if (room.phase !== "LOBBY" && room.phase !== "RESULTS") {
      showScreen("game");
      setupCanvas();
      canvas.setEnabled(!iAmSpectator && isMeDrawer(room));
      renderGameHeader(room);
    }
  }
});

socket.on("chat:system", ({ text }) => addChatLine(text, "msg-system"));

socket.on("round:starting", ({ roundNumber, drawerId }) => {
  // Keep word-choice overlay alone — the server sends word:choices to the drawer
  // and that handler will show the overlay when appropriate. Only hide the
  // round-end overlay and clear the canvas for a fresh round.
  $("#round-end-overlay").classList.add("hidden");
  if (canvas) canvas.clear();

  const drawerName = currentRoom?.players.find((p) => p.id === drawerId)?.username || "someone";
  const banner = $("#transition-banner");
  banner.querySelector(".transition-round").textContent = `Round ${roundNumber}`;
  banner.querySelector(".transition-subtitle").textContent = "Get ready";
  banner.querySelector(".transition-drawer").textContent =
    drawerId === myId ? "YOUR TURN" : `${drawerName.toUpperCase()} IS DRAWING`;
  banner.classList.remove("hidden");
  sounds.roundStart();
  setTimeout(() => banner.classList.add("hidden"), 1400);
});

socket.on("word:choices", (words) => {
  const box = $("#word-choice-buttons");
  box.innerHTML = "";
  words.forEach((w) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "word-choice-btn";
    btn.textContent = w.toUpperCase();
    btn.setAttribute("aria-label", `Choose word ${w}`);
    btn.addEventListener("click", () => {
      selectWord(w);
      $("#word-choice-overlay").classList.add("hidden");
    });
    box.appendChild(btn);
  });
  $("#word-choice-overlay").classList.remove("hidden");
});

socket.on("word:selected", ({ word }) => {
  $("#game-word-slots").textContent = word.toUpperCase();
});

socket.on("word:hiddenSlots", ({ slots }) => {
  $("#game-word-slots").textContent = slots;
});

socket.on("round:started", ({ durationMs }) => {
  $("#word-choice-overlay").classList.add("hidden");
  startCountdownTimer(durationMs);
});

socket.on("draw:stroke", (stroke) => canvas?.applyRemoteStroke(stroke));
socket.on("draw:clear", () => canvas?.clear());

socket.on("guess:correct", ({ username, rank }) => {
  addChatLine(`🎉 <b>${escapeHtml(username)}</b> guessed the word! (#${rank})`, "msg-correct");
  sounds.correctGuess();
});
socket.on("guess:youGotIt", ({ points }) => {
  addChatLine(`✅ You got it! +${points} points`, "msg-correct");
});
socket.on("guess:close", () => {
  addChatLine("🔥 You're very close!", "msg-system");
  sounds.closeGuess();
});

socket.on("chat:message", ({ username, text, isGuess }) => {
  addChatLine(`<b>${escapeHtml(username)}:</b> ${escapeHtml(text)}`, isGuess ? "" : "");
});

socket.on("reaction:show", ({ emoji }) => {
  const layer = $("#reactions-layer");
  const el = document.createElement("div");
  el.className = "floating-reaction";
  el.textContent = emoji;
  el.style.left = `${20 + Math.random() * 60}%`;
  el.style.bottom = "10%";
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
  sounds.reaction();
});

socket.on("round:ended", ({ word, replayStrokes }) => {
  clearInterval(timerInterval);
  $("#round-end-word").textContent = `${word.toUpperCase()}`;
  $("#round-end-overlay").classList.remove("hidden");
  lastReplayStrokes = replayStrokes || [];
  sounds.roundEnd();
});

$("#btn-replay").addEventListener("click", () => {
  if (!canvas || lastReplayStrokes.length === 0) return;
  canvas.clear();
  let i = 0;
  const step = () => {
    if (i >= lastReplayStrokes.length) return;
    canvas.applyRemoteStroke(lastReplayStrokes[i]);
    i++;
    setTimeout(step, 180);
  };
  step();
});

socket.on("you:muted", ({ muted }) => {
  addChatLine(muted ? "🔇 The host has muted you." : "🔊 You've been unmuted.", "msg-system");
});
socket.on("you:banned", () => {
  addChatLine("🚫 You've been banned from this room.", "msg-system");
  clearReconnectInfo();
  setTimeout(() => location.reload(), 1500);
});

socket.on("game:ended", ({ scoreboard, funStats }) => {
  showScreen("results");
  clearReconnectInfo();
  const list = $("#results-list");
  list.innerHTML = "";
  const medals = ["🥇", "🥈", "🥉"];
  const winner = scoreboard[0];
  const winnerBadge = $("#winner-badge");
  winnerBadge.textContent = winner ? `${winner.username} wins` : "Winner";
  winnerBadge.classList.toggle("hidden", !winner);

  scoreboard.forEach((p, i) => {
    const li = document.createElement("li");
    const isWinner = i === 0;
    li.className = isWinner ? "winner" : "";
    li.innerHTML = `
      <span class="result-rank">
        <span class="rank-badge">${medals[i] || `#${i + 1}`}</span>
        ${escapeHtml(p.username)}
      </span>
      <span class="result-score">${p.score}</span>
    `;
    list.appendChild(li);
  });

  const statsEl = $("#fun-stats");
  statsEl.innerHTML = "";
  const rows = [];
  if (funStats?.bestArtist) rows.push(`Best Artist: <b>${escapeHtml(funStats.bestArtist.username)}</b>`);
  if (funStats?.bestGuesser) rows.push(`Best Guesser: <b>${escapeHtml(funStats.bestGuesser.username)}</b>`);
  if (funStats?.fastestGuesser) rows.push(`Fastest Guesser: <b>${escapeHtml(funStats.fastestGuesser.username)}</b>`);
  if (funStats?.mostGuessedDrawing) rows.push(`Most Guessed: <b>${escapeHtml(funStats.mostGuessedDrawing.word.toUpperCase())}</b> by ${escapeHtml(funStats.mostGuessedDrawing.drawerUsername)}`);
  statsEl.innerHTML = rows.map((r) => `<div class="stat-row">${r}</div>`).join("") || '<div class="stat-row">No extra stats this round.</div>';

  sounds.victory();
});

$("#btn-play-again").addEventListener("click", () => { showScreen("lobby"); renderLobby(currentRoom); });
$("#btn-return-lobby").addEventListener("click", () => { showScreen("lobby"); renderLobby(currentRoom); });

// ---------- CHAT / GUESS FORM ----------
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  if (iAmSpectator) {
    sendChat(text); // spectators can chat, but never submit as a scored guess
  } else if (currentRoom && currentRoom.phase === "DRAWING" && !isMeDrawer(currentRoom)) {
    sendGuess(text);
  } else {
    sendChat(text);
  }
  input.value = "";
});

document.querySelectorAll("#reaction-bar button").forEach((btn) => {
  btn.addEventListener("click", () => sendReaction(btn.dataset.emoji));
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- VOICE CHAT (optional, WebRTC mesh, off by default until toggled) ----------
voiceChat = new VoiceChat(socket, {
  onPeerCountChange: (count) => {
    $("#btn-voice-toggle").title = `Voice chat — ${count} peer(s) connected`;
  },
});

$("#btn-voice-toggle").addEventListener("click", async () => {
  const btn = $("#btn-voice-toggle");
  if (!voiceActive) {
    try {
      await voiceChat.start();
      voiceActive = true;
      btn.textContent = "🎤 On";
      btn.classList.add("active");
    } catch (err) {
      addChatLine("Couldn't access your microphone — voice chat needs mic permission.", "msg-system");
    }
  } else {
    voiceChat.stop();
    voiceActive = false;
    btn.textContent = "🎤 Off";
    btn.classList.remove("active");
  }
});
