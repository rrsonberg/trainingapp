/**
 * Units.
 *
 * The module docstring makes a hard claim — storage is always SI, conversion
 * happens here and nowhere else — which means every conversion bug in the app
 * has to be in this file. Cheap to pin down, and silent if wrong: a cold plunge
 * logged at 10 instead of 50 reads perfectly plausible either way.
 */

import {
  cToF, displayDuration, displayTemp, displayWeight, fToC, kgToLb, lbToKg,
} from '../units';

describe('conversions', () => {
  it('round-trips weight without drift', () => {
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 9);
  });

  it('round-trips temperature without drift', () => {
    expect(fToC(cToF(37))).toBeCloseTo(37, 9);
  });

  it('matches known anchors', () => {
    expect(kgToLb(1)).toBeCloseTo(2.20462262, 8);
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(fToC(32)).toBe(0);
    // The one that matters in this app: a 50F plunge is 10C.
    expect(fToC(50)).toBeCloseTo(10, 9);
  });

  it('handles below-freezing, which cold exposure reaches', () => {
    expect(cToF(-40)).toBe(-40);
    expect(fToC(-40)).toBe(-40);
  });
});

describe('display', () => {
  it('renders an em dash for missing values rather than 0 or NaN', () => {
    expect(displayWeight(null, 'metric')).toBe('—');
    expect(displayTemp(null, 'metric')).toBe('—');
    expect(displayDuration(null)).toBe('—');
  });

  it('shows weight to the precision each system deserves', () => {
    expect(displayWeight(100, 'metric')).toBe('100.0 kg');
    expect(displayWeight(100, 'imperial')).toBe('220 lb');
  });

  it('shows temperature per system', () => {
    expect(displayTemp(10, 'metric')).toBe('10.0°C');
    expect(displayTemp(10, 'imperial')).toBe('50°F');
  });

  describe('duration', () => {
    it('drops the seconds when there are none', () => {
      expect(displayDuration(600)).toBe('10 min');
    });

    it('zero-pads seconds', () => {
      expect(displayDuration(605)).toBe('10:05');
      expect(displayDuration(65)).toBe('1:05');
    });

    it('switches to hours past sixty minutes', () => {
      expect(displayDuration(3600)).toBe('1h 0m');
      expect(displayDuration(5400)).toBe('1h 30m');
    });

    it('handles zero', () => {
      expect(displayDuration(0)).toBe('0 min');
    });
  });
});
