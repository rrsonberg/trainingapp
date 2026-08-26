/**
 * The auth gate.
 *
 * <Redirect> rather than router.replace() in an effect, and that distinction is
 * the whole point: an effect runs AFTER the children render, so a signed-out
 * launch would render the home screen for one frame first — and every screen in
 * this group calls useIdentity(), which throws by design when there is no
 * identity. Redirecting during render means the protected screens never mount
 * at all without one.
 */

import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { SyncProvider } from '../../src/lib/syncRunner';
import { color } from '../../src/theme';

export default function AppLayout() {
  const { status } = useAuth();

  // Brief by design: identity resolves from cache before the session read
  // finishes, so this rarely survives more than a frame.
  if (status === 'loading') {
    return (
      <View style={s.boot}>
        <ActivityIndicator color={color.ice} />
      </View>
    );
  }

  if (status === 'signedOut') return <Redirect href="/sign-in" />;

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
