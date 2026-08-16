const { verifyToken } = require("../services/authCrypto");
const userStore = require("../services/UserStore");

function getTokenFromRequest(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/** Attaches req.user if a valid token is present, but doesn't reject guests. */
function optionalAuth(req, _res, next) {
  const payload = verifyToken(getTokenFromRequest(req));
  req.user = payload ? userStore.getById(payload.sub) : null;
  next();
}

/** Requires a valid token; rejects otherwise. */
function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    next();
  });
}

module.exports = { requireAuth, optionalAuth, getTokenFromRequest };
