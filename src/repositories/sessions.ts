/**
 * Sessions repository. The only path components use to touch session data.
 *
 * Every function here returns from SQLite. None of them await the network.
 */

import * as Crypto from 'expo-crypto';
import { getDb } from '../lib/localdb';
import { enqueue } from '../lib/outbox';
import { dayOffset, today } from '../lib/day';
import {
  MAX_SESSION_SECONDS,
  SESSION_TYPES,
  type Session,
  type SessionStatus,
  type SessionTypeKey,
} from '../types/sessions';

function newId() {
  return Crypto.randomUUID();
}

function rowToSession(r: any): Session {
  return {
    id: r.id,
    clientGeneratedId: r.client_generated_id,
    tenantId: r.tenant_id,
    clientId: r.client_id,
    sessionType: r.session_type,
    status: r.status,
    scheduledFor: r.scheduled_for,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationSeconds: r.duration_seconds,
    parameters: JSON.parse(r.parameters ?? '{}'),
    source: r.source,
    locationId: r.location_id,
    perceivedExertion: r.perceived_exertion,
    clientNotes: r.client_notes,
    version: r.version,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function validateParameters(
  sessionType: SessionTypeKey,
  parameters: Record<string, unknown>
) {
  const def = SESSION_TYPES[sessionType];
  for (const field of def.parameters) {
    if (!field.required) continue;
    const v = parameters[field.key];
    if (v === undefined || v === null || v === '') {
      throw new Error(`${def.label} requires ${field.label.toLowerCase()}`);
    }
  }
}

export async function createSession(input: {
  tenantId: string;
  clientId: string;
  sessionType: SessionTypeKey;
  parameters?: Record<string, unknown>;
  scheduledFor?: string;
  source?: Session['source'];
  locationId?: string | null;
}): Promise<Session> {
  const parameters = input.parameters ?? {};
  validateParameters(input.sessionType, parameters);

  const db = await getDb();
  const id = newId();
  const clientGeneratedId = newId();
  const now = new Date().toISOString();

  const row = {
    id,
    client_generated_id: clientGeneratedId,
    tenant_id: input.tenantId,
    client_id: input.clientId,
    session_type: input.sessionType,
    status: 'planned' as SessionStatus,
    // Local day, not now.slice(0,10): that is the UTC date, which is
    // tomorrow for anyone west of Greenwich in the evening.
    scheduled_for: input.scheduledFor ?? today(),
    started_at: null,
    completed_at: null,
    duration_seconds: null,
    parameters: JSON.stringify(parameters),
    source: input.source ?? 'manual',
    location_id: input.locationId ?? null,
    perceived_exertion: null,
    client_notes: null,
    version: 1,
    updated_at: now,
    deleted_at: null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sessions
        (id, client_generated_id, tenant_id, client_id, session_type, status,
         scheduled_for, started_at, completed_at, duration_seconds, parameters,
         source, location_id, perceived_exertion, client_notes, version,
         updated_at, deleted_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        row.id, row.client_generated_id, row.tenant_id, row.client_id,
        row.session_type, row.status, row.scheduled_for, row.started_at,
        row.completed_at, row.duration_seconds, row.parameters, row.source,
        row.location_id, row.perceived_exertion, row.client_notes,
        row.version, row.updated_at, row.deleted_at,
      ]
    );
    await enqueue(db, {
      table: 'sessions',
      rowId: id,
      clientGeneratedId,
      operation: 'upsert',
      payload: { ...row, parameters },
    });
  });

  return rowToSession({ ...row });
}

export async function startSession(clientGeneratedId: string) {
  await patchSession(clientGeneratedId, {
    status: 'in_progress',
    started_at: new Date().toISOString(),
  });
}

export async function completeSession(
  clientGeneratedId: string,
  opts: { durationSeconds?: number; perceivedExertion?: number; notes?: string } = {}
) {
  const db = await getDb();
  const [existing] = await db.getAllAsync<any>(
    `SELECT started_at FROM sessions WHERE client_generated_id = ?`,
    [clientGeneratedId]
  );

  const completedAt = new Date().toISOString();
  let duration = opts.durationSeconds;

  if (duration == null && existing?.started_at) {
    duration = Math.round(
      (Date.parse(completedAt) - Date.parse(existing.started_at)) / 1000
    );
  }

  // Spec D3: nothing runs for 18 hours. The phone slept, or the user forgot.
  // Cap it rather than writing a value the server will reject.
  if (duration != null && duration > MAX_SESSION_SECONDS) {
    duration = MAX_SESSION_SECONDS;
  }

  await patchSession(clientGeneratedId, {
    status: 'completed',
    completed_at: completedAt,
    duration_seconds: duration ?? null,
    perceived_exertion: opts.perceivedExertion ?? null,
    client_notes: opts.notes ?? null,
  });
}

async function patchSession(
  clientGeneratedId: string,
  patch: Record<string, unknown>
) {
  const db = await getDb();
  const now = new Date().toISOString();
  const keys = Object.keys(patch);
  const setSql = keys.map((k) => `${k} = ?`).join(', ');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE sessions
          SET ${setSql}, updated_at = ?, version = version + 1, dirty = 1
        WHERE client_generated_id = ?`,
      [...keys.map((k) => patch[k] as any), now, clientGeneratedId]
    );

    const [row] = await db.getAllAsync<any>(
      `SELECT * FROM sessions WHERE client_generated_id = ?`,
      [clientGeneratedId]
    );

    const { dirty, ...payload } = row;
    await enqueue(db, {
      table: 'sessions',
      rowId: row.id,
      clientGeneratedId,
      operation: 'upsert',
      payload: { ...payload, parameters: JSON.parse(row.parameters ?? '{}') },
    });
  });
}

export async function listSessions(opts: {
  clientId: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<Session[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM sessions
      WHERE client_id = ?
        AND deleted_at IS NULL
        AND (? IS NULL OR scheduled_for >= ?)
        AND (? IS NULL OR scheduled_for <= ?)
      ORDER BY scheduled_for DESC, updated_at DESC
      LIMIT ?`,
    [
      opts.clientId,
      opts.from ?? null, opts.from ?? null,
      opts.to ?? null, opts.to ?? null,
      opts.limit ?? 200,
    ]
  );
  return rows.map(rowToSession);
}

/**
 * Training load vs recovery load — the view no competitor has (spec I12).
 * Runs entirely locally, so it renders instantly and works on a plane.
 */
export async function loadBalance(clientId: string, days = 28) {
  const db = await getDb();
  const since = dayOffset(-days);

  const rows = await db.getAllAsync<{
    scheduled_for: string;
    session_type: SessionTypeKey;
    duration_seconds: number | null;
  }>(
    `SELECT scheduled_for, session_type, duration_seconds
       FROM sessions
      WHERE client_id = ? AND status = 'completed'
        AND deleted_at IS NULL AND scheduled_for >= ?`,
    [clientId, since]
  );

  const byDay = new Map<string, { training: number; recovery: number }>();
  for (const r of rows) {
    const family = SESSION_TYPES[r.session_type].family;
    if (family === 'passive') continue;
    const day = byDay.get(r.scheduled_for) ?? { training: 0, recovery: 0 };
    const minutes = (r.duration_seconds ?? 0) / 60;
    if (family === 'training') day.training += minutes;
    else day.recovery += minutes;
    byDay.set(r.scheduled_for, day);
  }

  return [...byDay.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
