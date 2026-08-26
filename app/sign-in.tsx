/**
 * Sign in.
 *
 * Email and password rather than a magic link: the client already has
 * detectSessionInUrl off, and a link that round-trips through a mail app is a
 * poor fit for someone standing in a gym. Magic links can come later behind the
 * coachapp:// scheme without changing anything in the auth context.
 */

import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useAuth } from '../src/lib/auth';
import { color, radius, space, type as t } from '../src/theme';

export default function SignInScreen() {
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setLocalError(null);
    try {
      await signIn(email, password);
      // The gate redirects on the auth state change. Nothing to do here.
    } catch (e: any) {
      // Spec E: say what happened and how to fix it. No apologies.
      setLocalError(e?.message ?? 'Could not sign in. Check your email and password.');
    } finally {
      setBusy(false);
    }
  }

  const shown = localError ?? error;

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.eyebrow}>COACH</Text>
        <Text style={s.title}>Sign in</Text>
        <Text style={s.body}>
          Use the email your coach set you up with.
        </Text>

        <Text style={s.label}>Email</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={(v) => { setEmail(v); setLocalError(null); }}
          placeholder="you@example.com"
          placeholderTextColor={color.textMuted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          editable={!busy}
        />

        <Text style={s.label}>Password</Text>
        <TextInput
          style={s.input}
          value={password}
          onChangeText={(v) => { setPassword(v); setLocalError(null); }}
          placeholder="Required"
          placeholderTextColor={color.textMuted}
          autoCapitalize="none"
          autoComplete="current-password"
          secureTextEntry
          editable={!busy}
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {shown && <Text style={s.error}>{shown}</Text>}

        <Pressable
          style={[s.primary, !canSubmit && s.primaryDisabled]}
          onPress={submit}
          disabled={!canSubmit}
        >
          {busy
            ? <ActivityIndicator color={color.ground} />
            : <Text style={s.primaryText}>Sign in</Text>}
        </Pressable>

        <View style={s.footer}>
          <Text style={s.footerText}>
            No account? Your coach creates it — this app does not sign people up.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.sm },

  eyebrow: { ...t.label, color: color.ice, fontSize: 12 },
  title: { ...t.display, color: color.text, fontSize: 32, marginBottom: space.xs },
  body: { ...t.body, color: color.textMuted, fontSize: 15, marginBottom: space.lg },

  label: { ...t.label, color: color.textMuted, fontSize: 12, marginTop: space.md },
  input: {
    ...t.data,
    backgroundColor: color.surface,
    borderColor: color.line,
    borderWidth: 1,
    borderRadius: radius.md,
    color: color.text,
    fontSize: 17,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },

  error: { ...t.body, color: color.danger, fontSize: 14, marginTop: space.md },

  primary: {
    backgroundColor: color.ice,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.lg,
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { ...t.label, color: color.ground, fontSize: 16 },

  footer: { marginTop: space.xl },
  footerText: { ...t.body, color: color.textMuted, fontSize: 13, lineHeight: 19 },
});
