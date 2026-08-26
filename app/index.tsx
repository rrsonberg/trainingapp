/**
 * Home.
 *
 * Minimal on purpose — it exists because the auth gate needs somewhere to land
 * after sign-in, and because expo-router needs an index route. The real home
 * screen (today's session, readiness, the week's balance) replaces this once
 * pull sync can supply it.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useAuth, useIdentity } from '../src/lib/auth';
import { useSync } from '../src/lib/syncRunner';
import { color, familyColor, radius, space, type as t } from '../src/theme';

export default function HomeScreen() {
  const { signOut } = useAuth();
  const identity = useIdentity();
  const { pending, online, phase } = useSync();

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>COACH</Text>
      <Text style={s.title}>Today</Text>

      <View style={s.card}>
        <Text style={s.cardLabel}>SIGNED IN AS</Text>
        <Text style={s.cardValue}>{identity.email ?? identity.clientId}</Text>
      </View>

      <Link href="/check-in" asChild>
        <Pressable style={[s.action, s.actionQuiet]}>
          <Text style={[s.actionText, s.actionQuietText]}>Daily check-in</Text>
        </Pressable>
      </Link>

      <Link href="/log-strength" asChild>
        <Pressable style={[s.action, s.actionTraining]}>
          <Text style={s.actionText}>Start a strength workout</Text>
        </Pressable>
      </Link>

      <Link href="/log-recovery" asChild>
        <Pressable style={s.action}>
          <Text style={s.actionText}>Log a recovery session</Text>
        </Pressable>
      </Link>

      <Link href="/connect-health" asChild>
        <Pressable style={[s.action, s.actionQuiet]}>
          <Text style={[s.actionText, s.actionQuietText]}>Connect Apple Health</Text>
        </Pressable>
      </Link>

      {/* Only shown when there is something to say. A permanent "0 pending"
          badge trains people to ignore the one time it matters. */}
      {(pending > 0 || !online) && (
        <Link href="/pending-writes" asChild>
          <Pressable style={s.status}>
            <View style={[s.dot, { backgroundColor: online ? color.ice : color.warning }]} />
            <Text style={s.statusText}>
              {phase === 'syncing'
                ? 'Syncing...'
                : !online
                  ? `Offline - ${pending} waiting to send`
                  : `${pending} waiting to send`}
            </Text>
          </Pressable>
        </Link>
      )}

      <Pressable style={s.signOut} onPress={signOut}>
        <Text style={s.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.md },

  eyebrow: { ...t.label, color: color.ice, fontSize: 12 },
  title: { ...t.display, color: color.text, fontSize: 32, marginBottom: space.sm },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  cardLabel: { ...t.label, color: color.textMuted, fontSize: 11 },
  cardValue: { ...t.data, color: color.text, fontSize: 15 },

  action: {
    backgroundColor: color.ice,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  actionText: { ...t.label, color: color.ground, fontSize: 16 },
  // Training reads ember, recovery reads ice. theme.ts is emphatic that colour
  // carries meaning here, so the two entry points must not look alike.
  actionTraining: { backgroundColor: familyColor('training') },
  actionQuiet: {
    backgroundColor: 'transparent',
    borderColor: color.line,
    borderWidth: 1,
  },
  actionQuietText: { color: color.text },

  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  statusText: { ...t.body, color: color.textMuted, fontSize: 13 },

  signOut: { marginTop: space.xl, alignItems: 'center', paddingVertical: space.sm },
  signOutText: { ...t.body, color: color.textMuted, fontSize: 14 },
});
