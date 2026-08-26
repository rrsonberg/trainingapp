/**
 * Strength repository — session_exercises and exercise_sets.
 *
 * Same contract as sessions.ts: every function returns from SQLite, none of
 * them await the network, every mutation enqueues in the same transaction that
 * writes the row.
 *
 * The set is the unit that matters. A client finishes a set, taps once, and
 * the number is on disk before their thumb leaves the screen — mid-workout is
 * exactly when the network is worst and exactly when losing a rep is least
 * forgivable. Nothing in here is allowed to be slower than that.
 */

import * as Crypto from 'expo-crypto';
import { getDb } from '../lib/localdb';
import { enqueue } from '../lib/outbox';

function newId() {
  return Crypto.randomUUID();
}

export type SessionExercise = {
  id: string;
  clientGeneratedId: string;
  sessionId: string;
  exerciseId: string;
  position: number;
  substitutedFrom: string | null;
  targetSets: number | null;
  targetReps: string | null;
  restSeconds: number | null;
  updatedAt: string;
};

export type ExerciseSet = {
  id: string;
  clientGeneratedId: string;
  sessionExerciseId: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  rpe: number | null;
  isWarmup: boolean;
  completedAt: string | null;
  updatedAt: string;
};

export type Exercise = {
  id: string;
  name: string;
  category: string | null;
  primaryMuscles: string[];
  videoUrl: string | null;
};

function rowToSessionExercise(r: any): SessionExercise {
  return {
    id: r.id,
    clientGeneratedId: r.client_generated_id,
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    position: r.position,
    substitutedFrom: r.substituted_from,
    targetSets: r.target_sets,
    targetReps: r.target_reps,
    restSeconds: r.rest_seconds,
    updatedAt: r.updated_at,
  };
}

function rowToSet(r: any): ExerciseSet {
  return {
    id: r.id,
    clientGeneratedId: r.client_generated_id,
    sessionExerciseId: r.session_exercise_id,
    setNumber: r.set_number,
    weightKg: r.weight_kg,
    reps: r.reps,
    durationSeconds: r.duration_seconds,
    distanceM: r.distance_m,
    rpe: r.rpe,
    isWarmup: r.is_warmup === 1,
    completedAt: r.completed_at,
    updatedAt: r.updated_at,
  };
}

function rowToExercise(r: any): Exercise {
  let muscles: string[] = [];
  if (r.primary_muscles) {
    try {
      const parsed = JSON.parse(r.primary_muscles);
      muscles = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Server may store a plain comma list rather than JSON. Either is fine.
      muscles = String(r.primary_muscles).split(',').map((m: string) => m.trim()).filter(Boolean);
    }
  }
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    primaryMuscles: muscles,
    videoUrl: r.video_url,
  };
}

/** The exercise catalog. Pulled from the server; read-only on the client. */
export async function searchExercises(query: string, limit = 40): Promise<Exercise[]> {
  const db = await getDb();
  const q = query.trim();
  const rows = q
    ? await db.getAllAsync<any>(
        `SELECT * FROM exercises WHERE name LIKE ? ORDER BY name LIMIT ?`,
        [`%${q}%`, limit]
      )
    : await db.getAllAsync<any>(`SELECT * FROM exercises ORDER BY name LIMIT ?`, [limit]);
  return rows.map(rowToExercise);
}

export async function exerciseById(id: string): Promise<Exercise | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<any>(`SELECT * FROM exercises WHERE id = ?`, [id]);
  return r ? rowToExercise(r) : null;
}

export async function addExercise(input: {
  sessionId: string;
  exerciseId: string;
  position?: number;
  targetSets?: number | null;
  targetReps?: string | null;
  restSeconds?: number | null;
}): Promise<SessionExercise> {
  const db = await getDb();
  const id = newId();
  const clientGeneratedId = newId();
  const now = new Date().toISOString();

  // Append by default. Callers reordering a plan pass position explicitly.
  let position = input.position;
  if (position == null) {
    const r = await db.getFirstAsync<{ next: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next
         FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL`,
      [input.sessionId]
    );
    position = r?.next ?? 0;
  }

  const row = {
    id,
    client_generated_id: clientGeneratedId,
    session_id: input.sessionId,
    exercise_id: input.exerciseId,
    position,
    substituted_from: null as string | null,
    target_sets: input.targetSets ?? null,
    target_reps: input.targetReps ?? null,
    rest_seconds: input.restSeconds ?? null,
    updated_at: now,
    deleted_at: null as string | null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO session_exercises
         (id, client_generated_id, session_id, exercise_id, position,
          substituted_from, target_sets, target_reps, rest_seconds,
          updated_at, deleted_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        row.id, row.client_generated_id, row.session_id, row.exercise_id,
        row.position, row.substituted_from, row.target_sets, row.target_reps,
        row.rest_seconds, row.updated_at, row.deleted_at,
      ]
    );
    await enqueue(db, {
      table: 'session_exercises',
      rowId: id,
      clientGeneratedId,
      operation: 'upsert',
      payload: row,
    });
  });

  return rowToSessionExercise(row);
}

export async function logSet(input: {
  sessionExerciseId: string;
  setNumber?: number;
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  isWarmup?: boolean;
}): Promise<ExerciseSet> {
  const db = await getDb();
  const id = newId();
  const clientGeneratedId = newId();
  const now = new Date().toISOString();

  // Warm-ups do not advance the working-set count — a client reading "set 3"
  // wants their third working set, not their third time under the bar.
  let setNumber = input.setNumber;
  if (setNumber == null) {
    const r = await db.getFirstAsync<{ next: number }>(
      `SELECT COALESCE(MAX(set_number), 0) + 1 AS next
         FROM exercise_sets
        WHERE session_exercise_id = ? AND deleted_at IS NULL AND is_warmup = ?`,
      [input.sessionExerciseId, input.isWarmup ? 1 : 0]
    );
    setNumber = r?.next ?? 1;
  }

  const row = {
    id,
    client_generated_id: clientGeneratedId,
    session_exercise_id: input.sessionExerciseId,
    set_number: setNumber,
    weight_kg: input.weightKg ?? null,
    reps: input.reps ?? null,
    duration_seconds: input.durationSeconds ?? null,
    distance_m: input.distanceM ?? null,
    rpe: input.rpe ?? null,
    is_warmup: input.isWarmup ? 1 : 0,
    // Stamped here, not on save-to-server: the set happened when the client
    // tapped, not whenever the network next cooperated.
    completed_at: now,
    updated_at: now,
    deleted_at: null as string | null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO exercise_sets
         (id, client_generated_id, session_exercise_id, set_number, weight_kg,
          reps, duration_seconds, distance_m, rpe, is_warmup, completed_at,
          updated_at, deleted_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        row.id, row.client_generated_id, row.session_exercise_id, row.set_number,
        row.weight_kg, row.reps, row.duration_seconds, row.distance_m, row.rpe,
        row.is_warmup, row.completed_at, row.updated_at, row.deleted_at,
      ]
    );
    await enqueue(db, {
      table: 'exercise_sets',
      rowId: id,
      clientGeneratedId,
      operation: 'upsert',
      payload: row,
    });
  });

  return rowToSet(row);
}

export async function updateSet(
  clientGeneratedId: string,
  patch: Partial<Pick<ExerciseSet, 'weightKg' | 'reps' | 'rpe' | 'durationSeconds' | 'distanceM'>>
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  const map: Record<string, string> = {
    weightKg: 'weight_kg', reps: 'reps', rpe: 'rpe',
    durationSeconds: 'duration_seconds', distanceM: 'distance_m',
  };

  const cols: string[] = [];
  const values: (number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (!col) continue;
    cols.push(`${col} = ?`);
    values.push((v as number | null) ?? null);
  }
  if (cols.length === 0) return;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE exercise_sets SET ${cols.join(', ')}, updated_at = ?, dirty = 1
        WHERE client_generated_id = ?`,
      [...values, now, clientGeneratedId]
    );
    const row = await db.getFirstAsync<any>(
      `SELECT * FROM exercise_sets WHERE client_generated_id = ?`,
      [clientGeneratedId]
    );
    if (!row) throw new Error('That set is no longer on this device.');
    const { dirty, ...payload } = row;
    await enqueue(db, {
      table: 'exercise_sets',
      rowId: row.id,
      clientGeneratedId,
      operation: 'upsert',
      payload,
    });
  });
}

/** Soft delete. The row stays so the server learns about the deletion. */
export async function deleteSet(clientGeneratedId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<any>(
      `SELECT id FROM exercise_sets WHERE client_generated_id = ?`,
      [clientGeneratedId]
    );
    if (!row) return;
    await db.runAsync(
      `UPDATE exercise_sets SET deleted_at = ?, updated_at = ?, dirty = 1
        WHERE client_generated_id = ?`,
      [now, now, clientGeneratedId]
    );
    await enqueue(db, {
      table: 'exercise_sets',
      rowId: row.id,
      clientGeneratedId,
      operation: 'soft_delete',
      payload: {},
    });
  });
}

export async function removeExercise(clientGeneratedId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<any>(
      `SELECT id FROM session_exercises WHERE client_generated_id = ?`,
      [clientGeneratedId]
    );
    if (!row) return;

    // Its sets go too, each enqueued in its own right — the server has no
    // cascade it can infer from a single parent delete.
    const sets = await db.getAllAsync<any>(
      `SELECT id, client_generated_id FROM exercise_sets
        WHERE session_exercise_id = ? AND deleted_at IS NULL`,
      [row.id]
    );
    for (const set of sets) {
      await db.runAsync(
        `UPDATE exercise_sets SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
        [now, now, set.id]
      );
      await enqueue(db, {
        table: 'exercise_sets',
        rowId: set.id,
        clientGeneratedId: set.client_generated_id,
        operation: 'soft_delete',
        payload: {},
      });
    }

    await db.runAsync(
      `UPDATE session_exercises SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [now, now, row.id]
    );
    await enqueue(db, {
      table: 'session_exercises',
      rowId: row.id,
      clientGeneratedId,
      operation: 'soft_delete',
      payload: {},
    });
  });
}

export type LoggedExercise = {
  sessionExercise: SessionExercise;
  exercise: Exercise | null;
  sets: ExerciseSet[];
};

/** Everything logged in one session, ready to render. */
export async function listSessionExercises(sessionId: string): Promise<LoggedExercise[]> {
  const db = await getDb();

  const exRows = await db.getAllAsync<any>(
    `SELECT * FROM session_exercises
      WHERE session_id = ? AND deleted_at IS NULL
      ORDER BY position ASC`,
    [sessionId]
  );

  const out: LoggedExercise[] = [];
  for (const r of exRows) {
    const setRows = await db.getAllAsync<any>(
      `SELECT * FROM exercise_sets
        WHERE session_exercise_id = ? AND deleted_at IS NULL
        ORDER BY is_warmup DESC, set_number ASC`,
      [r.id]
    );
    out.push({
      sessionExercise: rowToSessionExercise(r),
      exercise: await exerciseById(r.exercise_id),
      sets: setRows.map(rowToSet),
    });
  }
  return out;
}

export type LastPerformance = {
  performedOn: string;
  sets: ExerciseSet[];
};

/**
 * What they did last time on this movement.
 *
 * This is the single most useful number on a strength screen and the reason
 * the local store earns its keep: it is a two-table join against data already
 * on the phone, so it renders instantly in a basement with no signal. Fetching
 * it would make the most-looked-at figure in the app the least reliable.
 *
 * Warm-ups are excluded — nobody is trying to beat last week's warm-up.
 */
export async function lastPerformance(
  clientId: string,
  exerciseId: string
): Promise<LastPerformance | null> {
  const db = await getDb();

  const prev = await db.getFirstAsync<{ id: string; completed_at: string }>(
    `SELECT se.id AS id, s.completed_at AS completed_at
       FROM session_exercises se
       JOIN sessions s ON s.id = se.session_id
      WHERE se.exercise_id = ?
        AND s.client_id = ?
        AND s.status = 'completed'
        AND s.deleted_at IS NULL
        AND se.deleted_at IS NULL
      ORDER BY s.completed_at DESC
      LIMIT 1`,
    [exerciseId, clientId]
  );
  if (!prev) return null;

  const rows = await db.getAllAsync<any>(
    `SELECT * FROM exercise_sets
      WHERE session_exercise_id = ? AND deleted_at IS NULL AND is_warmup = 0
      ORDER BY set_number ASC`,
    [prev.id]
  );
  if (rows.length === 0) return null;

  return { performedOn: prev.completed_at, sets: rows.map(rowToSet) };
}

/** Working volume in kg, warm-ups excluded. */
export async function sessionVolume(sessionId: string): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ volume: number | null }>(
    `SELECT SUM(es.weight_kg * es.reps) AS volume
       FROM exercise_sets es
       JOIN session_exercises se ON se.id = es.session_exercise_id
      WHERE se.session_id = ?
        AND es.deleted_at IS NULL AND se.deleted_at IS NULL
        AND es.is_warmup = 0
        AND es.weight_kg IS NOT NULL AND es.reps IS NOT NULL`,
    [sessionId]
  );
  return r?.volume ?? 0;
}
