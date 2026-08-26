/**
 * Root layout.
 *
 * It renders a navigator on the FIRST render and does nothing else. That is not
 * a style preference — expo-router throws "Attempted to navigate before
 * mounting the Root Layout component" if the root ever returns something that
 * is not a navigator, which is what happens if you try to gate auth here behind
 * a loading spinner.
 *
 * The auth gate therefore lives one level down, in app/(app)/_layout.tsx, where
 * it can redirect during render instead of in an effect. The route group adds
 * no path segment, so every href stays exactly what it was.
 *
 * The safe-area inset is applied here, around the whole navigator, rather than
 * in each screen. Every screen is a full-bleed dark surface with no header, so
 * they all need the same inset, and doing it per screen means the first one
 * anybody forgets renders its title underneath the clock.
 */

import { Slot } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { AuthProvider } from '../src/lib/auth';
import { color } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* The whole app is a dark surface, so the system bars must be light. */}
      <StatusBar style="light" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <AuthProvider>
          <Slot />
        </AuthProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.ground },
});
