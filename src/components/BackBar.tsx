/**
 * Back to where you came from.
 *
 * Every screen in this app is a full-bleed dark surface with the navigator
 * header switched off, which looks right and left several screens with no way
 * out but the iOS edge swipe — a gesture plenty of people do not know and which
 * is awkward one-handed with a barbell waiting.
 *
 * canGoBack() is checked rather than assumed: a screen reached by a deep link,
 * or after the gate replaced the stack, has nothing behind it, and calling
 * back() there does nothing at all. Home is the honest fallback.
 */

import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { color, space, type as t } from '../theme';

export function BackBar({
  label = 'Back',
  onPress,
}: {
  label?: string;
  /** Override for in-screen steps, where "back" means a step, not a route. */
  onPress?: () => void;
}) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Generous, because this is tapped mid-set with cold hands.
      hitSlop={{ top: 12, bottom: 12, left: 16, right: 24 }}
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
      style={({ pressed }) => [s.wrap, pressed && s.pressed]}
    >
      <Text style={s.chevron}>‹</Text>
      <Text style={s.label}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    paddingVertical: space.xs,
    marginBottom: space.xs,
  },
  pressed: { opacity: 0.5 },
  chevron: { ...t.display, color: color.textMuted, fontSize: 24, lineHeight: 26 },
  label: { ...t.body, color: color.textMuted, fontSize: 15 },
});
