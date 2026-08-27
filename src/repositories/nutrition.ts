/**
 * Nutrition — food entries and the day's macros.
 *
 * Same contract as sessions.ts and checkins.ts: a save writes to SQLite and
 * returns. The network is never awaited. The outbox replays it later.
 *
 * The one wrinkle nutrition adds is that TARGETS come from the coach and
 * entries come from the client, so they sync in opposite directions. Targets
 * are pulled and cached read-only; entries are written locally and pushed.
 *
 * Local tables live in localdb.ts alongside every other table:
 * food_log_entries, nutrition_targets_cache, food_items_cache.
 */

import { getDb } from '../lib/localdb';
import { today } from '../lib/day';
import { scaleMacros, type FoodResult, type LoggedMacros } from '../lib/foodApi';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unsorted';

export type FoodEntry = {
  id: string;
  clientGeneratedId: string;
  loggedOn: string;
  mealSlot: MealSlot;
  displayName: string;
  brand: string | null;
  quantity: number;
  unit: 'g' | 'ml' | 'serving';
  energyKj: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  source: string;
};

export type DayMacros = {
  energyKj: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  target: {
    energyKj: number;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    coachNote: string | null;
  } | null;
};

function uuid(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Local cache key for a food.
 *
 * Deterministic rather than random, so logging the same protein bar on Monday
 * and Thursday produces ONE row in recents, not two. Provider + their id is
 * unique; falling back to the name covers a source with no id of its own.
 */
export function localFoodId(food: FoodResult): string {
  return `${food.source}:${food.sourceRef ?? food.name.toLowerCase()}`;
}

/**
 * Append to the outbox in the same shape every other repository uses:
 * row_id is the LOCAL id, and client_generated_id is what makes a replay
 * idempotent on the server.
 */
async function enqueue(
  db: Awaited<ReturnType<typeof getDb>>,
  args: { table: string; rowId: string; cgid: string; operation: string; payload: unknown },
) {
  await db.runAsync(
    `INSERT INTO outbox
       (table_name, row_id, client_generated_id, operation, payload, created_at)
     VALUES (?,?,?,?,?,?)`,
    [
      args.table,
      args.rowId,
      args.cgid,
      args.operation,
      JSON.stringify(args.payload),
      new Date().toISOString(),
    ],
  );
}

// ---------------------------------------------------------------------------
// Writing.
// ---------------------------------------------------------------------------

/**
 * Log a food from search or a scan.
 *
 * Two things happen: the food is cached locally so it appears in recents and
 * a re-scan needs no network, and the entry is written with its macros
 * SNAPSHOT. If a food database later corrects a value, what the client logged
 * today does not silently change next week.
 */
export async function logFood(args: {
  clientId: string;
  food: FoodResult;
  quantity: number;
  unit: 'g' | 'ml' | 'serving';
  mealSlot?: MealSlot;
  day?: string;
  source?: 'manual' | 'scan' | 'search';
}): Promise<FoodEntry> {
  const macros = scaleMacros(args.food, args.quantity, args.unit);
  const foodId = localFoodId(args.food);

  await cacheFood(foodId, args.food);

  return writeEntry({
    clientId: args.clientId,
    day: args.day ?? today(),
    mealSlot: args.mealSlot ?? 'unsorted',
    foodItemId: foodId,
    description: args.food.name,
    brand: args.food.brand,
    quantity: args.quantity,
    unit: args.unit,
    macros,
    source: args.source ?? 'search',
  });
}

/**
 * Quick add: macros typed straight in, no food record.
 *
 * First-class rather than buried. A client who cannot find what they ate will
 * log an approximation or log nothing, and an approximation is worth far more
 * to a coach than a gap in the week.
 */
export async function quickAdd(args: {
  clientId: string;
  description: string;
  energyKj: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  mealSlot?: MealSlot;
  day?: string;
}): Promise<FoodEntry> {
  return writeEntry({
    clientId: args.clientId,
    day: args.day ?? today(),
    mealSlot: args.mealSlot ?? 'unsorted',
    foodItemId: null,
    description: args.description,
    brand: null,
    quantity: 1,
    unit: 'serving',
    macros: {
      energyKj: args.energyKj,
      proteinG: args.proteinG ?? null,
      carbsG: args.carbsG ?? null,
      fatG: args.fatG ?? null,
      fiberG: null,
    },
    source: 'manual',
  });
}

async function writeEntry(a: {
  clientId: string;
  day: string;
  mealSlot: MealSlot;
  foodItemId: string | null;
  description: string;
  brand: string | null;
  quantity: number;
  unit: 'g' | 'ml' | 'serving';
  macros: LoggedMacros;
  source: string;
}): Promise<FoodEntry> {
  const db = await getDb();
  const id = uuid();
  const cgid = uuid();
  const now = new Date().toISOString();

  // One transaction: the row and its outbox line land together or not at all.
  // A row without its outbox line is a silently unsynced entry, which is worse
  // than a failed save because nobody ever finds out.
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO food_log_entries
         (id, client_generated_id, client_id, logged_on, meal_slot, logged_at,
          food_item_id, description, quantity, unit,
          energy_kj, protein_g, carbs_g, fat_g, fiber_g,
          source, updated_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        id, cgid, a.clientId, a.day, a.mealSlot, now,
        a.foodItemId, a.description, a.quantity, a.unit,
        a.macros.energyKj, a.macros.proteinG, a.macros.carbsG,
        a.macros.fatG, a.macros.fiberG,
        a.source, now,
      ],
    );

    await enqueue(db, {
      table: 'food_log_entries',
      rowId: id,
      cgid,
      operation: 'insert',
      payload: {
        client_generated_id: cgid,
        client_id: a.clientId,
        logged_on: a.day,
        meal_slot: a.mealSlot,
        logged_at: now,
        // NOT the local food id. food_items on the server is a uuid FK and the
        // catalogue row does not exist there yet — sending a local key would
        // fail the constraint. The macros and the name are already on the
        // entry, so nothing is lost; linking the catalogue is a later job.
        food_item_id: null,
        description: a.description,
        quantity: a.quantity,
        unit: a.unit,
        energy_kj: a.macros.energyKj,
        protein_g: a.macros.proteinG,
        carbs_g: a.macros.carbsG,
        fat_g: a.macros.fatG,
        fiber_g: a.macros.fiberG,
        source: a.source,
      },
    });
  });

  return {
    id,
    clientGeneratedId: cgid,
    loggedOn: a.day,
    mealSlot: a.mealSlot,
    displayName: a.description,
    brand: a.brand,
    quantity: a.quantity,
    unit: a.unit,
    energyKj: a.macros.energyKj,
    proteinG: a.macros.proteinG,
    carbsG: a.macros.carbsG,
    fatG: a.macros.fatG,
    source: a.source,
  };
}

/** Soft delete, matching every other table. The row stays so the push can
 *  carry the deletion to the server rather than leaving an orphan there. */
export async function removeEntry(clientGeneratedId: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    `SELECT id FROM food_log_entries WHERE client_generated_id = ?`,
    [clientGeneratedId],
  );
  if (!row) return;

  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE food_log_entries SET deleted_at = ?, updated_at = ?, dirty = 1
        WHERE client_generated_id = ?`,
      [now, now, clientGeneratedId],
    );
    await enqueue(db, {
      table: 'food_log_entries',
      rowId: row.id,
      cgid: clientGeneratedId,
      operation: 'update',
      payload: { client_generated_id: clientGeneratedId, deleted_at: now },
    });
  });
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

export async function entriesForDay(clientId: string, day = today()): Promise<FoodEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT e.*, f.brand AS brand_name
       FROM food_log_entries e
       LEFT JOIN food_items_cache f ON f.id = e.food_item_id
      WHERE e.client_id = ? AND e.logged_on = ? AND e.deleted_at IS NULL
      ORDER BY e.logged_at`,
    [clientId, day],
  );

  return rows.map((r) => ({
    id: r.id,
    clientGeneratedId: r.client_generated_id,
    loggedOn: r.logged_on,
    mealSlot: r.meal_slot,
    displayName: r.description ?? 'Food',
    brand: r.brand_name ?? null,
    quantity: r.quantity,
    unit: r.unit,
    energyKj: r.energy_kj,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    source: r.source,
  }));
}

/**
 * The day's totals against the coach's targets — what the home card renders.
 *
 * Targets are effective-dated, so this takes the most recent one on or before
 * the day in question. A target set tomorrow must not retroactively rewrite
 * how today looked.
 */
export async function macrosForDay(clientId: string, day = today()): Promise<DayMacros> {
  const db = await getDb();

  const totals = await db.getFirstAsync<any>(
    `SELECT COALESCE(SUM(energy_kj),0) AS energy_kj,
            COALESCE(SUM(protein_g),0) AS protein_g,
            COALESCE(SUM(carbs_g),0)   AS carbs_g,
            COALESCE(SUM(fat_g),0)     AS fat_g
       FROM food_log_entries
      WHERE client_id = ? AND logged_on = ? AND deleted_at IS NULL`,
    [clientId, day],
  );

  const target = await db.getFirstAsync<any>(
    `SELECT * FROM nutrition_targets_cache
      WHERE client_id = ? AND effective_from <= ?
      ORDER BY effective_from DESC LIMIT 1`,
    [clientId, day],
  );

  return {
    energyKj: totals?.energy_kj ?? 0,
    proteinG: totals?.protein_g ?? 0,
    carbsG: totals?.carbs_g ?? 0,
    fatG: totals?.fat_g ?? 0,
    target: target
      ? {
          energyKj: target.energy_kj,
          proteinG: target.protein_g,
          carbsG: target.carbs_g,
          fatG: target.fat_g,
          coachNote: target.coach_note,
        }
      : null,
  };
}

/** Foods eaten before, newest first — the list that makes logging fast.
 *  Most people eat the same forty things, which is why week two of logging
 *  takes a fraction of the taps week one did. */
export async function recentFoods(clientId: string, limit = 25): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync<any>(
    `SELECT f.*, MAX(e.logged_at) AS last_at
       FROM food_items_cache f
       JOIN food_log_entries e ON e.food_item_id = f.id
      WHERE e.client_id = ? AND e.deleted_at IS NULL
      GROUP BY f.id
      ORDER BY last_at DESC
      LIMIT ?`,
    [clientId, limit],
  );
}

/** Turn a cached row back into the shape the rest of the code expects. */
export function foodFromCache(row: any): FoodResult {
  return {
    source: row.source,
    sourceRef: row.source_ref,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    basis: 'per_100g',
    energyKj: row.energy_kj,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    fiberG: row.fiber_g,
    sugarG: null,
    sodiumMg: null,
    servingLabel: row.serving_label,
    servingG: row.serving_g,
    verified: !!row.verified,
  };
}

/** Cache a looked-up food so the next scan needs no network. */
export async function cacheFood(id: string, food: FoodResult): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO food_items_cache
       (id, source, source_ref, barcode, name, brand, energy_kj,
        protein_g, carbs_g, fat_g, fiber_g, serving_label, serving_g,
        verified, last_used_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, food.source, food.sourceRef, food.barcode, food.name, food.brand,
      food.energyKj, food.proteinG, food.carbsG, food.fatG, food.fiberG,
      food.servingLabel, food.servingG, food.verified ? 1 : 0,
      new Date().toISOString(),
    ],
  );
}

/** A scan that has been seen before never needs the network again. */
export async function barcodeFromCache(barcode: string): Promise<FoodResult | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM food_items_cache WHERE barcode = ?`,
    [barcode],
  );
  return row ? foodFromCache(row) : null;
}
