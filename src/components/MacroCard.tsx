/**
 * The macros card — home screen, directly under readiness.
 *
 * Shows REMAINING rather than consumed. "1,240 left" answers the question a
 * client actually has at 4pm; "1,160 eaten" makes them do the subtraction.
 *
 * Bars, not rings. A ring reads as a goal to complete, which is the wrong
 * message for a calorie ceiling — and three rings side by side at phone width
 * are too small to read anyway.
 *
 * No target set yet is a real state, not an error: plenty of clients log food
 * before a coach has written their numbers. It shows intake alone and says so.
 *
 * ---------------------------------------------------------------------------
 * Wiring: import into app/(app)/index.tsx and place immediately after the
 * readiness <Pressable>, before the "Today" section:
 *
 *     import { MacroCard } from '../../src/components/MacroCard';
 *     ...
 *     <MacroCard clientId={identity.clientId} />
 *
 * It refreshes on focus itself, so nothing needs adding to the existing
 * useFocusEffect block.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { macrosForDay, type DayMacros } from '../repositories/nutrition';
import { kjToKcal } from '../lib/foodApi';
import { today } from '../lib/day';
import { color, radius, space, type as t } from '../theme';

type BarProps = { label: string; value: number; target: number | null; tint: string };

function MacroBar({ label, value, target, tint }: BarProps) {
  const pct = target && target > 0 ? Math.min(value / target, 1) : 0;
  // Over target is worth showing, but not in alarm colours — one heavy day is
  // not a failure and the app has no business implying it is.
  const over = target != null && target > 0 && value > target;

  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label}</Text>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
      </View>
      <Text style={[s.barValue, over && { color: color.warning }]}>
        {Math.round(value)}
        {target != null ? `/${Math.round(target)}g` : 'g'}
      </Text>
    </View>
  );
}

export function MacroCard({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [data, setData] = useState<DayMacros | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const d = await macrosForDay(clientId, today());
        if (!cancelled) setData(d);
      })();
      return () => { cancelled = true; };
    }, [clientId]),
  );

  if (!data) return null;

  const eaten = kjToKcal(data.energyKj);
  const targetKcal = data.target ? kjToKcal(data.target.energyKj) : null;
  const remaining = targetKcal != null ? targetKcal - eaten : null;

  return (
    <Pressable style={s.card} onPress={() => router.push('/log-food')}>
      <View style={s.head}>
        <View>
          <Text style={s.big}>
            {remaining != null ? Math.abs(remaining).toLocaleString() : eaten.toLocaleString()}
          </Text>
          <Text style={s.muted}>
            {remaining == null
              ? 'kcal eaten'
              : remaining >= 0
                ? 'kcal left today'
                : 'kcal over today'}
          </Text>
        </View>
        <View style={s.logButton}>
          <Text style={s.logButtonText}>Log food</Text>
        </View>
      </View>

      {data.target ? (
        <View style={s.bars}>
          <MacroBar label="P" value={data.proteinG} target={data.target.proteinG} tint={color.positive} />
          <MacroBar label="C" value={data.carbsG}   target={data.target.carbsG}   tint={color.ice} />
          <MacroBar label="F" value={data.fatG}     target={data.target.fatG}     tint={color.warning} />
        </View>
      ) : (
        <Text style={s.muted}>
          No targets from your coach yet — logging still counts, and the
          numbers fill in the moment they set them.
        </Text>
      )}

      {data.target?.coachNote ? (
        <Text style={s.note}>{data.target.coachNote}</Text>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
  },
  head:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  big:   { ...t.data, color: color.text, fontSize: 34 },
  muted: { ...t.body, color: color.textMuted, fontSize: 13, lineHeight: 19 },

  logButton: {
    borderWidth: 1, borderColor: color.line, borderRadius: radius.pill,
    paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  logButtonText: { ...t.label, color: color.text, fontSize: 13 },

  bars:     { gap: space.sm },
  barRow:   { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  barLabel: { ...t.label, color: color.textMuted, fontSize: 11, width: 12 },
  track:    { flex: 1, height: 6, backgroundColor: color.ground,
              borderRadius: radius.pill, overflow: 'hidden' },
  fill:     { height: 6, borderRadius: radius.pill },
  barValue: { ...t.data, color: color.textMuted, fontSize: 12, width: 68,
              textAlign: 'right' },

  note: { ...t.body, color: color.textMuted, fontSize: 12, lineHeight: 18 },
});
