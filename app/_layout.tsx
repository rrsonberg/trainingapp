/**
 * Root layout and auth gate.
 *
 * The gate redirects rather than unmounting the navigator, so a signed-in
 * client never watches the app tear itself down and rebuild. The loading state
 * is deliberately plain and deliberately brief — identity resolves from cache
 * before the session read finishes, so this rarely renders for more than a frame.
 */

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { SyncProvider } from '../src/lib/syncRunner';
import { color } from '../src/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    const onSignIn = segments[0] === 'sign-in';

    if (status === 'signedOut' && !onSignIn) {
      router.replace('/sign-in');
    } else if (status === 'signedIn' && onSignIn) {
      router.replace('/');
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={s.boot}>
        <ActivityIndicator color={color.ice} />
      </View>
    );
  }

  // SyncProvider wraps the navigator unconditionally rather than only when
  // signed in. Swapping it in and out would remount the Stack on every sign-in
  // and sign-out; it no-ops without an identity instead.
  return (
    <SyncProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.ground },
        }}
      />
    </SyncProvider>
  );
}

const s = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ground,
  },
});
