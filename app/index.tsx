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
import { color, radius, space, type as t } from '../src/theme';

export default function HomeScreen() {
  const { signOut } = useAuth();
  const identity = useIdentity();

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>COACH</Text>
      <Text style={s.title}>Today</Text>

      <View style={s.card}>
        <Text style={s.cardLabel}>SIGNED IN AS</Text>
        <Text style={s.cardValue}>{identity.email ?? identity.clientId}</Text>
      </View>

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
  actionQuiet: {
    backgroundColor: 'transparent',
    borderColor: color.line,
    borderWidth: 1,
  },
  actionQuietText: { color: color.text },

  signOut: { marginTop: space.xl, alignItems: 'center', paddingVertical: space.sm },
  signOutText: { ...t.body, color: color.textMuted, fontSize: 14 },
});
