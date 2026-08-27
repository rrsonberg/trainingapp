/**
 * Daily check-in repository.
 *
 * One row per day. Saving twice on the same day updates that day rather than
 * creating a second row, and it reuses the original client_generated_id so the
 * server upsert collapses onto the same row instead of accumulating duplicates
 * of someone changing their mind at breakfast.
 */

import * as Crypto from 'expo-crypto';
import { getDb } from '../lib/localdb';
import { enqueue } from '../lib/outbox';
import { dayOffset, today as localToday } from '../lib/day';

/** All subjective fields are 1-5. 3 is "normal for me", not "average person". */
export type Checkin = {
  id: string;
  clientGeneratedId: string;
  clientId: string;
  checkinDate: string;
  energy: number | null;
  sleepQuality: number | null;
  stress: number | null;
  motivation: number | null;
  soreness: Record<string, number>;
  note: string | null;
  updatedAt: string;
};

function rowToCheckin(r: any): Checkin {
  let soreness: Record<string, number> = {};
  try {
    const parsed = JSON.parse(r.soreness ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) soreness = parsed;
  } catch {
    // A malformed blob is not worth failing a read over.
  }
  return {
    id: r.id,
    clientGeneratedId: r.client_generated_id,
    clientId: r.client_id,
    checkinDate: r.checkin_date,
    energy: r.energy,
    sleepQuality: r.sleep_quality,
    stress: r.stress,
    motivation: r.motivation,
    soreness,
    note: r.note,
    updatedAt: r.updated_at,
  };
}

export function today(): string {
  return localToday();
}

export async function checkinForDay(
  clientId: string,
  day: string
): Promise<Checkin | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<any>(
    `SELECT * FROM daily_checkins WHERE client_id = ? AND checkin_date = ?`,
    [clientId, day]
  );
  return r ? rowToCheckin(r) : null;
}

export async function recentCheckins(clientId: string, days = 14): Promise<Checkin[]> {
  const db = await getDb();
  const since = dayOffset(-days);
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM daily_checkins
      WHERE client_id = ? AND checkin_date >= ?
      ORDER BY checkin_date DESC`,
    [clientId, since]
  );
  return rows.map(rowToCheckin);
}

export async function saveCheckin(input: {
  clientId: string;
  checkinDate?: string;
  energy?: number | null;
  sleepQuality?: number | null;
  stress?: number | null;
  motivation?: number | null;
  soreness?: Record<string, number>;
  note?: string | null;
}): Promise<Checkin> {
  const db = await getDb();
  const day = input.checkinDate ?? today();
  const now = new Date().toISOString();

  const existing = await checkinForDay(input.clientId, day);

  const row = {
    // Reusing both ids on a re-save is what makes the outbox replay idempotent.
    id: existing?.id ?? Crypto.randomUUID(),
    client_generated_id: existing?.clientGeneratedId ?? Crypto.randomUUID(),
    client_id: input.clientId,
    checkin_date: day,
    energy: input.energy ?? null,
    sleep_quality: input.sleepQuality ?? null,
    stress: input.stress ?? null,
    motivation: input.motivation ?? null,
    soreness: JSON.stringify(input.soreness ?? {}),
    note: input.note ?? null,
    updated_at: now,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO daily_checkins
         (id, client_generated_id, client_id, checkin_date, energy, sleep_quality,
          stress, motivation, soreness, note, updated_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
       ON CONFLICT(client_generated_id) DO UPDATE SET
         energy = excluded.energy,
         sleep_quality = excluded.sleep_quality,
         stress = excluded.stress,
         motivation = excluded.motivation,
         soreness = excluded.soreness,
         note = excluded.note,
         updated_at = excluded.updated_at,
         dirty = 1`,
      [
        row.id, row.client_generated_id, row.client_id, row.checkin_date,
        row.energy, row.sleep_quality, row.stress, row.motivation,
        row.soreness, row.note, row.updated_at,
      ]
    );
    await enqueue(db, {
      table: 'daily_checkins',
      rowId: row.id,
      clientGeneratedId: row.client_generated_id,
      operation: 'upsert',
      payload: { ...row, soreness: input.soreness ?? {} },
    });
  });

  return rowToCheckin(row);
}
