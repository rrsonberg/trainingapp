/**
 * Readiness scoring.
 *
 * WHAT THIS IS: a transparent weighted deviation from the client's own 30-day
 * baseline, blending three objective signals with three subjective ones. It
 * returns its components, not just a number, because a score a client cannot
 * interrogate is a score they will stop trusting the first time it disagrees
 * with how they feel.
 *
 * WHAT THIS IS NOT: validated sports science. The weights below are a defensible
 * starting point, not a settled result, and they are collected in one constant
 * so they can be tuned against real outcomes rather than argued about in the
 * abstract. Nothing here should be presented to a client as a medical or
 * diagnostic figure.
 *
 * THE RULE THAT MATTERS: never invent a score. biometrics.ts already refuses a
 * baseline under fourteen readings — "don't score against noise" — and this
 * module carries that through. Missing inputs are dropped and the remaining
 * weights renormalised, the confidence falls, and when too little is available
 * the result is null rather than a confident-looking number built from one
 * subjective tap. A wrong readiness score is worse than none: it tells someone
 * to train through something they should have respected.
 */

import {
  MIN_COVERAGE, TOTAL_WEIGHT, WEIGHTS, bandFor, clamp, fromBaseline, fromScale,
  scoreComponents, type ComponentKey, type ReadinessBand,
} from './readinessMath';
import { latestMetric, metricBaseline } from '../repositories/biometrics';
import { checkinForDay, today, type Checkin } from '../repositories/checkins';



export type ReadinessComponent = {
  key: ComponentKey;
  label: string;
  /** -1 (much worse than baseline) to +1 (much better). */
  normalized: number;
  weight: number;
  detail: string;
};

export type Readiness = {
  /** 0-100, where 50 is exactly this client's own normal. */
  score: number;
  band: ReadinessBand;
  components: ReadinessComponent[];
  /** Share of total weight that had data behind it. */
  coverage: number;
  confidence: 'low' | 'medium' | 'high';
  /** Named so the UI can say what would sharpen the score. */
  missing: ComponentKey[];
};

function pct(value: number, baseline: number): string {
  const d = Math.round(((value - baseline) / baseline) * 100);
  if (d === 0) return 'at baseline';
  return `${d > 0 ? '+' : ''}${d}% vs baseline`;
}

export async function computeReadiness(
  clientId: string,
  day: string = today()
): Promise<Readiness | null> {
  const checkin: Checkin | null = await checkinForDay(clientId, day);

  const components: ReadinessComponent[] = [];
  const missing: ComponentKey[] = [];

  // --- Objective. Each needs both a reading and a baseline to say anything.
  const objective: Array<{
    key: ComponentKey; label: string; metric: string; invert: boolean; fmt: (v: number) => string;
  }> = [
    { key: 'hrv', label: 'HRV', metric: 'hrv_ms', invert: false, fmt: (v) => `${Math.round(v)} ms` },
    { key: 'restingHr', label: 'Resting HR', metric: 'resting_hr', invert: true, fmt: (v) => `${Math.round(v)} bpm` },
    { key: 'sleep', label: 'Sleep', metric: 'sleep_seconds', invert: false, fmt: (v) => `${(v / 3600).toFixed(1)} h` },
  ];

  for (const spec of objective) {
    const latest = await latestMetric(clientId, spec.metric);
    const baseline = await metricBaseline(clientId, spec.metric);

    // A reading with no baseline is a number with nothing to mean. Skip it.
    if (!latest || baseline == null) {
      missing.push(spec.key);
      continue;
    }

    components.push({
      key: spec.key,
      label: spec.label,
      normalized: fromBaseline(latest.value, baseline, spec.invert),
      weight: WEIGHTS[spec.key],
      detail: `${spec.fmt(latest.value)} - ${pct(latest.value, baseline)}`,
    });
  }

  // --- Subjective, from today's check-in.
  const subjective: Array<{ key: ComponentKey; label: string; value: number | null | undefined; invert: boolean }> = [
    { key: 'energy', label: 'Energy', value: checkin?.energy, invert: false },
    { key: 'sleepQuality', label: 'Sleep quality', value: checkin?.sleepQuality, invert: false },
    { key: 'stress', label: 'Stress', value: checkin?.stress, invert: true },
  ];

  for (const spec of subjective) {
    if (spec.value == null) {
      missing.push(spec.key);
      continue;
    }
    components.push({
      key: spec.key,
      label: spec.label,
      normalized: fromScale(spec.value, spec.invert),
      weight: WEIGHTS[spec.key],
      detail: `${spec.value} of 5`,
    });
  }

  // Too little to say anything honest. Say nothing.
  const scored = scoreComponents(components);
  if (!scored) return null;

  // Heaviest contributors first: that ordering is what makes the score legible.
  components.sort((a, b) => Math.abs(b.normalized * b.weight) - Math.abs(a.normalized * a.weight));

  return { ...scored, components, missing };
}

export const BAND_COPY: Record<ReadinessBand, { title: string; body: string }> = {
  hold: {
    title: 'Hold back today',
    body: 'Your numbers are below your own normal. Train, but take the lighter option and keep it short.',
  },
  steady: {
    title: 'Steady',
    body: 'You are around your baseline. Train as planned.',
  },
  push: {
    title: 'Good day to push',
    body: 'You are above your own normal. If there was a session to go hard on, this is it.',
  },
};
