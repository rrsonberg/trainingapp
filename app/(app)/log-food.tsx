/**
 * Log food.
 *
 * The screen a client opens four times a day, so every path to a logged entry
 * is short and the fastest one — something eaten before, at the portion they
 * usually eat — is on screen when it opens.
 *
 * Three ways in:
 *   search    whole foods and packaged goods, weighed
 *   scan      a barcode, weighed or by package serving
 *   my foods  their own recipes, labels and restaurant meals, entered once
 *
 * Chain-restaurant lookup is not a feature here. The commercial database that
 * would provide it costs more than it is worth, and My foods covers the same
 * ground for anyone who eats at the same handful of places — build the item
 * once from the chain's published numbers and it is one tap forever after.
 *
 * Picking a food never logs it. It opens a portion step, because anybody
 * serious about tracking weighs first and types the number off the scale. The
 * macros update as they type so a mis-keyed portion is obvious before it is
 * committed.
 *
 * Saves are local. Nothing here awaits the network.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useIdentity } from '../../src/lib/auth';
import {
  entriesForDay, logFood, quickAdd, recentFoods, removeEntry, foodFromCache,
  saveCustomFood, listCustomFoods, deleteCustomFood,
  type FoodEntry, type MealSlot,
} from '../../src/repositories/nutrition';
import {
  searchFoods, buildCustomFood,
  kjToKcal, scaleMacros, toGrams, UNIT_LABEL,
  type FoodResult, type PortionUnit,
} from '../../src/lib/foodApi';
import { today } from '../../src/lib/day';
import { color, radius, space, type as t } from '../../src/theme';

const SLOTS: { key: MealSlot; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snack' },
];

type Tab = 'search' | 'mine';

/** Slot defaults to the time of day. Nobody logging at 8am wants to tap
 *  "breakfast" first — but they can change it, because plenty of people log
 *  last night's dinner this morning. */
function slotForNow(): MealSlot {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

type Picked = { food: FoodResult; quantity: string; unit: PortionUnit };

export default function LogFoodScreen() {
  const { clientId } = useIdentity();
  const day = today();

  const [tab, setTab] = useState<Tab>('search');
  const [slot, setSlot] = useState<MealSlot>(slotForNow());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Create-a-food form
  const [showBuilder, setShowBuilder] = useState(false);
  const [cfName, setCfName] = useState('');
  const [cfServing, setCfServing] = useState('');
  const [cfLabel, setCfLabel] = useState('');
  const [cfKcal, setCfKcal] = useState('');
  const [cfProtein, setCfProtein] = useState('');
  const [cfCarbs, setCfCarbs] = useState('');
  const [cfFat, setCfFat] = useState('');

  // One-off quick add
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [qaName, setQaName] = useState('');
  const [qaKcal, setQaKcal] = useState('');
  const [qaProtein, setQaProtein] = useState('');

  const refresh = useCallback(async () => {
    const [e, r, m] = await Promise.all([
      entriesForDay(clientId, day),
      recentFoods(clientId),
      listCustomFoods(),
    ]);
    setEntries(e);
    setRecent(r);
    setMine(m);
  }, [clientId, day]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Debounced: firing a request per keystroke burns the free tier and makes
  // the list flicker through three wrong answers on the way to the right one.
  useEffect(() => {
    if (tab === 'mine') { setResults(null); return; }
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
  }, [query, tab]);

  function pick(food: FoodResult, quantity?: number, unit?: PortionUnit) {
    setError(null);
    if (quantity != null && unit) setPicked({ food, quantity: String(quantity), unit });
    else if (food.servingG) setPicked({ food, quantity: '1', unit: 'serving' });
    else setPicked({ food, quantity: '', unit: 'oz' });
  }

  async function savePicked() {
    if (!picked) return;
    const qty = Number(picked.quantity);
    if (!Number.isFinite(qty) || qty <= 0) { setError('Enter how much you had.'); return; }

    setSaving(true);
    setError(null);
    try {
      await logFood({
        clientId, food: picked.food, quantity: qty, unit: picked.unit,
        mealSlot: slot, day,
      });
      setPicked(null);
      setQuery('');
      setResults(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not log that.');
    } finally {
      setSaving(false);
    }
  }

  async function saveBuilder() {
    setError(null);
    try {
      const food = buildCustomFood({
        name: cfName,
        servingG: Number(cfServing),
        servingLabel: cfLabel || null,
        kcal: Number(cfKcal),
        proteinG: cfProtein ? Number(cfProtein) : null,
        carbsG: cfCarbs ? Number(cfCarbs) : null,
        fatG: cfFat ? Number(cfFat) : null,
      });
      await saveCustomFood(food);
      setCfName(''); setCfServing(''); setCfLabel('');
      setCfKcal(''); setCfProtein(''); setCfCarbs(''); setCfFat('');
      setShowBuilder(false);
      await refresh();
      setTab('mine');
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that food.');
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
        clientId, description: qaName.trim(), energyKj: kcal * 4.184,
        proteinG: qaProtein ? Number(qaProtein) : null, mealSlot: slot, day,
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

  // ---- Portion step ------------------------------------------------------

  if (picked) {
    const qty = Number(picked.quantity);
    const valid = Number.isFinite(qty) && qty > 0;

    let live: { kcal: number; protein: number | null; carbs: number | null;
                fat: number | null; grams: number } | null = null;
    if (valid) {
      try {
        const m = scaleMacros(picked.food, qty, picked.unit);
        live = {
          kcal: kjToKcal(m.energyKj),
          protein: m.proteinG, carbs: m.carbsG, fat: m.fatG,
          grams: toGrams(picked.food, qty, picked.unit),
        };
      } catch { live = null; }
    }

    const units: PortionUnit[] = picked.food.servingG
      ? ['g', 'oz', 'lb', 'serving']
      : ['g', 'oz', 'lb'];

    return (
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>PORTION</Text>
        <Text style={s.title} numberOfLines={2}>{picked.food.name}</Text>
        {picked.food.brand ? <Text style={s.muted}>{picked.food.brand}</Text> : null}

        <View style={s.card}>
          <Text style={s.fieldLabel}>HOW MUCH</Text>
          <TextInput
            style={s.bigInput}
            value={picked.quantity}
            onChangeText={(v) => { setPicked({ ...picked, quantity: v }); setError(null); }}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={color.textMuted}
            autoFocus
          />
          <View style={s.unitRow}>
            {units.map((u) => {
              const on = picked.unit === u;
              return (
                <Pressable key={u} onPress={() => setPicked({ ...picked, unit: u })}
                  style={[s.unit, on && s.unitOn]}>
                  <Text style={[s.unitText, on && s.unitTextOn]}>{UNIT_LABEL[u]}</Text>
                </Pressable>
              );
            })}
          </View>
          {picked.food.servingLabel ? (
            <Text style={s.muted}>
              Serving: {picked.food.servingLabel}
              {picked.food.servingG ? ` (${Math.round(picked.food.servingG)} g)` : ''}
            </Text>
          ) : null}
        </View>

        {live ? (
          <View style={s.liveCard}>
            <Text style={s.liveKcal}>{live.kcal.toLocaleString()} kcal</Text>
            <Text style={s.muted}>
              {picked.unit !== 'g' ? `${Math.round(live.grams)} g · ` : ''}
              {live.protein != null ? `${Math.round(live.protein)}P` : '—'}
              {' · '}{live.carbs != null ? `${Math.round(live.carbs)}C` : '—'}
              {' · '}{live.fat != null ? `${Math.round(live.fat)}F` : '—'}
            </Text>
          </View>
        ) : (
          <Text style={s.body}>Enter an amount to see the macros.</Text>
        )}

        {error && <Text style={s.error}>{error}</Text>}

        <Pressable
          style={[s.primary, (!valid || saving) && s.primaryDisabled]}
          onPress={savePicked} disabled={!valid || saving}
        >
          {saving ? <ActivityIndicator color={color.ground} />
                  : <Text style={s.primaryText}>Add to {slot === 'unsorted' ? 'today' : slot}</Text>}
        </Pressable>

        <Pressable style={s.secondary} onPress={() => { setPicked(null); setError(null); }}>
          <Text style={s.secondaryText}>Back</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ---- Main --------------------------------------------------------------

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>FOOD</Text>
      <Text style={s.title}>Log</Text>

      <View style={s.totals}>
        <Text style={s.totalBig}>{dayKcal.toLocaleString()}</Text>
        <Text style={s.totalUnit}>kcal today</Text>
        <Text style={s.totalSep}>·</Text>
        <Text style={s.totalSmall}>{dayProtein}g protein</Text>
      </View>

      <View style={s.chips}>
        {SLOTS.map(({ key, label }) => {
          const active = key === slot;
          return (
            <Pressable key={key} onPress={() => setSlot(key)}
              accessibilityRole="button" accessibilityState={{ selected: active }}
              style={[s.chip, active && s.chipActive]}>
              <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.tabs}>
        {([
          { key: 'search', label: 'Foods' },
          { key: 'mine', label: 'My foods' },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => {
          const on = tab === key;
          return (
            <Pressable key={key} onPress={() => { setTab(key); setResults(null); }}
              style={[s.tab, on && s.tabOn]}>
              <Text style={[s.tabText, on && s.tabTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'search' && (
        <>
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
        </>
      )}

      {tab === 'mine' && (
        <Pressable style={s.primary} onPress={() => setShowBuilder((v) => !v)}>
          <Text style={s.primaryText}>{showBuilder ? 'Cancel' : 'Create a food'}</Text>
        </Pressable>
      )}

      {error && <Text style={s.error}>{error}</Text>}

      {/* --- Create a food ------------------------------------------- */}
      {showBuilder && (
        <View style={s.card}>
          <Text style={s.cardTitle}>New food</Text>
          <Text style={s.body}>
            Copy the numbers off the label, your recipe, or the restaurant's
            nutrition page. Enter them for ONE serving — it scales by weight
            from there, so you can log 1.5 servings or 140 g later and the
            maths holds.
          </Text>

          <TextInput style={s.input} value={cfName} onChangeText={setCfName}
            placeholder="Name (e.g. Chipotle chicken bowl)"
            placeholderTextColor={color.textMuted} />

          <View style={s.row}>
            <TextInput style={[s.input, s.half]} value={cfServing} onChangeText={setCfServing}
              keyboardType="decimal-pad" placeholder="serving weight (g)"
              placeholderTextColor={color.textMuted} />
            <TextInput style={[s.input, s.half]} value={cfLabel} onChangeText={setCfLabel}
              placeholder="e.g. 1 bowl" placeholderTextColor={color.textMuted} />
          </View>

          <TextInput style={s.input} value={cfKcal} onChangeText={setCfKcal}
            keyboardType="number-pad" placeholder="calories per serving"
            placeholderTextColor={color.textMuted} />

          <View style={s.row}>
            <TextInput style={[s.input, s.third]} value={cfProtein} onChangeText={setCfProtein}
              keyboardType="decimal-pad" placeholder="P (g)" placeholderTextColor={color.textMuted} />
            <TextInput style={[s.input, s.third]} value={cfCarbs} onChangeText={setCfCarbs}
              keyboardType="decimal-pad" placeholder="C (g)" placeholderTextColor={color.textMuted} />
            <TextInput style={[s.input, s.third]} value={cfFat} onChangeText={setCfFat}
              keyboardType="decimal-pad" placeholder="F (g)" placeholderTextColor={color.textMuted} />
          </View>

          <Pressable style={s.primary} onPress={saveBuilder}>
            <Text style={s.primaryText}>Save food</Text>
          </Pressable>
        </View>
      )}

      {/* --- Quick add ------------------------------------------------ */}
      {showQuickAdd && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Quick add</Text>
          <Text style={s.body}>
            Counted once, not saved. An estimate now beats an exact figure
            never — your coach sees it marked as an estimate.
          </Text>
          <TextInput style={s.input} value={qaName} onChangeText={setQaName}
            placeholder="What was it?" placeholderTextColor={color.textMuted} />
          <View style={s.row}>
            <TextInput style={[s.input, s.half]} value={qaKcal} onChangeText={setQaKcal}
              keyboardType="number-pad" placeholder="kcal" placeholderTextColor={color.textMuted} />
            <TextInput style={[s.input, s.half]} value={qaProtein} onChangeText={setQaProtein}
              keyboardType="decimal-pad" placeholder="protein g" placeholderTextColor={color.textMuted} />
          </View>
          <Pressable style={s.primary} onPress={saveQuickAdd}>
            <Text style={s.primaryText}>Add</Text>
          </Pressable>
        </View>
      )}

      {searching && <ActivityIndicator color={color.ice} style={{ marginTop: space.md }} />}

      {/* --- Results -------------------------------------------------- */}
      {results && results.length > 0 && (
        <>
          <Text style={s.section}>Results</Text>
          {results.map((food, i) => (
            <Pressable key={`${food.source}-${food.sourceRef}-${i}`}
              style={s.foodRow} onPress={() => pick(food)}>
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
        <Text style={s.body}>
          Nothing found. Quick add it, or build it under My foods if you eat it often.
        </Text>
      )}

      {/* --- My foods ------------------------------------------------- */}
      {tab === 'mine' && !showBuilder && (
        mine.length === 0 ? (
          <Text style={s.body}>
            Nothing yet. Foods you build here stay available, scale by weight,
            and log in one tap — useful for recipes you make often and for
            meals from the places you eat at regularly.
          </Text>
        ) : (
          <>
            <Text style={s.section}>Saved</Text>
            {mine.map((f) => (
              <Pressable key={f.id} style={s.foodRow}
                onPress={() => pick(foodFromCache(f))}
                onLongPress={async () => { await deleteCustomFood(f.id); await refresh(); }}>
                <View style={s.foodBody}>
                  <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
                  <Text style={s.muted}>
                    {kjToKcal(f.energy_kj * ((f.serving_g ?? 100) / 100))} kcal
                    {f.serving_label ? ` / ${f.serving_label}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        )
      )}

      {/* --- Recents -------------------------------------------------- */}
      {tab === 'search' && !results && recent.length > 0 && (
        <>
          <Text style={s.section}>Eaten before</Text>
          {recent.map((f) => (
            <Pressable key={f.id} style={s.foodRow}
              onPress={() => pick(
                foodFromCache(f),
                f.last_quantity ?? undefined,
                (f.last_unit as PortionUnit) ?? undefined,
              )}>
              <View style={s.foodBody}>
                <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
                <Text style={s.muted}>
                  {f.last_quantity
                    ? `last: ${f.last_quantity} ${UNIT_LABEL[f.last_unit as PortionUnit] ?? f.last_unit}`
                    : `${kjToKcal(f.energy_kj)} kcal/100g`}
                </Text>
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
                <Pressable key={e.clientGeneratedId} style={s.entryRow}
                  onLongPress={async () => { await removeEntry(e.clientGeneratedId); await refresh(); }}>
                  <View style={s.foodBody}>
                    <Text style={s.foodName} numberOfLines={1}>{e.displayName}</Text>
                    <Text style={s.muted}>
                      {e.quantity} {UNIT_LABEL[e.unit] ?? e.unit}
                      {e.grams && e.unit !== 'g' ? ` (${Math.round(e.grams)} g)` : ''}
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

  tabs:      { flexDirection: 'row', gap: space.xs, marginTop: space.md },
  tab:       { flex: 1, paddingVertical: space.sm, alignItems: 'center',
               borderBottomWidth: 2, borderBottomColor: color.line },
  tabOn:     { borderBottomColor: color.ice },
  tabText:   { ...t.label, color: color.textMuted, fontSize: 13 },
  tabTextOn: { color: color.ice },

  search: { ...t.body, backgroundColor: color.surface, color: color.text,
            borderRadius: radius.md, borderWidth: 1, borderColor: color.line,
            paddingHorizontal: space.md, paddingVertical: space.md,
            fontSize: 16, marginTop: space.sm },

  row:       { flexDirection: 'row', gap: space.sm },
  half:      { flex: 1 },
  third:     { flex: 1 },
  secondary: { flex: 1, borderWidth: 1, borderColor: color.line,
               borderRadius: radius.md, paddingVertical: space.md,
               alignItems: 'center' },
  secondaryText: { ...t.label, color: color.text, fontSize: 14 },

  card:      { backgroundColor: color.surface, borderRadius: radius.md,
               padding: space.md, gap: space.sm, borderWidth: 1,
               borderColor: color.line, marginTop: space.md },
  cardTitle: { ...t.display, color: color.text, fontSize: 16 },

  fieldLabel:{ ...t.label, color: color.textMuted, fontSize: 11 },
  bigInput:  { ...t.data, backgroundColor: color.ground, color: color.text,
               borderRadius: radius.sm, borderWidth: 1, borderColor: color.line,
               paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 34 },
  input:     { ...t.data, backgroundColor: color.ground, color: color.text,
               borderRadius: radius.sm, borderWidth: 1, borderColor: color.line,
               paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 16 },

  unitRow:    { flexDirection: 'row', gap: space.xs },
  unit:       { flex: 1, paddingVertical: space.md, alignItems: 'center',
                borderRadius: radius.sm, borderWidth: 1, borderColor: color.line },
  unitOn:     { backgroundColor: color.iceDim, borderColor: color.ice },
  unitText:   { ...t.body, color: color.textMuted, fontSize: 14 },
  unitTextOn: { color: color.ice },

  liveCard: { backgroundColor: color.surface, borderRadius: radius.md,
              borderLeftWidth: 3, borderLeftColor: color.ice,
              padding: space.md, gap: space.xs, marginTop: space.md },
  liveKcal: { ...t.data, color: color.text, fontSize: 30 },

  primary:         { backgroundColor: color.ice, borderRadius: radius.md,
                     paddingVertical: space.md + 2, alignItems: 'center',
                     marginTop: space.md },
  primaryDisabled: { opacity: 0.4 },
  primaryText:     { ...t.display, color: color.ground, fontSize: 16 },

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
