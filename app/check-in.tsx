/**
 * Daily check-in, and the readiness it produces.
 *
 * Four taps and you are done. The subjective scales are anchored to the client
 * themselves — 3 means "normal for me", not "average person" — because the
 * baseline everything else is measured against is theirs too.
 *
 * The score is shown WITH its components and its confidence, never alone. A
 * number a client cannot interrogate is a number they stop trusting the first
 * time it disagrees with how they feel, and then the whole feature is dead.
 * When there is too little data, this says so rather than inventing a figure.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useIdentity } from '../src/lib/auth';
import { checkinForDay, saveCheckin, today } from '../src/repositories/checkins';
import { BAND_COPY, computeReadiness, type Readiness } from '../src/lib/readiness';
import { color, radius, space, type as t } from '../src/theme';

const SCALES = [
  { key: 'energy', label: 'Energy', low: 'Drained', high: 'Fresh' },
  { key: 'sleepQuality', label: 'Sleep quality', low: 'Awful', high: 'Great' },
  { key: 'stress', label: 'Stress', low: 'Calm', high: 'Maxed' },
  { key: 'motivation', label: 'Motivation', low: 'None', high: 'Keen' },
] as const;

type ScaleKey = (typeof SCALES)[number]['key'];

function bandColor(band: Readiness['band']) {
  return band === 'hold' ? color.warning : band === 'push' ? color.positive : color.ice;
}

export default function CheckInScreen() {
  const { clientId } = useIdentity();
  const day = today();

  const [values, setValues] = useState<Partial<Record<ScaleKey, number>>>({});
  const [note, setNote] = useState('');
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setReadiness(await computeReadiness(clientId, day));
  }, [clientId, day]);

  useEffect(() => {
    (async () => {
      try {
        // Re-opening the screen shows what they already said today, not a
        // blank form that quietly overwrites it.
        const existing = await checkinForDay(clientId, day);
        if (existing) {
          setValues({
            energy: existing.energy ?? undefined,
            sleepQuality: existing.sleepQuality ?? undefined,
            stress: existing.stress ?? undefined,
            motivation: existing.motivation ?? undefined,
          });
          setNote(existing.note ?? '');
          setSaved(true);
        }
        await refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Could not load today.');
      } finally {
        setLoaded(true);
      }
    })();
  }, [clientId, day, refresh]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveCheckin({
        clientId,
        checkinDate: day,
        energy: values.energy ?? null,
        sleepQuality: values.sleepQuality ?? null,
        stress: values.stress ?? null,
        motivation: values.motivation ?? null,
        note: note.trim() === '' ? null : note.trim(),
      });
      setSaved(true);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save your check-in.');
    } finally {
      setSaving(false);
    }
  }

  const answered = Object.keys(values).length;

  if (!loaded) {
    return <View style={s.boot}><ActivityIndicator color={color.ice} /></View>;
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>TODAY</Text>
      <Text style={s.title}>Check in</Text>
      <Text style={s.body}>3 means normal for you — not average for anyone else.</Text>

      {error && <Text style={s.error}>{error}</Text>}

      {SCALES.map((scale) => (
        <View key={scale.key} style={s.scale}>
          <Text style={s.scaleLabel}>{scale.label}</Text>
          <View style={s.dots}>
            {[1, 2, 3, 4, 5].map((n) => {
              const active = values[scale.key] === n;
              return (
                <Pressable
                  key={n}
                  style={[s.dot, active && s.dotOn]}
                  onPress={() => {
                    setValues((v) => ({ ...v, [scale.key]: n }));
                    setSaved(false);
                  }}
                >
                  <Text style={[s.dotText, active && s.dotTextOn]}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={s.anchors}>
            <Text style={s.anchor}>{scale.low}</Text>
            <Text style={s.anchor}>{scale.high}</Text>
          </View>
        </View>
      ))}

      <TextInput
        style={s.note}
        value={note}
        onChangeText={(v) => { setNote(v); setSaved(false); }}
        placeholder="Anything your coach should know (optional)"
        placeholderTextColor={color.textMuted}
        multiline
      />

      <Pressable
        style={[s.primary, (saving || answered === 0) && s.primaryDisabled]}
        onPress={save}
        disabled={saving || answered === 0}
      >
        {saving
          ? <ActivityIndicator color={color.ground} />
          : <Text style={s.primaryText}>{saved ? 'Saved' : 'Save check-in'}</Text>}
      </Pressable>

      {readiness ? (
        <View style={[s.readiness, { borderLeftColor: bandColor(readiness.band) }]}>
          <Text style={s.readinessScore}>{readiness.score}</Text>
          <Text style={[s.readinessBand, { color: bandColor(readiness.band) }]}>
            {BAND_COPY[readiness.band].title}
          </Text>
          <Text style={s.body}>{BAND_COPY[readiness.band].body}</Text>

          <View style={s.divider} />

          {readiness.components.map((c) => (
            <View key={c.key} style={s.compRow}>
              <Text style={s.compLabel}>{c.label}</Text>
              <Text
                style={[
                  s.compValue,
                  { color: c.normalized > 0.1 ? color.positive
                         : c.normalized < -0.1 ? color.warning
                         : color.textMuted },
                ]}
              >
                {c.detail}
              </Text>
            </View>
          ))}

          <Text style={s.confidence}>
            {readiness.confidence} confidence · built from{' '}
            {Math.round(readiness.coverage * 100)}% of the signals
            {readiness.missing.length > 0 ? ` · missing ${readiness.missing.length}` : ''}
          </Text>
        </View>
      ) : (
        <View style={s.readinessEmpty}>
          <Text style={s.blockTitle}>No readiness score yet</Text>
          <Text style={s.body}>
            A score needs enough of your own history to compare against — at
            least two weeks of readings before a baseline means anything. Keep
            checking in and connect Apple Health, and it will appear on its own.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.md },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.ground },

  eyebrow: { ...t.label, color: color.ice, fontSize: 12 },
  title: { ...t.display, color: color.text, fontSize: 30 },
  body: { ...t.body, color: color.textMuted, fontSize: 14, lineHeight: 20 },
  blockTitle: { ...t.label, color: color.text, fontSize: 16, marginBottom: space.xs },
  error: { ...t.body, color: color.danger, fontSize: 14 },

  scale: { gap: space.xs, marginTop: space.sm },
  scaleLabel: { ...t.label, color: color.text, fontSize: 14 },
  dots: { flexDirection: 'row', gap: space.sm },
  dot: {
    flex: 1, alignItems: 'center', paddingVertical: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.line,
    backgroundColor: color.surface,
  },
  dotOn: { backgroundColor: color.iceDim, borderColor: color.ice },
  dotText: { ...t.data, color: color.textMuted, fontSize: 15 },
  dotTextOn: { color: color.ice },
  anchors: { flexDirection: 'row', justifyContent: 'space-between' },
  anchor: { ...t.body, color: color.textMuted, fontSize: 11 },

  note: {
    ...t.body,
    backgroundColor: color.surface, borderColor: color.line, borderWidth: 1,
    borderRadius: radius.md, color: color.text, fontSize: 15,
    padding: space.md, minHeight: 80, textAlignVertical: 'top',
    marginTop: space.md,
  },

  primary: {
    backgroundColor: color.ice, borderRadius: radius.md,
    paddingVertical: space.md, alignItems: 'center', marginTop: space.sm,
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { ...t.label, color: color.ground, fontSize: 16 },

  readiness: {
    backgroundColor: color.surface, borderRadius: radius.md,
    borderLeftWidth: 3, padding: space.md, gap: space.xs, marginTop: space.lg,
  },
  readinessEmpty: {
    backgroundColor: color.surface, borderRadius: radius.md,
    padding: space.md, marginTop: space.lg,
  },
  readinessScore: { ...t.data, color: color.text, fontSize: 44 },
  readinessBand: { ...t.label, fontSize: 16, marginBottom: space.xs },

  divider: { height: 1, backgroundColor: color.line, marginVertical: space.sm },
  compRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compLabel: { ...t.body, color: color.textMuted, fontSize: 13 },
  compValue: { ...t.data, fontSize: 13 },
  confidence: { ...t.body, color: color.textMuted, fontSize: 11, marginTop: space.sm },
});
