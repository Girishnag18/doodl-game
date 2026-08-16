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
  try {
    const user = await auth.register(
      $("#register-username").value.trim(),
      $("#register-email").value.trim(),
      $("#register-password").value
    );
    $("#auth-status").textContent = `Signed up as ${user.username} ✅`;
    $("#home-username").value = user.username;
  } catch (err) {
    $("#auth-status").textContent = err.message;
  }
});

$("#btn-login").addEventListener("click", async () => {
  try {
    const user = await auth.login($("#login-email").value.trim(), $("#login-password").value);
    $("#auth-status").textContent = `Logged in as ${user.username} ✅`;
    $("#home-username").value = user.username;
  } catch (err) {
    $("#auth-status").textContent = err.message;
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
  } catch (err) {
    alert(err.message);
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
  const username = $("#home-username").value.trim() || "Player";
  const res = await createRoom(username, {}, myAvatar, auth.getAuthToken());
  if (!res.ok) return showHomeError(res.error);
  saveReconnectInfo(res.room.code, res.reconnectToken);
  enterLobby(res.room);
});

$("#btn-join-room").addEventListener("click", async () => {
  const username = $("#home-username").value.trim() || "Player";
  const code = $("#home-roomcode").value.trim().toUpperCase();
  if (!code) return showHomeError("Enter a room code");
  const res = await joinRoom(code, username, myAvatar, auth.getAuthToken());
  if (!res.ok) return showHomeError(res.error);
  iAmSpectator = !!res.asSpectator;
  if (res.reconnectToken) saveReconnectInfo(res.room.code, res.reconnectToken);
  enterLobby(res.room);
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
$("#btn-copy-code").addEventListener("click", () => {
  navigator.clipboard?.writeText(currentRoom.code);
});
$("#btn-copy-link").addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?join=${currentRoom.code}`;
  navigator.clipboard?.writeText(url);
});

["set-rounds", "set-duration", "set-difficulty", "set-hints", "set-closeguess", "set-spectators", "set-voice"].forEach((id) => {
  $(`#${id}`).addEventListener("change", pushSettings);
});
function pushSettings() {
  updateSettings({
    totalRounds: Number($("#set-rounds").value),
    roundDurationMs: Number($("#set-duration").value) * 1000,
    difficulty: $("#set-difficulty").value,
    hintsEnabled: $("#set-hints").checked,
    closeGuessEnabled: $("#set-closeguess").checked,
    allowSpectators: $("#set-spectators").checked,
    voiceChatEnabled: $("#set-voice").checked,
  });
}

$("#btn-start-game").addEventListener("click", () => startGame());

function renderLobby(room) {
  $("#lobby-code").textContent = room.code;
  const list = $("#lobby-player-list");
  list.innerHTML = "";
  for (const p of room.players) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="player-row"><span class="player-avatar">${avatarToSvg(p.avatar, 26)}</span>${escapeHtml(p.username)}${p.id === room.hostId ? " 👑" : ""}</span>`;
    list.appendChild(li);
  }
  const isHost = room.hostId === myId;
  $("#btn-start-game").style.display = isHost ? "block" : "none";
  document.querySelectorAll(".lobby-settings input, .lobby-settings select")
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
    li.innerHTML = `<span class="player-row"><span class="player-avatar">${avatarToSvg(p.avatar, 22)}</span>${escapeHtml(p.username)}: ${p.score}</span>`;
    if (p.isDrawer) li.innerHTML += ' <span class="badge-drawer">🎨</span>';
    if (p.hasGuessedThisRound) li.innerHTML += ' <span class="badge-correct">✓</span>';
    if (p.isMuted) li.innerHTML += ' 🔇';
    if (!p.connected) li.innerHTML += ' <span class="hint-text">(reconnecting…)</span>';
    if (p.id !== myId) {
      if (isHost) {
        li.innerHTML += ` <button class="btn-mini" data-mute="${p.id}">${p.isMuted ? "Unmute" : "Mute"}</button>
          <button class="btn-mini" data-ban="${p.id}">Ban</button>`;
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
      if (confirm("Ban this player from the room?")) hostBan(btn.dataset.ban);
    })
  );
  document.querySelectorAll("[data-report]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const reason = prompt("Report this player — what happened?");
      if (reason) reportPlayer(btn.dataset.report, reason);
    })
  );
}

function isMeDrawer(room) {
  return room.currentDrawerId === myId;
}

let timerInterval = null;
function startCountdownTimer(durationMs) {
  clearInterval(timerInterval);
  const endsAt = Date.now() + durationMs;
  let warned = false;
  const tick = () => {
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    $("#game-timer").textContent = remaining;
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
  $("#word-choice-overlay").classList.add("hidden");
  $("#round-end-overlay").classList.add("hidden");
  if (canvas) canvas.clear();

  const drawerName = currentRoom?.players.find((p) => p.id === drawerId)?.username || "someone";
  const banner = $("#transition-banner");
  banner.querySelector(".transition-round").textContent = `Round ${roundNumber}`;
  banner.querySelector(".transition-drawer").textContent =
    drawerId === myId ? "🎨 Your turn to draw!" : `🎨 ${drawerName}'s turn to draw`;
  banner.classList.remove("hidden");
  sounds.roundStart();
  setTimeout(() => banner.classList.add("hidden"), 1400);
});

socket.on("word:choices", (words) => {
  const box = $("#word-choice-buttons");
  box.innerHTML = "";
  words.forEach((w) => {
    const btn = document.createElement("button");
    btn.textContent = w.toUpperCase();
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
  scoreboard.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${medals[i] || `#${i + 1}`} ${escapeHtml(p.username)}</span><span>${p.score}</span>`;
    list.appendChild(li);
  });

  const statsEl = $("#fun-stats");
  statsEl.innerHTML = "";
  const rows = [];
  if (funStats?.bestArtist) rows.push(`🎨 Best Artist: <b>${escapeHtml(funStats.bestArtist.username)}</b>`);
  if (funStats?.bestGuesser) rows.push(`🧠 Best Guesser: <b>${escapeHtml(funStats.bestGuesser.username)}</b>`);
  if (funStats?.fastestGuesser) rows.push(`⚡ Fastest Guesser: <b>${escapeHtml(funStats.fastestGuesser.username)}</b>`);
  if (funStats?.mostGuessedDrawing) rows.push(`😂 Most Guessed: <b>${escapeHtml(funStats.mostGuessedDrawing.word.toUpperCase())}</b> by ${escapeHtml(funStats.mostGuessedDrawing.drawerUsername)}`);
  statsEl.innerHTML = rows.map((r) => `<div class="stat-row">${r}</div>`).join("");

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
