/**
 * Pull sync.
 *
 * The outbox pushes. This pulls. Together they are the only two places in the
 * app that touch the network.
 *
 * CONFLICT RULE: a locally dirty row is never overwritten.
 *
 * That is the whole policy, and it follows from the same principle outbox.ts
 * states — never silently discard a user's data. A dirty row is a write the
 * user made that has not reached the server yet. Letting a pull clobber it
 * would lose a logged set to a background refresh, which is precisely the
 * failure this architecture exists to prevent. Dirty rows are skipped here and
 * resolved where they should be: when the outbox pushes them and the server
 * accepts or rejects the write.
 *
 * Clean rows have no local changes to lose, so the server wins on updated_at.
 * This is why `version` does not appear below — it is for optimistic
 * concurrency on the push side, not the pull side, and biometrics and
 * check-ins therefore need no rule of their own.
 *
 * WATERMARKS: per table, in sync_state. The filter is `>=` rather than `>` on
 * purpose. A `>` filter skips any row sharing the last-seen timestamp, and
 * timestamp ties are common when a server writes a batch. `>=` re-fetches a
 * small overlap instead, which is free: every write here is an idempotent
 * upsert. Losing a row is unacceptable; fetching one twice is not a problem.
 *
 * The new watermark is the greatest updated_at actually received, never the
 * clock. Using `now` would silently skip rows written while the pull was in
 * flight.
 */

import { getDb } from './localdb';
import { supabase } from './supabase';
import { drainOutbox, type DrainResult } from './outbox';

const PAGE = 500;

type TableSpec = {
  table: string;
  /** Local columns to write. Anything else the server sends is ignored. */
  columns: string[];
  /** Unique column to resolve the upsert against. */
  conflictKey: string;
  /** Column to scope the query by client, or null for RLS-scoped/global data. */
  scopeColumn: string | null;
  /** Reference tables have no local edits, so no dirty guard. */
  hasDirty: boolean;
};

/**
 * Order matters: parents before children. A set that arrives before its
 * session would reference a row that does not exist yet, and exercises are
 * pulled first because sets point at them.
 */
const TABLES: TableSpec[] = [
  {
    table: 'exercises',
    columns: ['id', 'name', 'category', 'primary_muscles', 'video_url', 'updated_at'],
    conflictKey: 'id',
    scopeColumn: null, // Global reference data, shared across tenants.
    hasDirty: false,
  },
  {
    table: 'sessions',
    columns: [
      'id', 'client_generated_id', 'tenant_id', 'client_id', 'session_type',
      'status', 'scheduled_for', 'started_at', 'completed_at', 'duration_seconds',
      'parameters', 'source', 'location_id', 'perceived_exertion', 'client_notes',
      'version', 'updated_at', 'deleted_at',
    ],
    conflictKey: 'client_generated_id',
    scopeColumn: 'client_id',
    hasDirty: true,
  },
  {
    table: 'session_exercises',
    columns: [
      'id', 'client_generated_id', 'session_id', 'exercise_id', 'position',
      'substituted_from', 'target_sets', 'target_reps', 'rest_seconds',
      'updated_at', 'deleted_at',
    ],
    conflictKey: 'client_generated_id',
    scopeColumn: null, // No client_id column; the server's RLS scopes it.
    hasDirty: true,
  },
  {
    table: 'exercise_sets',
    columns: [
      'id', 'client_generated_id', 'session_exercise_id', 'set_number',
      'weight_kg', 'reps', 'duration_seconds', 'distance_m', 'rpe', 'is_warmup',
      'completed_at', 'updated_at', 'deleted_at',
    ],
    conflictKey: 'client_generated_id',
    scopeColumn: null, // As above.
    hasDirty: true,
  },
  {
    table: 'biometrics',
    columns: [
      'id', 'client_generated_id', 'client_id', 'recorded_on', 'metric',
      'value', 'source', 'updated_at',
    ],
    conflictKey: 'client_generated_id',
    scopeColumn: 'client_id',
    hasDirty: true,
  },
  {
    table: 'food_log_entries',
    columns: [
      'id', 'client_generated_id', 'client_id', 'logged_on', 'meal_slot',
      'logged_at', 'food_item_id', 'description', 'quantity', 'unit',
      'energy_kj', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'source',
      'updated_at', 'deleted_at',
    ],
    conflictKey: 'client_generated_id',
    scopeColumn: 'client_id',
    hasDirty: true,
  },
  {
    table: 'daily_checkins',
    columns: [
      'id', 'client_generated_id', 'client_id', 'checkin_date', 'energy',
      'sleep_quality', 'stress', 'motivation', 'soreness', 'note', 'updated_at',
    ],
    conflictKey: 'client_generated_id',
    scopeColumn: 'client_id',
    hasDirty: true,
  },
];

/** SQLite takes no objects and no booleans. Coerce once, here. */
function bind(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  // parameters, soreness and friends are JSON on the server, TEXT locally.
  return JSON.stringify(value);
}

async function getWatermark(table: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_pulled_at: string | null }>(
    `SELECT last_pulled_at FROM sync_state WHERE table_name = ?`,
    [table]
  );
  return row?.last_pulled_at ?? null;
}

async function setWatermark(table: string, at: string) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)
     ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
    [table, at]
  );
}

function upsertSql(spec: TableSpec): string {
  const cols = spec.columns;
  const placeholders = cols.map(() => '?').join(', ');

  // Never overwrite the conflict key with itself, and never touch `dirty`:
  // a pull must not mark a row clean that was never pushed.
  const assignments = cols
    .filter((c) => c !== spec.conflictKey)
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  const guards = [
    // The server only wins when it is genuinely newer. Equal timestamps mean
    // the row we already hold is the same row — the `>=` overlap re-delivering it.
    `excluded.updated_at > ${spec.table}.updated_at`,
  ];
  if (spec.hasDirty) guards.unshift(`${spec.table}.dirty = 0`);

  return `INSERT INTO ${spec.table} (${cols.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT(${spec.conflictKey}) DO UPDATE SET ${assignments}
          WHERE ${guards.join(' AND ')}`;
}

export type TablePullResult = {
  table: string;
  received: number;
  /** Rows a UNIQUE constraint other than the conflict key rejected. */
  skipped: number;
  watermark: string | null;
};

async function pullTable(spec: TableSpec, clientId: string): Promise<TablePullResult> {
  const db = await getDb();
  const since = await getWatermark(spec.table);

  let received = 0;
  let skipped = 0;
  let highWater = since;
  let offset = 0;

  const sql = upsertSql(spec);

  for (;;) {
    let query = supabase
      .from(spec.table)
      .select(spec.columns.join(','))
      .order('updated_at', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (spec.scopeColumn) query = query.eq(spec.scopeColumn, clientId);
    if (since) query = query.gte('updated_at', since);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (rows.length === 0) break;

    // One transaction per page. A page is small enough to redo, and this keeps
    // a long backfill from holding a single write lock for its whole duration.
    await db.withTransactionAsync(async () => {
      for (const row of rows) {
        try {
          await db.runAsync(sql, spec.columns.map((c) => bind(row[c])));
          received++;
        } catch {
          // A row can collide with a UNIQUE constraint that is not the conflict
          // key — biometrics carries UNIQUE(client_id, recorded_on, metric,
          // source) as well as its client_generated_id. Skipping one row is
          // correct; aborting the pull over it is not.
          skipped++;
        }

        const at = row.updated_at;
        if (typeof at === 'string' && (highWater == null || at > highWater)) {
          highWater = at;
        }
      }
    });

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // Only advance on success. A thrown error above leaves the watermark alone,
  // so the next run re-reads the same window rather than skipping it.
  if (highWater && highWater !== since) await setWatermark(spec.table, highWater);

  return { table: spec.table, received, skipped, watermark: highWater };
}

export type PullResult = {
  tables: TablePullResult[];
  received: number;
  skipped: number;
  /** Tables that could not be pulled at all, with the reason. */
  failures: string[];
};

/** Pull every table, in dependency order. */
export async function pullAll(clientId: string): Promise<PullResult> {
  const tables: TablePullResult[] = [];
  const failures: string[] = [];

  for (const spec of TABLES) {
    try {
      tables.push(await pullTable(spec, clientId));
    } catch (err: any) {
      // One table must not take the whole pull down with it. A table that does
      // not exist yet, or one whose policies deny reads, would otherwise mean a
      // client sees NOTHING sync — sessions included — because of a feature
      // they have never opened. The watermark is untouched, so the next run
      // retries the same window.
      failures.push(`${spec.table}: ${String(err?.message ?? err)}`);
    }
  }

  return {
    tables,
    failures,
    received: tables.reduce((n, t) => n + t.received, 0),
    skipped: tables.reduce((n, t) => n + t.skipped, 0),
  };
}

export type SyncResult = { push: DrainResult; pull: PullResult };

/**
 * Push, then pull. The order is not arbitrary: draining first means our own
 * writes are on the server before we ask what changed, so a round trip cannot
 * hand us a stale copy of a row we just edited and then refuse to apply it.
 */
export async function syncNow(clientId: string): Promise<SyncResult> {
  const push = await drainOutbox();
  const pull = await pullAll(clientId);
  return { push, pull };
}

/** Test hook — forces the next pull to re-read everything. */
export async function _resetWatermarks() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sync_state`);
}
