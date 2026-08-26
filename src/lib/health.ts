/**
 * Health platform integration.
 *
 * THE CHAIN:
 *   MyFitnessPal -> Apple Health -> this module -> local SQLite -> Supabase -> coach
 *
 * MyFitnessPal is never contacted. Their API has been closed to new partners
 * since 2019, but MFP writes calories and macros into Apple Health, and any
 * app with the user's permission can read them from there. Same for Whoop,
 * Oura, Garmin, Fitbit and Apple Watch — all of them write to HealthKit, so
 * ONE integration covers every device.
 *
 * REQUIRES A NATIVE BUILD. HealthKit does not exist in Expo Go. Use a dev
 * client (`npx expo run:ios`) or an EAS build.
 *
 * THE GOTCHA THAT WILL BITE YOU:
 * iOS deliberately never tells you whether the user DENIED read permission —
 * denied reads return an empty array, identical to "no data recorded". This is
 * a privacy feature, not a bug. Never show "no data" as if it were a failure,
 * and never assume a granted request means data will arrive.
 */

import { Platform } from 'react-native';
import type {
  HKQuantityTypeIdentifier,
  HKUnit,
} from '@kingstinct/react-native-healthkit';
import { saveBiometric } from '../repositories/biometrics';

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');

type LoadedHealthKit = {
  HealthKit: HealthKitModule['default'];
  quantityIds: HealthKitModule['HKQuantityTypeIdentifier'];
  categoryIds: HealthKitModule['HKCategoryTypeIdentifier'];
};

let loaded: LoadedHealthKit | null | undefined;

/**
 * Load the native module, or null where it does not exist.
 *
 * The header above already says HealthKit is absent in Expo Go — but the metric
 * table below used to be built from the native enum at IMPORT time, so merely
 * importing this file crashed anywhere the native side was missing, taking the
 * whole app down rather than one screen. Requiring it lazily keeps the app
 * loadable everywhere and confines the absence to the feature that needs it.
 */
function loadHealthKit(): LoadedHealthKit | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS !== 'ios') return (loaded = null);

  try {
    const mod = require('@kingstinct/react-native-healthkit') as HealthKitModule;
    loaded = mod?.default
      ? {
          HealthKit: mod.default,
          quantityIds: mod.HKQuantityTypeIdentifier,
          categoryIds: mod.HKCategoryTypeIdentifier,
        }
      : null;
  } catch {
    // Expo Go, or a build where the pod was never linked.
    loaded = null;
  }
  return loaded;
}

export type MetricKey =
  | 'hrv_ms' | 'resting_hr' | 'sleep_seconds' | 'respiratory_rate' | 'spo2'
  | 'body_weight_kg' | 'body_fat_pct' | 'steps' | 'active_energy_kj'
  | 'dietary_energy_kj' | 'dietary_protein_g' | 'dietary_carbs_g'
  | 'dietary_fat_g' | 'dietary_water_ml';

type QuantityMap = {
  metric: MetricKey;
  identifier: HKQuantityTypeIdentifier;
  unit: HKUnit | string;
  /** sum daily samples (nutrition, steps) vs take the day's average (HRV, HR) */
  aggregate: 'sum' | 'average' | 'latest';
};

/**
 * What we read. Request the minimum that earns its place — every extra type
 * is another switch in the permission sheet the user can decline, and a longer
 * privacy label at App Store submission.
 */
let metricsCache: QuantityMap[] | null = null;

export function quantityMetrics(hk: LoadedHealthKit): QuantityMap[] {
  if (metricsCache) return metricsCache;
  const Q = hk.quantityIds;
  metricsCache = [
  // Readiness
  { metric: 'hrv_ms',            identifier: Q.heartRateVariabilitySDNN, unit: 'ms',      aggregate: 'average' },
  { metric: 'resting_hr',        identifier: Q.restingHeartRate,         unit: 'count/min', aggregate: 'average' },
  { metric: 'respiratory_rate',  identifier: Q.respiratoryRate,          unit: 'count/min', aggregate: 'average' },
  { metric: 'spo2',              identifier: Q.oxygenSaturation,         unit: '%',       aggregate: 'average' },

  // Body
  { metric: 'body_weight_kg',    identifier: Q.bodyMass,                 unit: 'kg',      aggregate: 'latest' },
  { metric: 'body_fat_pct',      identifier: Q.bodyFatPercentage,        unit: '%',       aggregate: 'latest' },

  // Activity
  { metric: 'steps',             identifier: Q.stepCount,                unit: 'count',   aggregate: 'sum' },
  { metric: 'active_energy_kj',  identifier: Q.activeEnergyBurned,       unit: 'kJ',      aggregate: 'sum' },

  // Nutrition — this is the MyFitnessPal data.
  // NOTE: HealthKit gives DAILY TOTALS, not individual food entries. You get
  // "2140 kcal / 180g protein on Tuesday", never "chicken and rice at 1pm".
  { metric: 'dietary_energy_kj',  identifier: Q.dietaryEnergyConsumed,   unit: 'kJ',      aggregate: 'sum' },
  { metric: 'dietary_protein_g',  identifier: Q.dietaryProtein,          unit: 'g',       aggregate: 'sum' },
  { metric: 'dietary_carbs_g',    identifier: Q.dietaryCarbohydrates,    unit: 'g',       aggregate: 'sum' },
  { metric: 'dietary_fat_g',      identifier: Q.dietaryFatTotal,         unit: 'g',       aggregate: 'sum' },
  { metric: 'dietary_water_ml',   identifier: Q.dietaryWater,            unit: 'ml',      aggregate: 'sum' },
  ];
  return metricsCache;
}

/**
 * Truthfully: is there a Health source we can actually read?
 *
 * This used to answer true on Android on the strength of the Health Connect
 * permissions in app.json — but nothing reads Health Connect yet, so the screen
 * promised a connection and then silently did nothing. It now reports what is
 * really wired up.
 */
export function isHealthAvailable() {
  return loadHealthKit() !== null;
}

/**
 * Ask for permission. Fires the iOS system sheet.
 *
 * The returned boolean means "the sheet was shown and dismissed", NOT "we got
 * access". There is no way to know the latter. Treat it accordingly.
 */
export async function requestHealthPermissions(): Promise<boolean> {
  const hk = loadHealthKit();
  if (!hk) return false;

  const available = await hk.HealthKit.isHealthDataAvailable();
  if (!available) return false;

  await hk.HealthKit.requestAuthorization(
    [
      ...quantityMetrics(hk).map((m) => m.identifier),
      hk.categoryIds.sleepAnalysis,
    ],
    [] // we request READ only. We write nothing back to Health.
  );

  return true;
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Pull one metric across a date range and write daily values locally.
 */
async function syncQuantityMetric(
  hk: LoadedHealthKit,
  map: QuantityMap,
  clientId: string,
  from: Date,
  to: Date
): Promise<number> {
  const samples = await hk.HealthKit.queryQuantitySamples(map.identifier, {
    from,
    to,
    unit: map.unit as HKUnit,
  });

  if (!samples?.length) return 0;

  const byDay = new Map<string, number[]>();
  for (const s of samples) {
    const key = dayKey(new Date(s.startDate));
    const arr = byDay.get(key) ?? [];
    arr.push(s.quantity);
    byDay.set(key, arr);
  }

  let written = 0;
  for (const [day, values] of byDay) {
    let value: number;
    if (map.aggregate === 'sum') {
      value = values.reduce((a, b) => a + b, 0);
    } else if (map.aggregate === 'average') {
      value = values.reduce((a, b) => a + b, 0) / values.length;
    } else {
      value = values[values.length - 1];
    }

    await saveBiometric({
      clientId,
      recordedOn: day,
      metric: map.metric,
      value: Number(value.toFixed(3)),
      source: 'healthkit',
    });
    written++;
  }

  return written;
}

async function syncSleep(hk: LoadedHealthKit, clientId: string, from: Date, to: Date) {
  const samples = await hk.HealthKit.queryCategorySamples(
    hk.categoryIds.sleepAnalysis,
    { from, to }
  );
  if (!samples?.length) return 0;

  // Sleep is recorded as many fragments per night. Sum asleep time and
  // attribute it to the day the person WOKE UP, which is how everyone reads it.
  const byDay = new Map<string, number>();
  for (const s of samples) {
    const asleep = String(s.value).toLowerCase().includes('asleep');
    if (!asleep) continue;
    const end = new Date(s.endDate);
    const seconds = (end.getTime() - new Date(s.startDate).getTime()) / 1000;
    const key = dayKey(end);
    byDay.set(key, (byDay.get(key) ?? 0) + seconds);
  }

  for (const [day, seconds] of byDay) {
    await saveBiometric({
      clientId,
      recordedOn: day,
      metric: 'sleep_seconds',
      value: Math.round(seconds),
      source: 'healthkit',
    });
  }
  return byDay.size;
}

/**
 * Historical backfill — run ONCE on first connect.
 *
 * This is the migration answer. Trainerize won't release a client's history,
 * but years of it already sit in Apple Health, and we can read it on day one.
 * A client arriving from Trainerize gets their weight, sleep, HRV and nutrition
 * history restored without Trainerize's cooperation.
 */
export async function backfillHealthHistory(
  clientId: string,
  years = 2,
  onProgress?: (done: number, total: number) => void
) {
  const hk = loadHealthKit();
  if (!hk) return 0;

  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);

  const metrics = quantityMetrics(hk);
  const total = metrics.length + 1;
  let done = 0;
  let rows = 0;

  for (const map of metrics) {
    try {
      rows += await syncQuantityMetric(hk, map, clientId, from, to);
    } catch {
      // One unavailable metric must never abort the whole backfill.
      // A denied type is indistinguishable from an empty one — keep going.
    }
    onProgress?.(++done, total);
  }

  try {
    rows += await syncSleep(hk, clientId, from, to);
  } catch {}
  onProgress?.(++done, total);

  return rows;
}

/** Incremental sync — run on app foreground. Cheap; last 7 days only. */
export async function syncRecentHealth(clientId: string) {
  const hk = loadHealthKit();
  if (!hk) return 0;

  const to = new Date();
  const from = new Date(Date.now() - 7 * 86_400_000);

  let rows = 0;
  for (const map of quantityMetrics(hk)) {
    try {
      rows += await syncQuantityMetric(hk, map, clientId, from, to);
    } catch {}
  }
  try {
    rows += await syncSleep(hk, clientId, from, to);
  } catch {}

  return rows;
}
