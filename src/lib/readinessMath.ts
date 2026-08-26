/**
 * Readiness arithmetic — pure, no IO, no imports.
 *
 * Split from readiness.ts so it can be exercised directly. A scoring rule that
 * cannot be tested without a phone and thirty days of history is a scoring rule
 * nobody will ever check.
 */

/**
 * Component weights. Relative, not absolute — whatever is available gets
 * renormalised — so these say "HRV matters twice as much as stress", not
 * "HRV is 30% of readiness".
 *
 * A defensible starting point, not a settled result. Collected here so they can
 * be tuned against real outcomes rather than argued about in the abstract.
 */
export const WEIGHTS = {
  hrv: 0.30,
  restingHr: 0.15,
  sleep: 0.20,
  energy: 0.15,
  sleepQuality: 0.10,
  stress: 0.10,
} as const;

export type ComponentKey = keyof typeof WEIGHTS;

/** A 25% swing from baseline is a large day. Beyond that, more is not worse. */
export const MAX_DEVIATION = 0.25;

/** Below this share of total weight, the inputs are too thin to score. */
export const MIN_COVERAGE = 0.35;

export const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

export type ReadinessBand = 'hold' | 'steady' | 'push';

export type ScoredComponent = { normalized: number; weight: number };

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Deviation from baseline, normalised to -1..1. `invert` for lower-is-better. */
export function fromBaseline(value: number, baseline: number, invert = false): number {
  if (!Number.isFinite(baseline) || baseline === 0) return 0;
  const deviation = (value - baseline) / baseline;
  const n = clamp(deviation / MAX_DEVIATION, -1, 1);
  return invert ? -n : n;
}

/** Subjective 1-5 to -1..1, where 3 is this client's normal. */
export function fromScale(value: number, invert = false): number {
  const n = clamp((value - 3) / 2, -1, 1);
  return invert ? -n : n;
}

export function bandFor(score: number): ReadinessBand {
  return score < 40 ? 'hold' : score <= 65 ? 'steady' : 'push';
}

export type Scored = {
  score: number;
  band: ReadinessBand;
  coverage: number;
  confidence: 'low' | 'medium' | 'high';
};

/**
 * Combine components into a score, or null when too little is known.
 *
 * Returning null is the important branch. A wrong readiness score is worse than
 * no score: it tells someone to train through something they should have
 * respected.
 */
export function scoreComponents(components: ScoredComponent[]): Scored | null {
  const available = components.reduce((a, c) => a + c.weight, 0);
  const coverage = available / TOTAL_WEIGHT;

  if (components.length === 0 || available === 0 || coverage < MIN_COVERAGE) return null;

  const weighted = components.reduce((a, c) => a + c.normalized * c.weight, 0) / available;
  const score = Math.round(clamp(50 + 50 * weighted, 0, 100));

  return {
    score,
    band: bandFor(score),
    coverage,
    confidence: coverage >= 0.7 ? 'high' : coverage >= 0.5 ? 'medium' : 'low',
  };
}
