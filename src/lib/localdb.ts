/**
 * Local store. THE APP READS FROM HERE, ALWAYS.
 *
 * This is the architectural decision that cannot be retrofitted. The UI never
 * awaits the network to display or accept data. Every write lands in SQLite
 * first and is replayed to Supabase by the outbox. That single rule is what
 * satisfies spec A2, A3, A4 and D1 — no frozen screens, no blank launches,
 * no lost sets when the app is killed mid-workout.
 *
 * If you find yourself writing `await supabase.from(...)` inside a component,
 * stop. That is the bug we exist to avoid.
 */

import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS sessions (
  id                    TEXT PRIMARY KEY,
  client_generated_id   TEXT NOT NULL UNIQUE,
  tenant_id             TEXT NOT NULL,
  client_id             TEXT NOT NULL,
  session_type          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'planned',
  scheduled_for         TEXT,
  started_at            TEXT,
  completed_at          TEXT,
  duration_seconds      INTEGER,
  parameters            TEXT NOT NULL DEFAULT '{}',
  source                TEXT NOT NULL DEFAULT 'manual',
  location_id           TEXT,
  perceived_exertion    INTEGER,
  client_notes          TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,
  -- 0 = confirmed by server, 1 = local change awaiting sync
  dirty                 INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_scheduled
  ON sessions (scheduled_for DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_dirty ON sessions (dirty) WHERE dirty = 1;

CREATE TABLE IF NOT EXISTS session_exercises (
  id                  TEXT PRIMARY KEY,
  client_generated_id TEXT NOT NULL UNIQUE,
  session_id          TEXT NOT NULL,
  exercise_id         TEXT NOT NULL,
  position            INTEGER NOT NULL,
  substituted_from    TEXT,
  target_sets         INTEGER,
  target_reps         TEXT,
  rest_seconds        INTEGER,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  dirty               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exercise_sets (
  id                  TEXT PRIMARY KEY,
  client_generated_id TEXT NOT NULL UNIQUE,
  session_exercise_id TEXT NOT NULL,
  set_number          INTEGER NOT NULL,
  weight_kg           REAL,
  reps                INTEGER,
  duration_seconds    INTEGER,
  distance_m          REAL,
  rpe                 REAL,
  is_warmup           INTEGER NOT NULL DEFAULT 0,
  completed_at        TEXT,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  dirty               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exercises (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT,
  primary_muscles TEXT,
  video_url       TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS biometrics (
  id                  TEXT PRIMARY KEY,
  client_generated_id TEXT NOT NULL UNIQUE,
  client_id           TEXT NOT NULL,
  recorded_on         TEXT NOT NULL,
  metric              TEXT NOT NULL,
  value               REAL NOT NULL,
  source              TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  dirty               INTEGER NOT NULL DEFAULT 0,
  UNIQUE (client_id, recorded_on, metric, source)
);

CREATE TABLE IF NOT EXISTS daily_checkins (
  id                  TEXT PRIMARY KEY,
  client_generated_id TEXT NOT NULL UNIQUE,
  client_id           TEXT NOT NULL,
  checkin_date        TEXT NOT NULL UNIQUE,
  energy              INTEGER,
  sleep_quality       INTEGER,
  stress              INTEGER,
  motivation          INTEGER,
  soreness            TEXT NOT NULL DEFAULT '{}',
  note                TEXT,
  updated_at          TEXT NOT NULL,
  dirty               INTEGER NOT NULL DEFAULT 0
);

/* The outbox. Every local mutation is appended here and replayed in order. */
CREATE TABLE IF NOT EXISTS outbox (
  seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name          TEXT NOT NULL,
  row_id              TEXT NOT NULL,
  client_generated_id TEXT NOT NULL,
  operation           TEXT NOT NULL,
  payload             TEXT NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  next_attempt_at     TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  table_name    TEXT PRIMARY KEY,
  last_pulled_at TEXT
);
`;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('coach.db');
  await db.execAsync(SCHEMA);
  return db;
}

/** Test hook — never call in app code. */
export async function _resetLocalDb() {
  const d = await getDb();
  await d.execAsync(`
    DELETE FROM sessions; DELETE FROM session_exercises; DELETE FROM exercise_sets;
    DELETE FROM biometrics; DELETE FROM daily_checkins;
    DELETE FROM outbox; DELETE FROM sync_state;
  `);
}
