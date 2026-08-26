/**
 * Pending and stuck writes.
 *
 * The screen that exists so the outbox's promise is real. outbox.ts parks a
 * write after twelve failed attempts rather than deleting it, on the grounds
 * that a user's data is never ours to discard. That promise is worth nothing
 * if the parked rows are invisible — the data would be "kept" in a table
 * nobody can see, which is indistinguishable from lost.
 *
 * So: show the count, name what failed and why, and give one honest button.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { getStuckWrites, retryStuckWrites, type StuckWrite } from '../../src/lib/outbox';
import { useSync } from '../../src/lib/syncRunner';
import { color, radius, space, type as t } from '../../src/theme';

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PendingWritesScreen() {
  const { phase, pending, online, lastError, lastSyncedAt, sync, refreshPending } = useSync();
  const [stuck, setStuck] = useState<StuckWrite[] | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setStuck(await getStuckWrites());
    await refreshPending();
  }, [refreshPending]);

  useEffect(() => { void load(); }, [load]);

  async function retry() {
    setRetrying(true);
    try {
      await retryStuckWrites();
      // force: the throttle exists to stop background churn, not to ignore
      // someone who just pressed a button.
      await sync({ force: true });
      await load();
    } finally {
      setRetrying(false);
    }
  }

  const busy = phase === 'syncing' || retrying;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={load} tintColor={color.textMuted} />
      }
    >
      <Text style={s.eyebrow}>SYNC</Text>
      <Text style={s.title}>Waiting to send</Text>

      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.rowLabel}>In the queue</Text>
          <Text style={s.rowValue}>{pending}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>Connection</Text>
          <Text style={[s.rowValue, { color: online ? color.positive : color.warning }]}>
            {online ? 'online' : 'offline'}
          </Text>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>Last synced</Text>
          <Text style={s.rowValue}>
            {lastSyncedAt ? ago(new Date(lastSyncedAt).toISOString()) : 'not yet'}
          </Text>
        </View>
      </View>

      <Text style={s.body}>
        Everything you log is saved on this device the moment you save it. The
        queue is only about getting it to your coach — nothing here is at risk
        of being lost.
      </Text>

      {lastError && <Text style={s.error}>{lastError}</Text>}

      {stuck === null ? (
        <ActivityIndicator color={color.ice} style={{ marginTop: space.lg }} />
      ) : stuck.length === 0 ? (
        <View style={s.card}>
          <Text style={s.ok}>Nothing is stuck.</Text>
          <Text style={s.body}>
            {pending > 0
              ? 'The queue is draining normally.'
              : 'Everything has reached your coach.'}
          </Text>
        </View>
      ) : (
        <>
          <Text style={s.sectionTitle}>
            {stuck.length} {stuck.length === 1 ? 'write has' : 'writes have'} stopped retrying
          </Text>
          <Text style={s.body}>
            These gave up after repeated failures. They are still on your device.
            Retrying is safe — a replayed write cannot create a duplicate.
          </Text>

          {stuck.map((w) => (
            <View key={w.seq} style={s.stuckCard}>
              <View style={s.row}>
                <Text style={s.stuckTable}>{w.table_name}</Text>
                <Text style={s.stuckAge}>{ago(w.created_at)}</Text>
              </View>
              <Text style={s.stuckMeta}>
                {w.operation} · {w.attempts} attempts
              </Text>
              {w.last_error && <Text style={s.stuckError}>{w.last_error}</Text>}
            </View>
          ))}
        </>
      )}

      <Pressable style={[s.primary, busy && s.primaryDisabled]} onPress={retry} disabled={busy}>
        {busy
          ? <ActivityIndicator color={color.ground} />
          : <Text style={s.primaryText}>
              {stuck && stuck.length > 0 ? 'Retry everything now' : 'Sync now'}
            </Text>}
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.md },

  eyebrow: { ...t.label, color: color.ice, fontSize: 12 },
  title: { ...t.display, color: color.text, fontSize: 30, marginBottom: space.sm },
  sectionTitle: { ...t.label, color: color.text, fontSize: 15, marginTop: space.md },

  body: { ...t.body, color: color.textMuted, fontSize: 14, lineHeight: 20 },
  ok: { ...t.label, color: color.positive, fontSize: 15, marginBottom: space.xs },
  error: { ...t.body, color: color.danger, fontSize: 14 },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...t.body, color: color.textMuted, fontSize: 14 },
  rowValue: { ...t.data, color: color.text, fontSize: 15 },

  stuckCard: {
    backgroundColor: color.surface,
    borderLeftColor: color.warning,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.xs,
  },
  stuckTable: { ...t.label, color: color.text, fontSize: 14 },
  stuckAge: { ...t.data, color: color.textMuted, fontSize: 12 },
  stuckMeta: { ...t.data, color: color.textMuted, fontSize: 12 },
  stuckError: { ...t.body, color: color.warning, fontSize: 13, lineHeight: 18 },

  primary: {
    backgroundColor: color.ice,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.lg,
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { ...t.label, color: color.ground, fontSize: 16 },
});
