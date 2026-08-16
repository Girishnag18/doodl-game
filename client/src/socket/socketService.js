// Thin wrapper around the Socket.IO client. Client never invents game state —
// it only reflects what the server sends via these events.
export const socket = io(); // same-origin, server serves the client too

export function createRoom(username, settings, avatar, authToken) {
  return new Promise((resolve) => {
    socket.emit("room:create", { username, settings, avatar, authToken }, resolve);
  });
}

export function joinRoom(roomCode, username, avatar, authToken) {
  return new Promise((resolve) => {
    socket.emit("room:join", { roomCode, username, avatar, authToken }, resolve);
  });
}

export function startGame() {
  return new Promise((resolve) => {
    socket.emit("host:startGame", {}, resolve);
  });
}

export function updateSettings(settings) {
  socket.emit("host:updateSettings", { settings });
}

export function selectWord(word) {
  socket.emit("word:select", { word });
}

export function sendStroke(stroke) {
  socket.emit("draw:stroke", stroke);
}

export function sendClear() {
  socket.emit("draw:clear");
}

export function sendGuess(text) {
  socket.emit("guess:submit", { text });
}

export function sendChat(text) {
  socket.emit("chat:message", { text });
}

export function sendReaction(emoji) {
  socket.emit("reaction:send", { emoji });
}

export function rejoinRoom(roomCode, reconnectToken) {
  return new Promise((resolve) => {
    socket.emit("room:rejoin", { roomCode, reconnectToken }, resolve);
  });
}

export function hostMute(playerId) {
  socket.emit("host:mute", { playerId });
}

export function hostBan(playerId) {
  socket.emit("host:ban", { playerId });
}

export function reportPlayer(playerId, reason) {
  socket.emit("player:report", { playerId, reason });
}
