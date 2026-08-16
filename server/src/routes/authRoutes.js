const express = require("express");
const userStore = require("../services/UserStore");
const { signToken } = require("../services/authCrypto");
const { requireAuth } = require("../middleware/auth");
const rateLimiter = require("../middleware/rateLimiter");

const router = express.Router();

function rateLimit(req, res, next) {
  const key = `http:${req.ip}:${req.path}`;
  if (!rateLimiter.allow(key, { capacity: 10, refillPerSec: 0.5 })) {
    return res.status(429).json({ error: "Too many requests, slow down" });
  }
  next();
}

router.post("/register", rateLimit, (req, res) => {
  try {
    const user = userStore.register(req.body || {});
    const token = signToken({ sub: user.id });
    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/login", rateLimit, (req, res) => {
  try {
    const user = userStore.login(req.body || {});
    const token = signToken({ sub: user.id });
    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

// Guest mode: no password, just a temporary identity for this session.
// Not persisted in UserStore — purely a signed token carrying a guest name.
router.post("/guest", rateLimit, (req, res) => {
  const username = String(req.body?.username || "Guest").slice(0, 20).trim() || "Guest";
  const token = signToken({ sub: `guest:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, guest: true, username });
  res.json({ ok: true, token, user: { username, isGuest: true } });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ---- Friends (kept simple per spec — no full social graph) ----

router.post("/friends/request", requireAuth, (req, res) => {
  try {
    userStore.sendFriendRequest(req.user.id, req.body?.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/friends/accept", requireAuth, (req, res) => {
  try {
    userStore.acceptFriendRequest(req.user.id, req.body?.fromUserId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/friends/remove", requireAuth, (req, res) => {
  userStore.removeFriend(req.user.id, req.body?.friendId);
  res.json({ ok: true });
});

router.post("/friends/block", requireAuth, (req, res) => {
  userStore.blockUser(req.user.id, req.body?.targetId);
  res.json({ ok: true });
});

router.get("/friends", requireAuth, (req, res) => {
  res.json({
    ok: true,
    friends: userStore.getFriends(req.user.id),
    pending: userStore.getPendingRequests(req.user.id),
  });
});

module.exports = router;
