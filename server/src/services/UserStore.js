// In-memory user store. This intentionally mirrors the users/profiles/friends
// tables from docs/DESIGN.md 1:1 (same field names) so swapping this module
// for real Postgres queries later is a mechanical change, not a redesign.
// This sandbox has no DB/network access to install `pg`, so Phase 3 ships
// with this in-memory version — see docs/DESIGN.md for the schema/migration.

const crypto = require("crypto");
const { hashPassword, verifyPassword } = require("./authCrypto");

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class UserStore {
  constructor() {
    this.usersById = new Map();
    this.usersByEmail = new Map();
    this.usersByUsername = new Map();
    this.friendships = new Map(); // userId -> Set of friend userIds (mutual)
    this.blocks = new Map(); // userId -> Set of blocked userIds
    this.pendingRequests = new Map(); // userId -> Set of userIds who sent them a request
  }

  register({ username, email, password }) {
    username = String(username || "").trim();
    email = String(email || "").trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error("Username must be 3-20 letters/numbers/underscore");
    if (!EMAIL_RE.test(email)) throw new Error("Invalid email");
    if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
    if (this.usersByEmail.has(email)) throw new Error("Email already registered");
    if (this.usersByUsername.has(username.toLowerCase())) throw new Error("Username taken");

    const id = crypto.randomUUID();
    const user = {
      id,
      username,
      email,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      profile: {
        avatar: null,
        gamesPlayed: 0,
        gamesWon: 0,
        totalGuesses: 0,
        correctGuesses: 0,
      },
    };
    this.usersById.set(id, user);
    this.usersByEmail.set(email, id);
    this.usersByUsername.set(username.toLowerCase(), id);
    this.friendships.set(id, new Set());
    this.blocks.set(id, new Set());
    this.pendingRequests.set(id, new Set());
    return this.publicUser(user);
  }

  login({ email, password }) {
    email = String(email || "").trim().toLowerCase();
    const id = this.usersByEmail.get(email);
    const user = id ? this.usersById.get(id) : null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid email or password");
    }
    return this.publicUser(user);
  }

  getById(id) {
    const user = this.usersById.get(id);
    return user ? this.publicUser(user) : null;
  }

  findByUsername(username) {
    const id = this.usersByUsername.get(String(username || "").toLowerCase());
    return id ? this.publicUser(this.usersById.get(id)) : null;
  }

  publicUser(user) {
    if (!user) return null;
    const { passwordHash, ...rest } = user;
    return rest;
  }

  recordGameResult(userId, { won, guessesMade, correctGuesses }) {
    const user = this.usersById.get(userId);
    if (!user) return;
    user.profile.gamesPlayed += 1;
    if (won) user.profile.gamesWon += 1;
    user.profile.totalGuesses += guessesMade || 0;
    user.profile.correctGuesses += correctGuesses || 0;
  }

  // ---- Friends (kept intentionally simple per spec §31 — no full social graph) ----

  sendFriendRequest(fromId, toUsername) {
    const toUser = this.usersByUsername.get(String(toUsername || "").toLowerCase());
    if (!toUser) throw new Error("User not found");
    if (toUser === fromId) throw new Error("Can't friend yourself");
    if (this.blocks.get(toUser)?.has(fromId)) throw new Error("Unable to send request");
    this.pendingRequests.get(toUser)?.add(fromId);
    return true;
  }

  acceptFriendRequest(userId, fromId) {
    const pending = this.pendingRequests.get(userId);
    if (!pending?.has(fromId)) throw new Error("No pending request from that user");
    pending.delete(fromId);
    this.friendships.get(userId)?.add(fromId);
    this.friendships.get(fromId)?.add(userId);
    return true;
  }

  removeFriend(userId, friendId) {
    this.friendships.get(userId)?.delete(friendId);
    this.friendships.get(friendId)?.delete(userId);
  }

  blockUser(userId, targetId) {
    this.blocks.get(userId)?.add(targetId);
    this.removeFriend(userId, targetId);
  }

  getFriends(userId) {
    const ids = [...(this.friendships.get(userId) || [])];
    return ids.map((id) => this.publicUser(this.usersById.get(id))).filter(Boolean);
  }

  getPendingRequests(userId) {
    const ids = [...(this.pendingRequests.get(userId) || [])];
    return ids.map((id) => this.publicUser(this.usersById.get(id))).filter(Boolean);
  }
}

module.exports = new UserStore();
