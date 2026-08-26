/**
 * Biometrics repository. Same rule as sessions: write local, sync later.
 *
 * Health data arrives in bulk (a two-year backfill is thousands of rows), so
 * this path must never block on the network. It writes to SQLite and lets the
 * outbox drain in the background.
 */

import * as Crypto from 'expo-crypto';
import { getDb } from '../lib/localdb';
import { enqueue } from '../lib/outbox';

export type BiometricSource =
  | 'healthkit' | 'health_connect' | 'manual'
  | 'whoop' | 'oura' | 'garmin' | 'fitbit';

export async function saveBiometric(input: {
  clientId: string;
  recordedOn: string;      // YYYY-MM-DD
  metric: string;
  value: number;
  source: BiometricSource;
}) {
  const db = await getDb();
  const now = new Date().toISOString();

  // The uniqueness key is (client, day, metric, source) — same as the server.
  // Re-running a backfill overwrites rather than duplicating, so it is safe to
  // run repeatedly, which matters because users retry things.
  const [existing] = await db.getAllAsync<{ id: string; client_generated_id: string }>(
    `SELECT id, client_generated_id FROM biometrics
      WHERE client_id = ? AND recorded_on = ? AND metric = ? AND source = ?`,
    [input.clientId, input.recordedOn, input.metric, input.source]
  );

  const id = existing?.id ?? Crypto.randomUUID();
  const clientGeneratedId = existing?.client_generated_id ?? Crypto.randomUUID();

  const row = {
    id,
    client_generated_id: clientGeneratedId,
    client_id: input.clientId,
    recorded_on: input.recordedOn,
    metric: input.metric,
    value: input.value,
    source: input.source,
    updated_at: now,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO biometrics
         (id, client_generated_id, client_id, recorded_on, metric, value, source, updated_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,1)
       ON CONFLICT (client_id, recorded_on, metric, source)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, dirty = 1`,
      [id, clientGeneratedId, row.client_id, row.recorded_on,
       row.metric, row.value, row.source, row.updated_at]
    );

    await enqueue(db, {
      table: 'biometrics',
      rowId: id,
      clientGeneratedId,
      operation: 'upsert',
      payload: row,
    });
  });
}

export async function latestMetric(clientId: string, metric: string) {
  const db = await getDb();
  const [row] = await db.getAllAsync<{ value: number; recorded_on: string }>(
    `SELECT value, recorded_on FROM biometrics
      WHERE client_id = ? AND metric = ?
      ORDER BY recorded_on DESC LIMIT 1`,
    [clientId, metric]
  );
  return row ?? null;
}

/** Rolling baseline — what a readiness score is measured against. */
export async function metricBaseline(
  clientId: string,
  metric: string,
  days = 30
) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [row] = await db.getAllAsync<{ avg: number; n: number }>(
    `SELECT AVG(value) AS avg, COUNT(*) AS n FROM biometrics
      WHERE client_id = ? AND metric = ? AND recorded_on >= ?`,
    [clientId, metric, since]
  );
  // Fewer than 14 readings is not a baseline. Don't score against noise.
  if (!row || row.n < 14) return null;
  return row.avg;
}

export async function nutritionForDay(clientId: string, day: string) {
  const db = await getDb();
  const rows = await db.getAllAsync<{ metric: string; value: number }>(
    `SELECT metric, value FROM biometrics
      WHERE client_id = ? AND recorded_on = ? AND metric LIKE 'dietary_%'`,
    [clientId, day]
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.metric] = r.value;
  return out;
}
