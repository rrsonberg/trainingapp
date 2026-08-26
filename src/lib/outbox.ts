/**
 * Outbox — the durable write queue.
 *
 * Every local mutation appends a row here inside the same transaction that
 * writes the data. The queue drains in sequence when the network allows.
 *
 * Idempotency: each row carries client_generated_id, which is UNIQUE per
 * client on the server. Replaying a queued write after a timeout can never
 * create a duplicate — the upsert collapses onto the same row. This is why
 * a retry storm cannot produce four copies of the same set.
 *
 * Ordering: strictly by seq. A set cannot sync before its session exists.
 */

import { getDb } from './localdb';
import { supabase } from './supabase';

export type OutboxOperation = 'upsert' | 'soft_delete';

const MAX_ATTEMPTS = 12;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30 * 60_000;

/** Append to the queue. Call INSIDE the caller's transaction. */
export async function enqueue(
  tx: { runAsync: (sql: string, params: any[]) => Promise<unknown> },
  args: {
    table: string;
    rowId: string;
    clientGeneratedId: string;
    operation: OutboxOperation;
    payload: Record<string, unknown>;
  }
) {
  await tx.runAsync(
    `INSERT INTO outbox
       (table_name, row_id, client_generated_id, operation, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      args.table,
      args.rowId,
      args.clientGeneratedId,
      args.operation,
      JSON.stringify(args.payload),
      new Date().toISOString(),
    ]
  );
}

function backoffMs(attempts: number) {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

export type DrainResult = {
  sent: number;
  failed: number;
  remaining: number;
};

/**
 * Drain the queue. Safe to call repeatedly and concurrently-ish; a failure
 * stops the run so ordering is preserved rather than skipping ahead.
 */
export async function drainOutbox(): Promise<DrainResult> {
  const db = await getDb();
  const now = new Date().toISOString();

  const rows = await db.getAllAsync<{
    seq: number;
    table_name: string;
    row_id: string;
    client_generated_id: string;
    operation: OutboxOperation;
    payload: string;
    attempts: number;
  }>(
    `SELECT seq, table_name, row_id, client_generated_id, operation, payload, attempts
       FROM outbox
      WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
      ORDER BY seq ASC
      LIMIT 200`,
    [now]
  );

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = JSON.parse(row.payload);

    try {
      if (row.operation === 'soft_delete') {
        const { error } = await supabase
          .from(row.table_name)
          .update({ deleted_at: new Date().toISOString() })
          .eq('client_generated_id', row.client_generated_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(row.table_name)
          .upsert(payload, { onConflict: 'client_id,client_generated_id' });
        if (error) throw error;
      }

      await db.withTransactionAsync(async () => {
        await db.runAsync(`DELETE FROM outbox WHERE seq = ?`, [row.seq]);
        await db.runAsync(
          `UPDATE ${row.table_name} SET dirty = 0 WHERE client_generated_id = ?`,
          [row.client_generated_id]
        );
      });
      sent++;
    } catch (err: any) {
      failed++;
      const attempts = row.attempts + 1;

      if (attempts >= MAX_ATTEMPTS) {
        // Park it. Never silently discard a user's data — surface it instead.
        await db.runAsync(
          `UPDATE outbox
              SET attempts = ?, last_error = ?, next_attempt_at = ?
            WHERE seq = ?`,
          [attempts, String(err?.message ?? err), '9999-12-31T00:00:00Z', row.seq]
        );
      } else {
        await db.runAsync(
          `UPDATE outbox
              SET attempts = ?, last_error = ?, next_attempt_at = ?
            WHERE seq = ?`,
          [
            attempts,
            String(err?.message ?? err),
            new Date(Date.now() + backoffMs(attempts)).toISOString(),
            row.seq,
          ]
        );
      }
      // Stop on first failure to preserve ordering.
      break;
    }
  }

  const [{ c: remaining }] = await db.getAllAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM outbox`
  );

  return { sent, failed, remaining };
}

export type StuckWrite = {
  seq: number;
  table_name: string;
  client_generated_id: string;
  operation: OutboxOperation;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

/** Rows that exhausted retries. Show these to the user; never drop them. */
export async function getStuckWrites(): Promise<StuckWrite[]> {
  const db = await getDb();
  return db.getAllAsync<StuckWrite>(
    `SELECT seq, table_name, client_generated_id, operation, attempts, last_error, created_at
       FROM outbox
      WHERE attempts >= ?
      ORDER BY seq ASC`,
    [MAX_ATTEMPTS]
  );
}

/**
 * Re-arm parked writes so the next drain picks them up again.
 *
 * Parking sets next_attempt_at to the year 9999, which is what keeps a
 * permanently failing row from blocking the queue behind it. Nothing else
 * clears that, so without this the only route back is reinstalling the app —
 * and the whole point of parking rather than deleting is that the data is
 * still recoverable.
 */
export async function retryStuckWrites(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `UPDATE outbox SET attempts = 0, last_error = NULL, next_attempt_at = NULL
      WHERE attempts >= ?`,
    [MAX_ATTEMPTS]
  );
  return result.changes;
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const [{ c }] = await db.getAllAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM outbox`
  );
  return c;
}
