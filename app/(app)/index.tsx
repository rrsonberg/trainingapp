/**
 * Home.
 *
 * Four questions, in the order a client actually asks them: how am I today,
 * where am I on food, what am I doing, and how has the week balanced out.
 *
 * Macros sit directly under readiness because those are the two things checked
 * daily. Readiness leads because it is the thing no competitor has; food is
 * second because it is the thing they open the app for.
 *
 * The week strip is the one view the rest of the market does not have
 * (loadBalance, spec I12) and theme.ts is explicit that it must read at a glance
 * WITHOUT a legend. So it diverges from a midline — training rises in ember,
 * recovery falls in ice — and the shape carries the meaning. A stacked bar or a
 * shared axis would need a key, and a key means nobody reads it.
 *
 * Everything here is a local query. The screen is fully rendered before the
 * network is consulted, which is the whole point of localdb.ts.
 */

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth, useIdentity } from '../../src/lib/auth';
import { useSync } from '../../src/lib/syncRunner';
import { listSessions, loadBalance } from '../../src/repositories/sessions';
import { SESSION_TYPES, type Session } from '../../src/types/sessions';
import { BAND_COPY, computeReadiness, type Readiness } from '../../src/lib/readiness';
import { MacroCard } from '../../src/components/MacroCard';
import { displayDuration } from '../../src/lib/units';
import { recentDays, today } from '../../src/lib/day';
import { color, familyColor, radius, space, type as t } from '../../src/theme';

const TRAINING = familyColor('training');
const RECOVERY = familyColor('recovery');
const STRIP_HEIGHT = 44;

type DayLoad = { date: string; training: number; recovery: number };

function weekdayInitial(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'narrow' });
}

function bandColor(band: Readiness['band']) {
  return band === 'hold' ? color.warning : band === 'push' ? color.positive : color.ice;
}

export default function HomeScreen() {
  const { signOut } = useAuth();
  const identity = useIdentity();
  const router = useRouter();
  const { pending, online, phase } = useSync();

  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [todays, setTodays] = useState<Session[]>([]);
  const [balance, setBalance] = useState<DayLoad[]>([]);

  // Re-read on every focus: coming back from the strength logger should show
  // the session that was just finished, not a stale snapshot.
  // MacroCard refreshes itself on focus, so it needs nothing here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const day = today();
        const [r, s, b] = await Promise.all([
          computeReadiness(identity.clientId, day),
          listSessions({ clientId: identity.clientId, from: day, to: day }),
          loadBalance(identity.clientId, 7),
        ]);
        if (cancelled) return;
        setReadiness(r);
        setTodays(s);
        setBalance(b);
      })();
      return () => { cancelled = true; };
    }, [identity.clientId])
  );

  const days = recentDays(7);
  const byDate = new Map(balance.map((d) => [d.date, d]));
  // One scale for both halves, so an hour of training and an hour of sauna
  // draw the same length. Different scales would flatter whichever is smaller.
  const peak = Math.max(60, ...balance.flatMap((d) => [d.training, d.recovery]));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>TODAY</Text>
      <Text style={s.title}>
        {new Date().toLocaleDateString(undefined, { weekday: 'long' })}
      </Text>

      {/* --- Readiness ------------------------------------------------ */}
      <Pressable
        onPress={() => router.push('/check-in')}
        style={[s.card, readiness && { borderLeftWidth: 3, borderLeftColor: bandColor(readiness.band) }]}
      >
          {readiness ? (
            <>
              <View style={s.readinessTop}>
                <Text style={s.readinessScore}>{readiness.score}</Text>
                <View style={s.readinessCopy}>
                  <Text style={[s.readinessBand, { color: bandColor(readiness.band) }]}>
                    {BAND_COPY[readiness.band].title}
                  </Text>
                  <Text style={s.muted}>{readiness.confidence} confidence</Text>
                </View>
              </View>
              <Text style={s.body}>{BAND_COPY[readiness.band].body}</Text>
            </>
          ) : (
            <>
              <Text style={s.cardTitle}>How are you today?</Text>
              <Text style={s.body}>
                Check in to build your baseline. Readiness appears once there is
                enough of your own history to compare against.
              </Text>
            </>
          )}
      </Pressable>

      {/* --- Macros --------------------------------------------------- */}
      <MacroCard clientId={identity.clientId} />

      {/* --- Today's sessions ----------------------------------------- */}
      <Text style={s.section}>Today</Text>
      {todays.length === 0 ? (
        <Text style={s.body}>Nothing logged yet.</Text>
      ) : (
        todays.map((session) => {
          const def = SESSION_TYPES[session.sessionType];
          return (
            <View key={session.clientGeneratedId} style={s.sessionRow}>
              <View style={[s.familyBar, { backgroundColor: familyColor(def.family) }]} />
              <View style={s.sessionBody}>
                <Text style={s.sessionName}>{def.label}</Text>
                <Text style={s.muted}>
                  {session.status === 'completed'
                    ? displayDuration(session.durationSeconds)
                    : session.status === 'in_progress'
                      ? 'In progress'
                      : 'Planned'}
                </Text>
              </View>
            </View>
          );
        })
      )}

      {/* --- The week ------------------------------------------------- */}
      <Text style={s.section}>Last 7 days</Text>
      <View style={s.strip}>
        {days.map((date) => {
          const d = byDate.get(date);
          const up = d ? (d.training / peak) * STRIP_HEIGHT : 0;
          const down = d ? (d.recovery / peak) * STRIP_HEIGHT : 0;
          return (
            <View key={date} style={s.stripCol}>
              <View style={s.stripHalf}>
                <View style={[s.bar, { height: Math.max(up, up > 0 ? 2 : 0), backgroundColor: TRAINING }]} />
              </View>
              <View style={s.midline} />
              <View style={[s.stripHalf, s.stripHalfDown]}>
                <View style={[s.bar, { height: Math.max(down, down > 0 ? 2 : 0), backgroundColor: RECOVERY }]} />
              </View>
              <Text style={s.stripDay}>{weekdayInitial(date)}</Text>
            </View>
          );
        })}
      </View>
      {balance.length === 0 && (
        <Text style={s.muted}>Completed sessions will fill this in.</Text>
      )}

      {/* --- Actions -------------------------------------------------- */}
      <Text style={s.section}>Log</Text>

      <Pressable
        onPress={() => router.push('/log-strength')}
        style={[s.action, { backgroundColor: TRAINING }]}
      >
        <Text style={s.actionText}>Start a strength workout</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/log-recovery')}
        style={[s.action, { backgroundColor: RECOVERY }]}
      >
        <Text style={s.actionText}>Log a recovery session</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/connect-health')}
        style={[s.action, s.actionQuiet]}
      >
        <Text style={[s.actionText, s.actionQuietText]}>Connect Apple Health</Text>
      </Pressable>

      {/* Shown only when there is something to say. A permanent "0 pending"
          badge trains people to ignore the one time it matters. */}
      {(pending > 0 || !online) && (
        <Pressable onPress={() => router.push('/pending-writes')} style={s.status}>
            <View style={[s.dot, { backgroundColor: online ? color.ice : color.warning }]} />
            <Text style={s.muted}>
              {phase === 'syncing'
                ? 'Syncing...'
                : !online
                  ? `Offline - ${pending} waiting to send`
                  : `${pending} waiting to send`}
            </Text>
        </Pressable>
      )}

      <Pressable style={s.signOut} onPress={signOut}>
        <Text style={s.muted}>Sign out{identity.email ? ` (${identity.email})` : ''}</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.sm },

  eyebrow: { ...t.label, color: color.ice, fontSize: 12 },
  title: { ...t.display, color: color.text, fontSize: 32, marginBottom: space.sm },
  section: { ...t.label, color: color.textMuted, fontSize: 11, marginTop: space.lg },
  body: { ...t.body, color: color.textMuted, fontSize: 14, lineHeight: 20 },
  muted: { ...t.body, color: color.textMuted, fontSize: 13 },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  cardTitle: { ...t.label, color: color.text, fontSize: 16 },

  readinessTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  readinessScore: { ...t.data, color: color.text, fontSize: 40 },
  readinessCopy: { flex: 1, gap: 2 },
  readinessBand: { ...t.label, fontSize: 16 },

  sessionRow: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: color.surface, borderRadius: radius.sm, overflow: 'hidden',
  },
  familyBar: { width: 3 },
  sessionBody: { flex: 1, padding: space.md, gap: 2 },
  sessionName: { ...t.body, color: color.text, fontSize: 15 },

  strip: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: color.surface, borderRadius: radius.md,
    paddingVertical: space.md, paddingHorizontal: space.sm,
  },
  stripCol: { flex: 1, alignItems: 'center' },
  stripHalf: { height: STRIP_HEIGHT, justifyContent: 'flex-end' },
  stripHalfDown: { justifyContent: 'flex-start' },
  bar: { width: 10, borderRadius: 2 },
  midline: { height: 1, alignSelf: 'stretch', marginHorizontal: space.xs, backgroundColor: color.line },
  stripDay: { ...t.label, color: color.textMuted, fontSize: 10, marginTop: space.xs },

  action: {
    borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center',
  },
  actionText: { ...t.label, color: color.ground, fontSize: 16 },
  actionQuiet: { backgroundColor: 'transparent', borderColor: color.line, borderWidth: 1 },
  actionQuietText: { color: color.text },

  status: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.surface, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.md,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },

  signOut: { marginTop: space.xl, alignItems: 'center', paddingVertical: space.sm },
});
