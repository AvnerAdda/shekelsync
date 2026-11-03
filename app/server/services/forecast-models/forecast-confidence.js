const CONFIDENCE_THRESHOLDS = Object.freeze({ sure: 0.75, likely: 0.45 });
const CONFIDENCE_TIERS = Object.freeze(['sure', 'likely', 'uncertain']);
// Amount spreads of ±50% or more carry no amount certainty.
const MAX_RELATIVE_SPREAD = 0.5;
const DEFAULT_TIMING_SCORE = 0.6;

const finite = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// How certain the payment date is. Probability-weighted amounts already carry
// the chance of occurrence; this scores whether the user can plan around it.
function scoreTiming(prediction) {
  if (prediction.timingBasis === 'daily_average' || prediction.isBaselineForecast) return 0.3;
  if (prediction.timingBasis === 'scheduled') return 1;
  if (prediction.awaitingReceipt) return 0.9;
  // Bills and detected pay cycles pass interval and day-of-month checks before
  // they are scheduled; pay spread over several possible days is less certain,
  // and a schedule seen only twice is a first estimate.
  if (prediction.forecastBasis === 'recurring_bill' || prediction.forecastBasis === 'income_schedule') {
    const evidenceCap = (finite(prediction.evidenceCount) ?? 3) < 3 ? DEFAULT_TIMING_SCORE : 0.85;
    return Math.min(evidenceCap, finite(prediction.probability) ?? 1);
  }
  if (prediction.predictionKind === 'recurring_investment' && !prediction.isUserResolvedPattern) {
    return (finite(prediction.evidenceCount) ?? 0) >= 3 ? 0.85 : DEFAULT_TIMING_SCORE;
  }
  // Recurring occurrences carry their full amount; their probability field is a floor, not a weight.
  if (prediction.isUserResolvedPattern) return clamp(finite(prediction.confidence) ?? DEFAULT_TIMING_SCORE, 0, 1);
  const base = finite(prediction.patternConfidence) ?? DEFAULT_TIMING_SCORE;
  const probability = finite(prediction.probability);
  return clamp(probability === null ? base : Math.min(base, probability), 0, 1);
}

// How stable the amount is, from the half-width of its range relative to the amount.
function scoreAmount(prediction) {
  const amount = Math.abs(finite(prediction.expectedAmount ?? prediction.amount) ?? 0);
  const low = finite(prediction.amountRange?.low);
  const high = finite(prediction.amountRange?.high);
  if (!amount || low === null || high === null) return 0.5;
  const relativeSpread = Math.abs(high - low) / 2 / amount;
  return clamp(1 - relativeSpread / MAX_RELATIVE_SPREAD, 0, 1);
}

function confidenceTier(confidence) {
  if (confidence >= CONFIDENCE_THRESHOLDS.sure) return 'sure';
  if (confidence >= CONFIDENCE_THRESHOLDS.likely) return 'likely';
  return 'uncertain';
}

function scorePredictionConfidence(prediction = {}) {
  const timingScore = scoreTiming(prediction);
  const amountScore = scoreAmount(prediction);
  const confidence = Math.round(timingScore * (0.4 + 0.6 * amountScore) * 1000) / 1000;
  return { confidence, tier: confidenceTier(confidence), timingScore, amountScore };
}

module.exports = { CONFIDENCE_THRESHOLDS, CONFIDENCE_TIERS, confidenceTier, scorePredictionConfidence };
