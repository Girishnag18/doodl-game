// Deterministic, non-AI text utilities: normalization, matching, close-guess
// detection (Levenshtein distance), and progressive hint reveal.

function normalize(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?'"]/g, "");
}

function isExactMatch(guess, answer) {
  return normalize(guess) === normalize(answer);
}

/** Classic Levenshtein edit distance. */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Close-guess detection: within edit-distance threshold scaled to word length,
 * but never so loose that a wildly different guess counts. Deterministic, no AI.
 */
function isCloseGuess(guess, answer) {
  const g = normalize(guess);
  const a = normalize(answer);
  if (g === a) return false; // exact match handled separately
  if (Math.abs(g.length - a.length) > 2) return false;
  const distance = levenshtein(g, a);
  const threshold = a.length <= 5 ? 1 : Math.floor(a.length / 5) + 1;
  return distance > 0 && distance <= threshold;
}

/**
 * Build the hidden-slot representation, e.g. "elephant" -> "_ _ _ _ _ _ _ _"
 * `revealedIndices` is a Set of letter positions already hinted.
 */
function buildHiddenSlots(answer, revealedIndices) {
  return answer
    .split("")
    .map((ch, i) => {
      if (ch === " ") return "  ";
      return revealedIndices.has(i) ? ch.toUpperCase() : "_";
    })
    .join(" ");
}

/**
 * Decide which letter indices to reveal given elapsed time, spread evenly
 * and never revealing more than ~50% of letters.
 */
function computeHintIndices(answer, elapsedMs, roundDurationMs, hintCount) {
  const letterIndices = [...answer]
    .map((ch, i) => (ch !== " " ? i : -1))
    .filter((i) => i !== -1);
  const maxReveal = Math.floor(letterIndices.length * 0.5);
  const targetHints = Math.min(hintCount, maxReveal);
  if (targetHints <= 0) return new Set();

  const progress = Math.min(1, elapsedMs / roundDurationMs);
  const numToReveal = Math.floor(progress * targetHints);

  // Deterministic pseudo-random but stable order per answer (based on char codes)
  const ordered = [...letterIndices].sort((x, y) => {
    return (answer.charCodeAt(x) * 31 + x) % 7 - ((answer.charCodeAt(y) * 31 + y) % 7);
  });
  return new Set(ordered.slice(0, numToReveal));
}

module.exports = {
  normalize,
  isExactMatch,
  isCloseGuess,
  buildHiddenSlots,
  computeHintIndices,
  levenshtein,
};
