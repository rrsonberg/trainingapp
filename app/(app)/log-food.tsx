/**
 * Log food.
 *
 * The screen a client opens four times a day, which is the only design
 * constraint that matters: every path to a logged entry is short, and the
 * fastest one — something they have eaten before — is the one on screen when
 * it opens. Search is a fallback, not the front door.
 *
 * Quick add sits alongside search rather than buried. A client who cannot find
 * what they ate will log an approximation or log nothing, and an approximation
 * is worth far more to a coach than a gap in the week.
 *
 * Saves are local. Nothing here awaits the network — same contract as
 * log-recovery.tsx.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useIdentity } from '../../src/lib/auth';
import {
  entriesForDay, logFood, quickAdd, recentFoods, removeEntry, cacheFood,
  type FoodEntry, type MealSlot,
} from '../../src/repositories/nutrition';
import { searchFoods, kjToKcal, type FoodResult } from '../../src/lib/foodApi';
import { today } from '../../src/lib/day';
import { BackBar } from '../../src/components/BackBar';
import { color, radius, space, type as t } from '../../src/theme';

const SLOTS: { key: MealSlot; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snack' },
];

/** Slot defaults to the time of day. Nobody logging at 8am wants to tap
 *  "breakfast" first — but they can change it, because plenty of people
 *  log last night's dinner this morning. */
function slotForNow(): MealSlot {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export default function LogFoodScreen() {
  const { clientId } = useIdentity();
  const day = today();

  const [slot, setSlot] = useState<MealSlot>(slotForNow());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Quick add
  const [qaName, setQaName] = useState('');
  const [qaKcal, setQaKcal] = useState('');
  const [qaProtein, setQaProtein] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const refresh = useCallback(async () => {
    const [e, r] = await Promise.all([
      entriesForDay(clientId, day),
      recentFoods(clientId),
    ]);
    setEntries(e);
    setRecent(r);
  }, [clientId, day]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Debounced: firing a request per keystroke burns the free tier and makes
  // the list flicker through three wrong answers on the way to the right one.
  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        setResults(await searchFoods(query));
      } catch (e: any) {
        setError(e?.message ?? 'Search failed.');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  async function add(food: FoodResult, quantity: number, unit: 'g' | 'serving') {
    setError(null);
    try {
      await logFood({ clientId, food, quantity, unit, mealSlot: slot, day });
      setQuery('');
      setResults(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not log that.');
    }
  }

  async function saveQuickAdd() {
    const kcal = Number(qaKcal);
    if (!qaName.trim() || !Number.isFinite(kcal) || kcal <= 0) {
      setError('A name and a calorie figure are needed.');
      return;
    }
    setError(null);
    try {
      await quickAdd({
        clientId,
        description: qaName.trim(),
        energyKj: kcal * 4.184,
        proteinG: qaProtein ? Number(qaProtein) : null,
        mealSlot: slot,
        day,
      });
      setQaName(''); setQaKcal(''); setQaProtein('');
      setShowQuickAdd(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.');
    }
  }

  const dayKcal = kjToKcal(entries.reduce((s, e) => s + e.energyKj, 0));
  const dayProtein = Math.round(entries.reduce((s, e) => s + (e.proteinG ?? 0), 0));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <BackBar />
      <Text style={s.eyebrow}>FOOD</Text>
      <Text style={s.title}>Log</Text>

      {/* Running total, so they never have to leave to see where they are. */}
      <View style={s.totals}>
        <Text style={s.totalBig}>{dayKcal}</Text>
        <Text style={s.totalUnit}>kcal today</Text>
        <Text style={s.totalSep}>·</Text>
        <Text style={s.totalSmall}>{dayProtein}g protein</Text>
      </View>

      <View style={s.chips}>
        {SLOTS.map(({ key, label }) => {
          const active = key === slot;
          return (
            <Pressable
              key={key}
              onPress={() => setSlot(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[s.chip, active && s.chipActive]}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        style={s.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search a food"
        placeholderTextColor={color.textMuted}
        autoCorrect={false}
        returnKeyType="search"
      />

      <View style={s.row}>
        <Pressable style={s.secondary} onPress={() => router.push('/scan-food')}>
          <Text style={s.secondaryText}>Scan barcode</Text>
        </Pressable>
        <Pressable style={s.secondary} onPress={() => setShowQuickAdd((v) => !v)}>
          <Text style={s.secondaryText}>Quick add</Text>
        </Pressable>
      </View>

      {error && <Text style={s.error}>{error}</Text>}

      {showQuickAdd && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Quick add</Text>
          <Text style={s.body}>
            An estimate now beats an exact figure never. Your coach sees it
            marked as an estimate.
          </Text>
          <TextInput
            style={s.input} value={qaName} onChangeText={setQaName}
            placeholder="What was it?" placeholderTextColor={color.textMuted}
          />
          <View style={s.row}>
            <TextInput
              style={[s.input, s.inputHalf]} value={qaKcal} onChangeText={setQaKcal}
              keyboardType="number-pad" placeholder="kcal"
              placeholderTextColor={color.textMuted}
            />
            <TextInput
              style={[s.input, s.inputHalf]} value={qaProtein} onChangeText={setQaProtein}
              keyboardType="decimal-pad" placeholder="protein g"
              placeholderTextColor={color.textMuted}
            />
          </View>
          <Pressable style={s.primary} onPress={saveQuickAdd}>
            <Text style={s.primaryText}>Add</Text>
          </Pressable>
        </View>
      )}

      {/* --- Search results ------------------------------------------- */}
      {searching && <ActivityIndicator color={color.ice} style={{ marginTop: space.md }} />}

      {results && results.length > 0 && (
        <>
          <Text style={s.section}>Results</Text>
          {results.map((food, i) => (
            <Pressable
              key={`${food.source}-${food.sourceRef}-${i}`}
              style={s.foodRow}
              onPress={() => add(food, food.servingG ? 1 : 100, food.servingG ? 'serving' : 'g')}
            >
              <View style={s.foodBody}>
                <Text style={s.foodName} numberOfLines={1}>{food.name}</Text>
                <Text style={s.muted}>
                  {food.brand ? `${food.brand} · ` : ''}
                  {kjToKcal(food.energyKj)} kcal/100g
                  {food.proteinG != null ? ` · ${Math.round(food.proteinG)}g protein` : ''}
                </Text>
              </View>
              {/* Provenance, quietly. USDA numbers are government-curated;
                  crowd-sourced ones are not, and the difference is real. */}
              {food.verified && <Text style={s.verified}>USDA</Text>}
            </Pressable>
          ))}
        </>
      )}

      {results && results.length === 0 && !searching && (
        <Text style={s.body}>Nothing found. Try quick add.</Text>
      )}

      {/* --- Recents -------------------------------------------------- */}
      {!results && recent.length > 0 && (
        <>
          <Text style={s.section}>Eaten before</Text>
          {recent.map((f) => (
            <Pressable
              key={f.id}
              style={s.foodRow}
              onPress={() => add(
                {
                  source: f.source, sourceRef: f.source_ref, barcode: f.barcode,
                  name: f.name, brand: f.brand, basis: 'per_100g',
                  energyKj: f.energy_kj, proteinG: f.protein_g, carbsG: f.carbs_g,
                  fatG: f.fat_g, fiberG: f.fiber_g, sugarG: null, sodiumMg: null,
                  servingLabel: f.serving_label, servingG: f.serving_g,
                  verified: !!f.verified,
                },
                f.serving_g ? 1 : 100,
                f.serving_g ? 'serving' : 'g',
              )}
            >
              <View style={s.foodBody}>
                <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
                <Text style={s.muted}>{kjToKcal(f.energy_kj)} kcal/100g</Text>
              </View>
            </Pressable>
          ))}
        </>
      )}

      {/* --- Today ---------------------------------------------------- */}
      <Text style={s.section}>Today</Text>
      {entries.length === 0 ? (
        <Text style={s.body}>Nothing logged yet.</Text>
      ) : (
        SLOTS.concat([{ key: 'unsorted', label: 'Other' }]).map(({ key, label }) => {
          const inSlot = entries.filter((e) => e.mealSlot === key);
          if (inSlot.length === 0) return null;
          return (
            <View key={key} style={s.slotGroup}>
              <Text style={s.slotLabel}>{label.toUpperCase()}</Text>
              {inSlot.map((e) => (
                <Pressable
                  key={e.clientGeneratedId}
                  style={s.entryRow}
                  onLongPress={async () => {
                    await removeEntry(e.clientGeneratedId);
                    await refresh();
                  }}
                >
                  <View style={s.foodBody}>
                    <Text style={s.foodName} numberOfLines={1}>{e.displayName}</Text>
                    <Text style={s.muted}>
                      {e.quantity}{e.unit === 'serving' ? ' serving' : e.unit}
                      {' · '}{kjToKcal(e.energyKj)} kcal
                      {e.source === 'manual' ? ' · estimate' : ''}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          );
        })
      )}

      <Text style={s.offlineNote}>
        Saves instantly, syncs when you're back online. Hold an entry to remove it.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.sm },

  eyebrow: { ...t.label, color: color.ice, fontSize: 11 },
  title:   { ...t.display, color: color.text, fontSize: 30 },
  section: { ...t.label, color: color.textMuted, fontSize: 11, marginTop: space.lg },
  body:    { ...t.body, color: color.textMuted, fontSize: 14, lineHeight: 20 },
  muted:   { ...t.body, color: color.textMuted, fontSize: 12 },
  error:   { ...t.body, color: color.danger, fontSize: 14 },

  totals:    { flexDirection: 'row', alignItems: 'baseline', gap: space.xs,
               marginBottom: space.sm },
  totalBig:  { ...t.data, color: color.text, fontSize: 34 },
  totalUnit: { ...t.body, color: color.textMuted, fontSize: 13 },
  totalSep:  { ...t.body, color: color.textMuted, fontSize: 13 },
  totalSmall:{ ...t.data, color: color.textMuted, fontSize: 13 },

  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip:       { paddingVertical: space.sm, paddingHorizontal: space.md,
                borderRadius: radius.pill, borderWidth: 1, borderColor: color.line },
  chipActive: { backgroundColor: color.iceDim, borderColor: color.ice },
  chipText:      { ...t.body, color: color.textMuted, fontSize: 14 },
  chipTextActive:{ color: color.ice },

  search: { ...t.body, backgroundColor: color.surface, color: color.text,
            borderRadius: radius.md, borderWidth: 1, borderColor: color.line,
            paddingHorizontal: space.md, paddingVertical: space.md,
            fontSize: 16, marginTop: space.md },

  row:       { flexDirection: 'row', gap: space.sm },
  secondary: { flex: 1, borderWidth: 1, borderColor: color.line,
               borderRadius: radius.md, paddingVertical: space.md,
               alignItems: 'center' },
  secondaryText: { ...t.label, color: color.text, fontSize: 14 },

  card:      { backgroundColor: color.surface, borderRadius: radius.md,
               padding: space.md, gap: space.sm, borderWidth: 1,
               borderColor: color.line, marginTop: space.sm },
  cardTitle: { ...t.display, color: color.text, fontSize: 16 },

  input:     { ...t.data, backgroundColor: color.ground, color: color.text,
               borderRadius: radius.sm, borderWidth: 1, borderColor: color.line,
               paddingHorizontal: space.md, paddingVertical: space.md,
               fontSize: 16 },
  inputHalf: { flex: 1 },

  primary:     { backgroundColor: color.ice, borderRadius: radius.md,
                 paddingVertical: space.md, alignItems: 'center' },
  primaryText: { ...t.label, color: color.ground, fontSize: 16 },

  foodRow:  { flexDirection: 'row', alignItems: 'center', gap: space.sm,
              backgroundColor: color.surface, borderRadius: radius.sm,
              padding: space.md },
  foodBody: { flex: 1, gap: 2 },
  foodName: { ...t.body, color: color.text, fontSize: 15 },
  verified: { ...t.label, color: color.positive, fontSize: 10 },

  slotGroup: { gap: space.xs, marginTop: space.sm },
  slotLabel: { ...t.label, color: color.textMuted, fontSize: 10 },
  entryRow:  { flexDirection: 'row', alignItems: 'center',
               backgroundColor: color.surface, borderRadius: radius.sm,
               padding: space.md },

  offlineNote: { ...t.body, color: color.textMuted, fontSize: 12,
                 textAlign: 'center', marginTop: space.lg },
});
