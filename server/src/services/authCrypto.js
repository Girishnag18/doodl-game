const crypto = require("crypto");

// ---- Password hashing (scrypt, built into Node — no bcrypt dependency needed) ----

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(plain, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- Minimal signed session tokens (HMAC-SHA256, JWT-shaped but dependency-free) ----

const SECRET = process.env.SESSION_SECRET || "doodl-dev-secret-change-in-production";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function signToken(payload) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const body = base64url({ ...payload, exp: Date.now() + TOKEN_TTL_MS });
  const sig = crypto.createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
