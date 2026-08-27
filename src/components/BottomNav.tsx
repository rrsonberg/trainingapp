/**
 * Bottom navigation and the + sheet.
 *
 * Two different jobs, deliberately separated:
 *
 *   the BAR is for going somewhere — four places a client returns to daily
 *   the + is for doing something — every way to log, in one list
 *
 * That split is why the pattern works. A bar with eight items is a menu
 * nobody reads; a + with four is a button nobody presses. Navigation stays at
 * four, and everything else lives one tap inside the +.
 *
 * It renders in the layout rather than per screen, so it survives navigation
 * and no screen has to remember to include it. Screens do not need to change
 * at all — they just gain bottom padding from BAR_HEIGHT.
 */

import { useState } from 'react';
import {
  Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, space, type as t } from '../theme';

/** Screens below need this much clearance so content is not hidden. */
export const BAR_HEIGHT = 64;

type NavItem = { label: string; href: string };

/**
 * Four, and only four.
 *
 * Today first because it answers "how am I", Food second because it is the
 * habit, then the two logging surfaces that carry the differentiator.
 */
const NAV: NavItem[] = [
  { label: 'Today',    href: '/' },
  { label: 'Food',     href: '/log-food' },
  { label: 'Train',    href: '/log-strength' },
  { label: 'Recovery', href: '/log-recovery' },
];

/** Everything the + offers. Order is by how often it gets used, not by
 *  category — the top item should be right most of the time. */
const ACTIONS: { label: string; detail: string; href: string; tint?: string }[] = [
  { label: 'Log food',        detail: 'Search, scan or your own foods', href: '/log-food' },
  { label: 'Scan a barcode',  detail: 'Straight to the camera',          href: '/scan-food' },
  { label: 'Start a workout', detail: 'Strength session',                href: '/log-strength' },
  { label: 'Log recovery',    detail: 'Sauna, plunge, hyperbaric, more', href: '/log-recovery' },
  { label: 'Daily check-in',  detail: 'Energy, sleep, stress, soreness', href: '/check-in' },
  { label: 'Apple Health',    detail: 'Connect or re-sync',              href: '/connect-health' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  function go(href: string) {
    setOpen(false);
    // replace rather than push for the bar, so tapping between the four does
    // not build a back stack twenty screens deep by lunchtime.
    router.replace(href as any);
  }

  return (
    <>
      <View style={[s.bar, { paddingBottom: insets.bottom || space.sm }]}>
        {NAV.slice(0, 2).map((item) => (
          <NavButton key={item.href} item={item}
            active={isActive(pathname, item.href)} onPress={() => go(item.href)} />
        ))}

        {/* The + sits in the middle of the bar, raised, so it reads as the
            primary action rather than a fifth destination. */}
        <View style={s.fabSlot}>
          <Pressable
            style={s.fab}
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Log something"
          >
            <Text style={s.fabPlus}>+</Text>
          </Pressable>
        </View>

        {NAV.slice(2).map((item) => (
          <NavButton key={item.href} item={item}
            active={isActive(pathname, item.href)} onPress={() => go(item.href)} />
        ))}
      </View>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        {/* Tapping the dimmed area closes it. Anything that opens from a
            single tap should close from one too. */}
        <Pressable style={s.scrim} onPress={() => setOpen(false)} />

        <View style={[s.sheet, { paddingBottom: (insets.bottom || space.md) + space.md }]}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>Log</Text>

          {ACTIONS.map((a) => (
            <Pressable key={a.href + a.label} style={s.action} onPress={() => go(a.href)}>
              <View style={s.actionBody}>
                <Text style={s.actionLabel}>{a.label}</Text>
                <Text style={s.actionDetail}>{a.detail}</Text>
              </View>
              <Text style={s.chev}>›</Text>
            </Pressable>
          ))}

          <Pressable style={s.cancel} onPress={() => setOpen(false)}>
            <Text style={s.cancelText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

function NavButton({
  item, active, onPress,
}: { item: NavItem; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={s.navItem}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {/* A bar of colour rather than an icon set. No icon dependency, and the
          active state reads at a glance in a dark UI. */}
      <View style={[s.navMark, active && s.navMarkOn]} />
      <Text style={[s.navLabel, active && s.navLabelOn]}>{item.label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: color.surface,
    borderTopWidth: 1, borderTopColor: color.line,
    paddingTop: space.sm,
  },
  navItem:   { flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.xs },
  navMark:   { width: 18, height: 2, borderRadius: 1, backgroundColor: 'transparent' },
  navMarkOn: { backgroundColor: color.ice },
  navLabel:  { ...t.label, color: color.textMuted, fontSize: 11 },
  navLabelOn:{ color: color.ice },

  fabSlot: { width: 72, alignItems: 'center' },
  fab: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: color.ice,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -22,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabPlus: { ...t.display, color: color.ground, fontSize: 30, lineHeight: 34 },

  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    padding: space.lg, gap: space.xs,
    borderTopWidth: 1, borderTopColor: color.line,
  },
  grabber: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: color.line,
    alignSelf: 'center', marginBottom: space.md,
  },
  sheetTitle: { ...t.label, color: color.textMuted, fontSize: 11,
                marginBottom: space.xs },

  action: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: space.md, gap: space.sm,
    borderBottomWidth: 1, borderBottomColor: color.line,
  },
  actionBody:   { flex: 1, gap: 2 },
  actionLabel:  { ...t.body, color: color.text, fontSize: 16 },
  actionDetail: { ...t.body, color: color.textMuted, fontSize: 12 },
  chev:         { ...t.display, color: color.textMuted, fontSize: 22 },

  cancel:     { alignItems: 'center', paddingVertical: space.md,
                marginTop: space.sm },
  cancelText: { ...t.label, color: color.textMuted, fontSize: 14 },
});
