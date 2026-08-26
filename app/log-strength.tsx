/**
 * Strength logger.
 *
 * The screen a client uses mid-set, one-handed, with a barbell waiting. Two
 * rules follow from that and drive every decision below:
 *
 *   1. Logging a set is ONE tap after typing two numbers. No modal, no save
 *      dialog, no confirmation. The row lands in SQLite and the input clears.
 *   2. Last week's numbers are on screen before the client asks. That is the
 *      figure they are actually trying to beat, and it comes from the local
 *      store, so it renders in a basement with no signal.
 *
 * The session is created on mount and left in_progress. Walking away mid-workout
 * is normal behaviour, not an error — the sets are already saved, and the
 * session is finished when they say so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useIdentity } from '../src/lib/auth';
import { createSession, startSession, completeSession } from '../src/repositories/sessions';
import {
  addExercise, deleteSet, lastPerformance, listSessionExercises, logSet,
  searchExercises, sessionVolume,
  type Exercise, type LastPerformance, type LoggedExercise,
} from '../src/repositories/strength';
import { color, familyColor, radius, space, type as t } from '../src/theme';

const ACCENT = familyColor('training');

function fmtSets(p: LastPerformance): string {
  return p.sets
    .map((s) => `${s.weightKg ?? '-'}kg x ${s.reps ?? '-'}`)
    .join(', ');
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function LogStrengthScreen() {
  const { tenantId, clientId } = useIdentity();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionCgid, setSessionCgid] = useState<string | null>(null);
  const [logged, setLogged] = useState<LoggedExercise[]>([]);
  const [volume, setVolume] = useState(0);
  const [history, setHistory] = useState<Record<string, LastPerformance | null>>({});
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // A second render must not create a second session.
  const creating = useRef(false);

  useEffect(() => {
    if (creating.current) return;
    creating.current = true;

    (async () => {
      try {
        const s = await createSession({ tenantId, clientId, sessionType: 'strength' });
        await startSession(s.clientGeneratedId);
        setSessionId(s.id);
        setSessionCgid(s.clientGeneratedId);
      } catch (e: any) {
        setError(e?.message ?? 'Could not start this workout.');
      }
    })();
  }, [tenantId, clientId]);

  const reload = useCallback(async (id: string) => {
    const list = await listSessionExercises(id);
    setLogged(list);
    setVolume(await sessionVolume(id));

    // One history lookup per movement, only for movements not already resolved.
    for (const item of list) {
      const key = item.sessionExercise.exerciseId;
      if (key in history) continue;
      const prev = await lastPerformance(clientId, key);
      setHistory((h) => ({ ...h, [key]: prev }));
    }
  }, [clientId, history]);

  useEffect(() => {
    if (sessionId) void reload(sessionId);
    // reload is intentionally not a dependency: it changes identity whenever
    // `history` does, and re-running on that would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function pick(ex: Exercise) {
    if (!sessionId) return;
    setPicking(false);
    try {
      await addExercise({ sessionId, exerciseId: ex.id });
      await reload(sessionId);
    } catch (e: any) {
      setError(e?.message ?? 'Could not add that exercise.');
    }
  }

  async function finish() {
    if (!sessionCgid) return;
    setFinishing(true);
    try {
      await completeSession(sessionCgid);
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not finish this workout.');
      setFinishing(false);
    }
  }

  if (!sessionId) {
    return (
      <View style={s.boot}>
        {error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator color={ACCENT} />}
      </View>
    );
  }

  if (picking) {
    return <ExercisePicker onPick={pick} onCancel={() => setPicking(false)} />;
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={[s.eyebrow, { color: ACCENT }]}>STRENGTH</Text>
      <Text style={s.title}>Workout</Text>

      {volume > 0 && (
        <Text style={s.volume}>{Math.round(volume).toLocaleString()} kg volume</Text>
      )}

      {error && <Text style={s.error}>{error}</Text>}

      {logged.length === 0 && (
        <Text style={s.body}>
          Add your first movement. Every set is saved the moment you log it, with
          or without signal.
        </Text>
      )}

      {logged.map((item) => (
        <ExerciseBlock
          key={item.sessionExercise.clientGeneratedId}
          item={item}
          previous={history[item.sessionExercise.exerciseId] ?? null}
          onChanged={() => reload(sessionId)}
          onError={setError}
        />
      ))}

      <Pressable style={s.add} onPress={() => setPicking(true)}>
        <Text style={s.addText}>+ Add exercise</Text>
      </Pressable>

      <Pressable
        style={[s.primary, (finishing || logged.length === 0) && s.primaryDisabled]}
        onPress={finish}
        disabled={finishing || logged.length === 0}
      >
        {finishing
          ? <ActivityIndicator color={color.ground} />
          : <Text style={s.primaryText}>Finish workout</Text>}
      </Pressable>

      <Text style={s.note}>
        Leaving without finishing is fine. Your sets are saved; the workout stays
        open until you finish it.
      </Text>
    </ScrollView>
  );
}

function ExerciseBlock({
  item, previous, onChanged, onError,
}: {
  item: LoggedExercise;
  previous: LastPerformance | null;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rpe, setRpe] = useState('');
  const [warmup, setWarmup] = useState(false);

  const canLog = weight.trim() !== '' || reps.trim() !== '';

  async function log() {
    if (!canLog) return;
    const w = weight.trim() === '' ? null : Number(weight);
    const r = reps.trim() === '' ? null : Number(reps);
    const e = rpe.trim() === '' ? null : Number(rpe);

    if ((w != null && Number.isNaN(w)) || (r != null && Number.isNaN(r)) ||
        (e != null && Number.isNaN(e))) {
      onError('Weight, reps and RPE must be numbers.');
      return;
    }

    try {
      await logSet({
        sessionExerciseId: item.sessionExercise.id,
        weightKg: w, reps: r, rpe: e, isWarmup: warmup,
      });
      // Weight persists between sets — it usually does not change. Reps clear,
      // because they usually do.
      setReps('');
      setRpe('');
      onChanged();
    } catch (err: any) {
      onError(err?.message ?? 'Could not save that set.');
    }
  }

  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>
        {item.exercise?.name ?? item.sessionExercise.exerciseId}
      </Text>

      {previous ? (
        <Text style={s.previous}>
          Last time ({shortDate(previous.performedOn)}): {fmtSets(previous)}
        </Text>
      ) : (
        <Text style={s.previousNone}>First time logging this</Text>
      )}

      {item.sets.map((set) => (
        <Pressable
          key={set.clientGeneratedId}
          style={s.setRow}
          onLongPress={async () => {
            try {
              await deleteSet(set.clientGeneratedId);
              onChanged();
            } catch (err: any) {
              onError(err?.message ?? 'Could not remove that set.');
            }
          }}
        >
          <Text style={[s.setNum, set.isWarmup && s.setNumWarm]}>
            {set.isWarmup ? 'W' : ''}{set.setNumber}
          </Text>
          <Text style={s.setVal}>
            {set.weightKg ?? '-'} kg x {set.reps ?? '-'}
            {set.rpe != null ? `  @${set.rpe}` : ''}
          </Text>
        </Pressable>
      ))}

      <View style={s.entry}>
        <TextInput
          style={[s.entryInput, s.entryWide]}
          value={weight} onChangeText={setWeight}
          placeholder="kg" placeholderTextColor={color.textMuted}
          keyboardType="decimal-pad" inputMode="decimal"
        />
        <TextInput
          style={s.entryInput}
          value={reps} onChangeText={setReps}
          placeholder="reps" placeholderTextColor={color.textMuted}
          keyboardType="number-pad" inputMode="numeric"
        />
        <TextInput
          style={s.entryInput}
          value={rpe} onChangeText={setRpe}
          placeholder="RPE" placeholderTextColor={color.textMuted}
          keyboardType="decimal-pad" inputMode="decimal"
        />
        <Pressable
          style={[s.warm, warmup && s.warmOn]}
          onPress={() => setWarmup((v) => !v)}
        >
          <Text style={[s.warmText, warmup && s.warmTextOn]}>W</Text>
        </Pressable>
        <Pressable
          style={[s.logBtn, !canLog && s.primaryDisabled]}
          onPress={log}
          disabled={!canLog}
        >
          <Text style={s.logBtnText}>Log</Text>
        </Pressable>
      </View>

      <Text style={s.hint}>Long-press a set to remove it.</Text>
    </View>
  );
}

function ExercisePicker({
  onPick, onCancel,
}: {
  onPick: (e: Exercise) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exercise[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await searchExercises(query);
      if (!cancelled) setResults(r);
    })();
    return () => { cancelled = true; };
  }, [query]);

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[s.eyebrow, { color: ACCENT }]}>ADD</Text>
      <Text style={s.title}>Choose a movement</Text>

      <TextInput
        style={s.search}
        value={query} onChangeText={setQuery}
        placeholder="Search" placeholderTextColor={color.textMuted}
        autoCapitalize="none" autoCorrect={false}
      />

      {results === null && <ActivityIndicator color={ACCENT} style={{ marginTop: space.lg }} />}

      {results?.length === 0 && (
        <View style={s.block}>
          <Text style={s.blockTitle}>
            {query ? 'Nothing matches that' : 'No exercises on this device yet'}
          </Text>
          <Text style={s.body}>
            {query
              ? 'Try a shorter search.'
              : 'The exercise catalog arrives with your first sync. If you have never been online since installing, connect once and it will be here.'}
          </Text>
        </View>
      )}

      {results?.map((ex) => (
        <Pressable key={ex.id} style={s.pickRow} onPress={() => onPick(ex)}>
          <Text style={s.pickName}>{ex.name}</Text>
          {ex.primaryMuscles.length > 0 && (
            <Text style={s.pickMuscles}>{ex.primaryMuscles.join(', ')}</Text>
          )}
        </Pressable>
      ))}

      <Pressable style={s.cancel} onPress={onCancel}>
        <Text style={s.cancelText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.md },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.ground, padding: space.lg },

  eyebrow: { ...t.label, fontSize: 12 },
  title: { ...t.display, color: color.text, fontSize: 30 },
  volume: { ...t.data, color: ACCENT, fontSize: 15 },
  body: { ...t.body, color: color.textMuted, fontSize: 14, lineHeight: 20 },
  note: { ...t.body, color: color.textMuted, fontSize: 12, lineHeight: 18, marginTop: space.sm },
  hint: { ...t.body, color: color.textMuted, fontSize: 11 },
  error: { ...t.body, color: color.danger, fontSize: 14 },

  block: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  blockTitle: { ...t.label, color: color.text, fontSize: 16 },
  previous: { ...t.data, color: color.textMuted, fontSize: 12 },
  previousNone: { ...t.body, color: color.textMuted, fontSize: 12 },

  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: color.surfaceHigh,
    borderRadius: radius.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  setNum: { ...t.data, color: ACCENT, fontSize: 13, minWidth: 24 },
  setNumWarm: { color: color.textMuted },
  setVal: { ...t.data, color: color.text, fontSize: 15 },

  entry: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  entryInput: {
    ...t.data,
    flex: 1,
    backgroundColor: color.surfaceHigh,
    borderRadius: radius.sm,
    color: color.text, fontSize: 15,
    paddingHorizontal: space.sm, paddingVertical: space.sm,
    textAlign: 'center',
  },
  entryWide: { flex: 1.3 },

  warm: {
    width: 34, paddingVertical: space.sm,
    borderRadius: radius.sm, alignItems: 'center',
    borderWidth: 1, borderColor: color.line,
  },
  warmOn: { backgroundColor: color.emberDim, borderColor: ACCENT },
  warmText: { ...t.label, color: color.textMuted, fontSize: 12 },
  warmTextOn: { color: ACCENT },

  logBtn: {
    backgroundColor: ACCENT, borderRadius: radius.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  logBtnText: { ...t.label, color: color.ground, fontSize: 14 },

  add: {
    borderColor: color.line, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center',
  },
  addText: { ...t.label, color: color.text, fontSize: 15 },

  primary: {
    backgroundColor: ACCENT, borderRadius: radius.md,
    paddingVertical: space.md, alignItems: 'center', marginTop: space.sm,
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { ...t.label, color: color.ground, fontSize: 16 },

  search: {
    ...t.body,
    backgroundColor: color.surface, borderColor: color.line, borderWidth: 1,
    borderRadius: radius.md, color: color.text, fontSize: 16,
    paddingHorizontal: space.md, paddingVertical: space.md,
  },
  pickRow: {
    backgroundColor: color.surface, borderRadius: radius.sm,
    paddingHorizontal: space.md, paddingVertical: space.md, gap: 2,
  },
  pickName: { ...t.body, color: color.text, fontSize: 16 },
  pickMuscles: { ...t.body, color: color.textMuted, fontSize: 12 },

  cancel: { alignItems: 'center', paddingVertical: space.md, marginTop: space.sm },
  cancelText: { ...t.body, color: color.textMuted, fontSize: 15 },
});
