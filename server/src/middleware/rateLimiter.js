/** Minimal in-memory token-bucket per socket per event key. */
class RateLimiter {
  constructor() {
    this.buckets = new Map(); // key -> { tokens, lastRefill }
  }

  allow(key, { capacity = 5, refillPerSec = 2 } = {}) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
    bucket.lastRefill = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  clear(prefix) {
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) this.buckets.delete(key);
    }
  }
}

module.exports = new RateLimiter();
