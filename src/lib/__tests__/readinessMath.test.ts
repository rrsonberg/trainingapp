/**
 * Readiness arithmetic.
 *
 * These exist because the scoring rule is the one piece of this app that can be
 * confidently wrong. Every other bug shows itself — a screen fails to render, a
 * write does not arrive. A misweighted readiness score looks exactly like a
 * correct one and quietly tells someone to train through a bad day.
 *
 * The refusal branches matter as much as the arithmetic. A score built from too
 * little is worse than no score at all.
 */

import {
  MIN_COVERAGE, TOTAL_WEIGHT, WEIGHTS,
  bandFor, clamp, fromBaseline, fromScale, scoreComponents,
} from '../readinessMath';

const W = WEIGHTS;

const everySignal = (normalized: number) =>
  (Object.keys(W) as Array<keyof typeof W>).map((k) => ({ normalized, weight: W[k] }));

describe('fromBaseline', () => {
  it('is neutral at baseline', () => {
    expect(fromBaseline(100, 100)).toBe(0);
  });

  it('caps at a 25% swing in both directions', () => {
    expect(fromBaseline(125, 100)).toBe(1);
    expect(fromBaseline(150, 100)).toBe(1);   // further out is not worse
    expect(fromBaseline(75, 100)).toBe(-1);
    expect(fromBaseline(10, 100)).toBe(-1);
  });

  it('scales linearly inside the cap', () => {
    expect(fromBaseline(112.5, 100)).toBeCloseTo(0.5, 6);
  });

  it('inverts for lower-is-better metrics', () => {
    // A resting heart rate below baseline is a GOOD day.
    expect(fromBaseline(45, 60, true)).toBe(1);
    expect(fromBaseline(75, 60, true)).toBe(-1);
  });

  it('refuses to divide by a zero or non-finite baseline', () => {
    expect(fromBaseline(50, 0)).toBe(0);
    expect(fromBaseline(50, NaN)).toBe(0);
  });
});

describe('fromScale', () => {
  it('treats 3 as this client\'s own normal', () => {
    expect(fromScale(3)).toBe(0);
  });

  it('maps the ends to -1 and +1', () => {
    expect(fromScale(5)).toBe(1);
    expect(fromScale(1)).toBe(-1);
  });

  it('inverts stress, where high is bad', () => {
    expect(fromScale(5, true)).toBe(-1);
    expect(fromScale(1, true)).toBe(1);
  });

  it('clamps values outside 1-5', () => {
    expect(fromScale(9)).toBe(1);
    expect(fromScale(-4)).toBe(-1);
  });
});

describe('bandFor', () => {
  it('puts the boundaries where the copy claims', () => {
    expect(bandFor(0)).toBe('hold');
    expect(bandFor(39)).toBe('hold');
    expect(bandFor(40)).toBe('steady');
    expect(bandFor(65)).toBe('steady');
    expect(bandFor(66)).toBe('push');
    expect(bandFor(100)).toBe('push');
  });
});

describe('scoreComponents', () => {
  it('reads 50 when everything sits at baseline', () => {
    const r = scoreComponents(everySignal(0))!;
    expect(r.score).toBe(50);
    expect(r.band).toBe('steady');
    expect(r.confidence).toBe('high');
    expect(r.coverage).toBeCloseTo(1, 6);
  });

  it('spans the full range', () => {
    expect(scoreComponents(everySignal(1))!.score).toBe(100);
    expect(scoreComponents(everySignal(-1))!.score).toBe(0);
  });

  it('renormalises over what is available', () => {
    // Two perfect signals out of six still read 100 — the score describes the
    // signals it has. Coverage and confidence are what expose how thin it is.
    const r = scoreComponents([
      { normalized: 1, weight: W.hrv },
      { normalized: 1, weight: W.sleep },
    ])!;
    expect(r.score).toBe(100);
    expect(r.coverage).toBeCloseTo(0.5, 6);
    expect(r.confidence).toBe('medium');
  });

  it('does not let good subjective input mask two bad objective signals', () => {
    const r = scoreComponents([
      { normalized: -1, weight: W.hrv },
      { normalized: -1, weight: W.sleep },
      { normalized: 1, weight: W.energy },
      { normalized: 1, weight: W.sleepQuality },
      { normalized: 1, weight: W.stress },
    ])!;
    expect(r.score).toBeGreaterThan(15);
    expect(r.score).toBeLessThan(60);
  });

  describe('refusals', () => {
    it('refuses HRV alone, despite it being the heaviest signal', () => {
      // 0.30 coverage, under the floor. The most important single signal is
      // still not enough on its own.
      expect(scoreComponents([{ normalized: 1, weight: W.hrv }])).toBeNull();
    });

    it('refuses a single subjective tap', () => {
      expect(scoreComponents([{ normalized: 1, weight: W.stress }])).toBeNull();
    });

    it('refuses nothing at all', () => {
      expect(scoreComponents([])).toBeNull();
    });

    it('refuses exactly below the floor and accepts at it', () => {
      const justUnder = (MIN_COVERAGE * TOTAL_WEIGHT) - 0.001;
      const atFloor = MIN_COVERAGE * TOTAL_WEIGHT;
      expect(scoreComponents([{ normalized: 0, weight: justUnder }])).toBeNull();
      expect(scoreComponents([{ normalized: 0, weight: atFloor }])).not.toBeNull();
    });
  });

  it('grades confidence by coverage', () => {
    const at = (weight: number) => scoreComponents([{ normalized: 0, weight }])!.confidence;
    expect(at(TOTAL_WEIGHT * 0.45)).toBe('low');
    expect(at(TOTAL_WEIGHT * 0.55)).toBe('medium');
    expect(at(TOTAL_WEIGHT * 0.8)).toBe('high');
  });
});

describe('clamp', () => {
  it('bounds on both sides and passes through the middle', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
