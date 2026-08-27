/**
 * The auth gate, and the app chrome that sits over every screen inside it.
 *
 * <Redirect> rather than router.replace() in an effect, and that distinction is
 * the whole point: an effect runs AFTER the children render, so a signed-out
 * launch would render the home screen for one frame first — and every screen in
 * this group calls useIdentity(), which throws by design when there is no
 * identity. Redirecting during render means the protected screens never mount
 * at all without one.
 *
 * The bottom bar lives HERE rather than in each screen. Putting it in the
 * layout means it survives navigation, no screen has to remember to include
 * it, and a new screen gets navigation for free. The cost is that screens must
 * leave BAR_HEIGHT of bottom padding — every one of ours already pads
 * generously at the bottom, so nothing needed changing.
 */

import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/lib/auth';
import { SyncProvider } from '../../src/lib/syncRunner';
import { BottomNav, BAR_HEIGHT } from '../../src/components/BottomNav';
import { color } from '../../src/theme';

export default function AppLayout() {
  const { status } = useAuth();
  const insets = useSafeAreaInsets();

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
      <View style={s.root}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: color.ground,
              // The bar is BAR_HEIGHT plus the home-indicator inset it pads
              // itself by, so clearing BAR_HEIGHT alone leaves content ~34pt
              // short on every device with a home indicator — enough to bury a
              // save button, which is exactly what it did.
              paddingBottom: BAR_HEIGHT + insets.bottom,
            },
          }}
        />
        <BottomNav />
      </View>
    </SyncProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ground,
  },
});
