const { customAlphabet } = require("nanoid");
const { Room } = require("./Room");

const genCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
    this.socketToRoom = new Map(); // socketId -> roomCode
  }

  createRoom(hostSocketId, hostUsername, hostAvatar) {
    let code;
    do {
      code = genCode();
    } while (this.rooms.has(code));
    const room = new Room(code, hostSocketId, hostUsername, hostAvatar);
    this.rooms.set(code, room);
    this.socketToRoom.set(hostSocketId, code);
    return room;
  }

  joinRoom(code, socketId, username, avatar, { asSpectatorIfInProgress = false } = {}) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found");

    const gameInProgress = room.phase !== "LOBBY" && room.phase !== "GAME_END" && room.phase !== "RESULTS";
    if (gameInProgress && asSpectatorIfInProgress && room.settings.allowSpectators) {
      room.addSpectator(socketId, username, avatar);
      this.socketToRoom.set(socketId, code);
      return room;
    }
    if (room.playerCount >= room.settings.maxPlayers) throw new Error("Room full");
    room.addPlayer(socketId, username, avatar);
    this.socketToRoom.set(socketId, code);
    return room;
  }

  getRoomForSocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : null;
  }

  leaveRoom(socketId) {
    const room = this.getRoomForSocket(socketId);
    if (!room) return null;
    room.removePlayer(socketId);
    this.socketToRoom.delete(socketId);
    if (room.playerCount === 0) {
      this.rooms.delete(room.code);
      return null;
    }
    if (room.hostSocketId === socketId) {
      const next = [...room.players.keys()][0];
      room.hostSocketId = next;
    }
    return room;
  }
}

module.exports = new RoomManager();
