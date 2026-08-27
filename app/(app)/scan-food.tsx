/**
 * Barcode scanner.
 *
 * The fastest path to a logged entry, and the one that decides whether a
 * client keeps logging past week two. So it is built around not making them
 * wait: the cache is checked before the network, and a scan seen on this
 * device before resolves with no request at all.
 *
 * A scan never logs on its own. It resolves the food and shows a portion step,
 * because a silent auto-log of the wrong amount is worse than an extra tap —
 * the client has to notice it happened before they can fix it. Weight units
 * lead, since the package goes on the scale more often than it gets eaten
 * whole.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useIdentity } from '../../src/lib/auth';
import {
  lookupBarcode, scaleMacros, toGrams, kjToKcal, UNIT_LABEL,
  type FoodResult, type PortionUnit,
} from '../../src/lib/foodApi';
import { barcodeFromCache, logFood, type MealSlot } from '../../src/repositories/nutrition';
import { color, radius, space, type as t } from '../../src/theme';

/** EAN-13 covers UPC-A, which is what most US packaging carries. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_e'] as const;

type Stage = 'scanning' | 'looking-up' | 'confirm' | 'not-found';

export default function ScanFoodScreen() {
  const { clientId } = useIdentity();
  const params = useLocalSearchParams<{ slot?: string }>();
  const slot = (params.slot as MealSlot) ?? 'unsorted';

  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>('scanning');
  const [food, setFood] = useState<FoodResult | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<PortionUnit>('g');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The camera fires this continuously while a code is in frame. Without a
  // guard a single barcode triggers a dozen lookups in half a second.
  const busy = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission]);

  const onScan = useCallback(async ({ data }: { data: string }) => {
    if (busy.current) return;
    busy.current = true;

    const code = data.replace(/\D/g, '');
    setScanned(code);
    setError(null);
    setStage('looking-up');

    try {
      // Cache first. A repeat scan should not wait on a network round trip.
      let result = await barcodeFromCache(code);
      if (!result) result = await lookupBarcode(code);

      if (!result) { setStage('not-found'); return; }

      setFood(result);
      // Default to the package serving when the source gives one, since that
      // is what somebody scanning a wrapper usually ate. They can switch to
      // weight in one tap if they portioned it out.
      if (result.servingG) { setUnit('serving'); setAmount('1'); }
      else { setUnit('g'); setAmount(''); }
      setStage('confirm');
    } catch (e: any) {
      setError(e?.message ?? 'Lookup failed.');
      setStage('not-found');
    }
  }, []);

  function scanAgain() {
    busy.current = false;
    setFood(null);
    setScanned(null);
    setError(null);
    setStage('scanning');
  }

  async function save() {
    if (!food) return;
    const qty = Number(amount);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter how much you had.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await logFood({
        clientId, food, quantity: qty, unit, mealSlot: slot, source: 'scan',
      });
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not log that.');
      setSaving(false);
    }
  }

  // --- Permission states ---------------------------------------------------

  if (!permission) {
    return <View style={s.boot}><ActivityIndicator color={color.ice} /></View>;
  }

  if (!permission.granted) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>SCAN</Text>
        <Text style={s.title}>Camera access</Text>
        <Text style={s.body}>
          Scanning needs the camera. Nothing is recorded or uploaded — the
          barcode is read on your phone and only the number is looked up.
        </Text>
        {permission.canAskAgain ? (
          <Pressable style={s.primary} onPress={requestPermission}>
            <Text style={s.primaryText}>Allow camera</Text>
          </Pressable>
        ) : (
          <Text style={s.body}>
            Turn it on in Settings → Coach → Camera, then come back.
          </Text>
        )}
        <Pressable style={s.secondary} onPress={() => router.back()}>
          <Text style={s.secondaryText}>Search instead</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // --- Scanning ------------------------------------------------------------

  if (stage === 'scanning' || stage === 'looking-up') {
    return (
      <View style={s.screen}>
        <CameraView
          style={s.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={stage === 'scanning' ? onScan : undefined}
        />
        <View style={s.overlay}>
          <View style={s.reticle} />
          <Text style={s.overlayText}>
            {stage === 'looking-up' ? 'Looking it up…' : 'Point at the barcode'}
          </Text>
        </View>
        <Pressable style={s.cancel} onPress={() => router.back()}>
          <Text style={s.secondaryText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // --- Not found -----------------------------------------------------------

  if (stage === 'not-found') {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>SCAN</Text>
        <Text style={s.title}>Not in the database</Text>
        <Text style={s.body}>
          {error
            ? error
            : `Barcode ${scanned} isn't listed. That's common with small brands and store labels.`}
        </Text>
        <Text style={s.body}>
          Search the name instead, or quick add the macros off the label — it
          takes fifteen seconds and it counts the same.
        </Text>
        <Pressable style={s.primary} onPress={scanAgain}>
          <Text style={s.primaryText}>Scan another</Text>
        </Pressable>
        <Pressable style={s.secondary} onPress={() => router.back()}>
          <Text style={s.secondaryText}>Back to search</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // --- Confirm -------------------------------------------------------------

  const qty = Number(amount);
  const valid = Number.isFinite(qty) && qty > 0;

  let live: { kcal: number; protein: number | null; grams: number } | null = null;
  if (food && valid) {
    try {
      const m = scaleMacros(food, qty, unit);
      live = {
        kcal: kjToKcal(m.energyKj),
        protein: m.proteinG,
        grams: toGrams(food, qty, unit),
      };
    } catch { live = null; }
  }

  const units: PortionUnit[] = food?.servingG
    ? ['g', 'oz', 'lb', 'serving']
    : ['g', 'oz', 'lb'];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>SCAN</Text>
      <Text style={s.title} numberOfLines={2}>{food?.name}</Text>
      {food?.brand ? <Text style={s.muted}>{food.brand}</Text> : null}

      <View style={s.card}>
        <Text style={s.fieldLabel}>WEIGHED AMOUNT</Text>
        <TextInput
          style={s.bigInput}
          value={amount}
          onChangeText={(v) => { setAmount(v); setError(null); }}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={color.textMuted}
          autoFocus
        />

        <View style={s.unitRow}>
          {units.map((u) => {
            const on = unit === u;
            return (
              <Pressable key={u} onPress={() => setUnit(u)} style={[s.unit, on && s.unitOn]}>
                <Text style={[s.unitText, on && s.unitTextOn]}>{UNIT_LABEL[u]}</Text>
              </Pressable>
            );
          })}
        </View>

        {food?.servingLabel ? (
          <Text style={s.muted}>
            Label serving: {food.servingLabel}
            {food.servingG ? ` (${food.servingG} g)` : ''}
          </Text>
        ) : null}
      </View>

      {/* The number before it is committed, so a wrong portion is obvious
          while it is still one tap to fix. */}
      {live ? (
        <View style={s.liveCard}>
          <Text style={s.liveKcal}>{live.kcal.toLocaleString()} kcal</Text>
          <Text style={s.muted}>
            {unit !== 'g' ? `${Math.round(live.grams)} g` : `${Math.round(qty)} g`}
            {live.protein != null ? ` · ${Math.round(live.protein)}g protein` : ''}
          </Text>
        </View>
      ) : (
        <Text style={s.body}>Enter a weight to see the macros.</Text>
      )}

      {food?.verified ? (
        <Text style={s.verified}>USDA data</Text>
      ) : (
        <Text style={s.muted}>
          Crowd-sourced label data — check it against the package if it looks off.
        </Text>
      )}

      {error && <Text style={s.error}>{error}</Text>}

      <Pressable
        style={[s.primary, (!valid || saving) && s.primaryDisabled]}
        onPress={save}
        disabled={!valid || saving}
      >
        {saving
          ? <ActivityIndicator color={color.ground} />
          : <Text style={s.primaryText}>Log it</Text>}
      </Pressable>

      <Pressable style={s.secondary} onPress={scanAgain}>
        <Text style={s.secondaryText}>Scan something else</Text>
      </Pressable>

      <Text style={s.offlineNote}>
        Saves instantly, syncs when you're back online.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.sm },
  boot:    { flex: 1, alignItems: 'center', justifyContent: 'center',
             backgroundColor: color.ground },

  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: space.lg,
  },
  reticle: {
    width: '70%', height: 160,
    borderWidth: 2, borderColor: color.ice, borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  overlayText: { ...t.label, color: color.text, fontSize: 14 },
  cancel: {
    position: 'absolute', bottom: space.xl, alignSelf: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderRadius: radius.pill, backgroundColor: color.surface,
  },

  eyebrow: { ...t.label, color: color.ice, fontSize: 11 },
  title:   { ...t.display, color: color.text, fontSize: 26 },
  body:    { ...t.body, color: color.textMuted, fontSize: 15, lineHeight: 22 },
  muted:   { ...t.body, color: color.textMuted, fontSize: 13 },
  error:   { ...t.body, color: color.danger, fontSize: 14 },

  card:      { backgroundColor: color.surface, borderRadius: radius.md,
               padding: space.md, gap: space.sm, borderWidth: 1,
               borderColor: color.line, marginTop: space.md },
  fieldLabel:{ ...t.label, color: color.textMuted, fontSize: 11 },
  bigInput:  { ...t.data, backgroundColor: color.ground, color: color.text,
               borderRadius: radius.sm, borderWidth: 1, borderColor: color.line,
               paddingHorizontal: space.md, paddingVertical: space.md,
               fontSize: 34 },

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
  verified: { ...t.label, color: color.positive, fontSize: 11 },

  primary:         { backgroundColor: color.ice, borderRadius: radius.md,
                     paddingVertical: space.md + 2, alignItems: 'center',
                     marginTop: space.md },
  primaryDisabled: { opacity: 0.4 },
  primaryText:     { ...t.display, color: color.ground, fontSize: 16 },

  secondary:     { borderWidth: 1, borderColor: color.line, borderRadius: radius.md,
                   paddingVertical: space.md, alignItems: 'center' },
  secondaryText: { ...t.label, color: color.text, fontSize: 14 },

  offlineNote: { ...t.body, color: color.textMuted, fontSize: 12,
                 textAlign: 'center', marginTop: space.md },
});
