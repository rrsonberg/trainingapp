/**
 * Units. Storage is ALWAYS SI. Conversion happens here, at render time only.
 * If a conversion appears anywhere else in the codebase, it is a bug.
 */
export type UnitSystem = 'imperial' | 'metric';

export const kgToLb = (kg: number) => kg * 2.20462262;
export const lbToKg = (lb: number) => lb / 2.20462262;
export const cToF = (c: number) => c * 9 / 5 + 32;
export const fToC = (f: number) => (f - 32) * 5 / 9;

export function displayWeight(kg: number | null, system: UnitSystem) {
  if (kg == null) return '—';
  return system === 'metric'
    ? `${kg.toFixed(1)} kg`
    : `${kgToLb(kg).toFixed(0)} lb`;
}

export function displayTemp(c: number | null, system: UnitSystem) {
  if (c == null) return '—';
  return system === 'metric'
    ? `${c.toFixed(1)}°C`
    : `${cToF(c).toFixed(0)}°F`;
}

export function displayDuration(seconds: number | null) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
