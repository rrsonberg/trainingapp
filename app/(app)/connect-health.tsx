/**
 * Connect Health — what the CLIENT sees.
 *
 * Two jobs. First, get HealthKit permission. Second — and this is the part
 * every competitor skips — tell the client to turn on MyFitnessPal's own
 * Apple Health sync, because it is OFF by default. Without that step the
 * nutrition side of this silently returns nothing and nobody knows why.
 */

import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  requestHealthPermissions,
  backfillHealthHistory,
  isHealthAvailable,
} from '../../src/lib/health';
import { useIdentity } from '../../src/lib/auth';
import { BackBar } from '../../src/components/BackBar';
import { color, radius, space, type as t } from '../../src/theme';

type Stage = 'intro' | 'requesting' | 'backfilling' | 'done' | 'unavailable';

export default function ConnectHealthScreen() {
  const { clientId } = useIdentity();
  const [stage, setStage] = useState<Stage>('intro');
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [rows, setRows] = useState(0);

  async function connect() {
    if (!isHealthAvailable()) return setStage('unavailable');

    setStage('requesting');
    const shown = await requestHealthPermissions();
    if (!shown) return setStage('unavailable');

    setStage('backfilling');
    const written = await backfillHealthHistory(
      clientId,
      2,
      (done, total) => setProgress({ done, total })
    );
    setRows(written);
    setStage('done');
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <BackBar />
      <Text style={s.eyebrow}>SETUP</Text>
      <Text style={s.title}>Connect Apple Health</Text>

      <Text style={s.body}>
        Your coach sees your sleep, recovery markers and nutrition without you
        logging any of it twice. We read from Apple Health — we never write to it.
      </Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>What we read</Text>
        {[
          'Heart rate variability and resting heart rate',
          'Sleep duration',
          'Body weight and composition',
          'Steps and active energy',
          'Calories and macros, if you track them',
        ].map((line) => (
          <Text key={line} style={s.bullet}>· {line}</Text>
        ))}
      </View>

      {stage === 'intro' && (
        <>
          <Pressable style={s.primary} onPress={connect}>
            <Text style={s.primaryText}>Connect Apple Health</Text>
          </Pressable>

          <View style={s.card}>
            <Text style={s.cardTitle}>Using MyFitnessPal?</Text>
            <Text style={s.body}>
              Turn on its Apple Health sync or your food logs won't come through.
              It's off by default.
            </Text>
            <Text style={s.steps}>
              MyFitnessPal → Menu → Settings → Apps &amp; Devices → Apple Health → Connect
            </Text>
            <Pressable onPress={() => Linking.openURL('myfitnesspal://')}>
              <Text style={s.link}>Open MyFitnessPal</Text>
            </Pressable>
            <Text style={s.small}>
              Same idea for Whoop, Oura, Garmin and Fitbit — once they write to
              Apple Health, we pick them up automatically. No extra logins.
            </Text>
          </View>
        </>
      )}

      {stage === 'requesting' && (
        <Text style={s.body}>Waiting for permission…</Text>
      )}

      {stage === 'backfilling' && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Importing your history</Text>
          <Text style={s.body}>
            Pulling the last two years. This runs once.
          </Text>
          <View style={s.track}>
            <View
              style={[
                s.fill,
                { width: `${Math.round((progress.done / progress.total) * 100)}%` },
              ]}
            />
          </View>
        </View>
      )}

      {stage === 'done' && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Connected</Text>
          <Text style={s.body}>
            {rows > 0
              ? `Imported ${rows} days of history. New data syncs automatically.`
              : `No history found yet. That's normal if you're new to Apple Health, or if you didn't grant every category. New data will sync as it arrives.`}
          </Text>
        </View>
      )}

      {stage === 'unavailable' && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Not available on this device</Text>
          <Text style={s.body}>
            You can still log everything by hand, and your coach sees all of it.
          </Text>
        </View>
      )}

      <Text style={s.small}>
        Health data stays between you and your coach. It is never sold, never
        used for advertising, and you can disconnect or export it at any time.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },

  eyebrow: { ...t.label, color: color.ice, fontSize: 11 },
  title:   { ...t.display, color: color.text, fontSize: 30 },
  body:    { ...t.body, color: color.textMuted, fontSize: 15, lineHeight: 22 },
  small:   { ...t.body, color: color.textMuted, fontSize: 12, lineHeight: 18 },

  card:      { backgroundColor: color.surface, borderRadius: radius.md,
               padding: space.md, gap: space.sm,
               borderWidth: 1, borderColor: color.line },
  cardTitle: { ...t.display, color: color.text, fontSize: 16 },
  bullet:    { ...t.body, color: color.textMuted, fontSize: 14, lineHeight: 21 },
  steps:     { ...t.data, color: color.text, fontSize: 13, lineHeight: 20 },
  link:      { ...t.label, color: color.ice, fontSize: 14 },

  primary:     { backgroundColor: color.ice, borderRadius: radius.md,
                 paddingVertical: space.md + 2, alignItems: 'center' },
  primaryText: { ...t.display, color: color.ground, fontSize: 16 },

  track: { height: 4, backgroundColor: color.line, borderRadius: radius.pill,
           overflow: 'hidden' },
  fill:  { height: 4, backgroundColor: color.ice },
});
