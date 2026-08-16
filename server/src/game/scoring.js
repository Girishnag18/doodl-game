// All scoring numbers live here — never hardcoded elsewhere in the codebase.
const SCORING_CONFIG = {
  basePoints: 100,
  rankDecay: 0.15, // each subsequent correct guesser gets ~15% less
  minGuesserPoints: 20,
  drawerPointsPerGuesser: 40,
};

/**
 * @param {number} rank 1-indexed order in which this player guessed correctly
 * @param {number} elapsedMs time since round started when they guessed
 * @param {number} roundDurationMs total round length
 */
function computeGuesserPoints(rank, elapsedMs, roundDurationMs) {
  const decayFactor = Math.pow(1 - SCORING_CONFIG.rankDecay, rank - 1);
  const timeFraction = Math.min(1, Math.max(0, elapsedMs / roundDurationMs));
  const timeFactor = 1 - timeFraction * 0.4; // 1.0 (instant) -> 0.6 (last second)
  const raw = SCORING_CONFIG.basePoints * decayFactor * timeFactor;
  return Math.max(SCORING_CONFIG.minGuesserPoints, Math.round(raw));
}

function computeDrawerPoints(numCorrectGuessers, totalOtherPlayers) {
  if (totalOtherPlayers <= 0) return 0;
  const points = SCORING_CONFIG.drawerPointsPerGuesser * numCorrectGuessers;
  const cap = SCORING_CONFIG.basePoints * totalOtherPlayers;
  return Math.min(points, cap);
}

module.exports = { SCORING_CONFIG, computeGuesserPoints, computeDrawerPoints };
