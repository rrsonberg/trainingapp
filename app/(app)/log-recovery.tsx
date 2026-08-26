/**
 * Log a recovery session.
 *
 * Deliberately built third rather than last: it is the differentiator, it is
 * simpler than the strength logger, and it proves the polymorphic session
 * model end to end — one screen renders fourteen session types from the
 * parameter definitions, with no per-type branching.
 *
 * Note what this screen does NOT do: await the network. Save writes to SQLite
 * and returns. Sync happens later, on its own schedule.
 */

import { useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { SESSION_TYPES, type SessionTypeKey } from '../../src/types/sessions';
import { createSession, completeSession } from '../../src/repositories/sessions';
import { useIdentity } from '../../src/lib/auth';
import { color, radius, space, type as t } from '../../src/theme';
import { fToC, displayDuration } from '../../src/lib/units';

const RECOVERY_TYPES = Object.values(SESSION_TYPES)
  .filter((d) => d.family === 'recovery')
  .map((d) => d.key);

export default function LogRecoveryScreen() {
  const { tenantId, clientId } = useIdentity();
  const [selected, setSelected] = useState<SessionTypeKey>('cold_exposure');
  const [minutes, setMinutes] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const def = SESSION_TYPES[selected];

  function setField(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const parameters: Record<string, unknown> = {};
      for (const field of def.parameters) {
        const raw = values[field.key];
        if (raw == null || raw === '') continue;
        if (field.input === 'number') {
          const n = Number(raw);
          if (Number.isNaN(n)) throw new Error(`${field.label} must be a number`);
          // Storage is SI. The input is Fahrenheit; convert here, once.
          parameters[field.key] =
            field.unit === 'celsius' ? fToC(n) : n;
        } else {
          parameters[field.key] = raw;
        }
      }

      const session = await createSession({
        tenantId,
        clientId,
        sessionType: selected,
        parameters,
      });

      const mins = Number(minutes || '0');
      await completeSession(session.clientGeneratedId, {
        durationSeconds: Math.round(mins * 60),
      });

      router.back();
    } catch (e: any) {
      // Spec E: errors say what happened and how to fix it. No apologies.
      setError(e?.message ?? 'Could not save this session.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>RECOVERY</Text>
      <Text style={s.title}>Log a session</Text>

      <View style={s.chips}>
        {RECOVERY_TYPES.map((key) => {
          const active = key === selected;
          return (
            <Pressable
              key={key}
              onPress={() => { setSelected(key); setValues({}); setError(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[s.chip, active && s.chipActive]}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {SESSION_TYPES[key].label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Field label="Duration" suffix="min">
        <TextInput
          style={s.input}
          value={minutes}
          onChangeText={setMinutes}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={color.textMuted}
        />
      </Field>

      {def.parameters.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          suffix={
            field.unit === 'celsius' ? '°F'
            : field.unit === 'ata' ? 'ATA'
            : field.unit === 'mmhg' ? 'mmHg'
            : undefined
          }
        >
          {field.input === 'select' ? (
            <View style={s.optionRow}>
              {(field.options ?? []).map((opt) => {
                const active = values[field.key] === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setField(field.key, opt)}
                    style={[s.option, active && s.optionActive]}
                  >
                    <Text style={[s.optionText, active && s.optionTextActive]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              style={s.input}
              value={values[field.key] ?? ''}
              onChangeText={(v) => setField(field.key, v)}
              keyboardType={field.input === 'number' ? 'decimal-pad' : 'default'}
              placeholder={field.required ? 'Required' : 'Optional'}
              placeholderTextColor={color.textMuted}
            />
          )}
        </Field>
      ))}

      {def.requiresScreening && (
        <Text style={s.note}>
          First time logging {def.label.toLowerCase()}? You'll be asked to review
          the manufacturer's safety information before this saves.
        </Text>
      )}

      {error && <Text style={s.error}>{error}</Text>}

      <Pressable
        onPress={save}
        disabled={saving}
        style={[s.save, saving && s.saveDisabled]}
        accessibilityRole="button"
      >
        <Text style={s.saveText}>
          {saving ? 'Saving' : `Save ${displayDuration(Number(minutes || 0) * 60)}`}
        </Text>
      </Pressable>

      <Text style={s.offlineNote}>
        Saves instantly, syncs when you're back online.
      </Text>
    </ScrollView>
  );
}

function Field({
  label, suffix, children,
}: { label: string; suffix?: string; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <View style={s.fieldHead}>
        <Text style={s.fieldLabel}>{label.toUpperCase()}</Text>
        {suffix && <Text style={s.fieldSuffix}>{suffix}</Text>}
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.md },

  eyebrow: { ...t.label, color: color.ice, fontSize: 11 },
  title:   { ...t.display, color: color.text, fontSize: 30, marginBottom: space.sm },

  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip:       { paddingVertical: space.sm, paddingHorizontal: space.md,
                borderRadius: radius.pill, borderWidth: 1, borderColor: color.line },
  chipActive: { backgroundColor: color.iceDim, borderColor: color.ice },
  chipText:      { ...t.body, color: color.textMuted, fontSize: 14 },
  chipTextActive:{ color: color.ice },

  field:      { gap: space.sm, marginTop: space.sm },
  fieldHead:  { flexDirection: 'row', justifyContent: 'space-between',
                alignItems: 'baseline' },
  fieldLabel: { ...t.label, color: color.textMuted, fontSize: 11 },
  fieldSuffix:{ ...t.label, color: color.textMuted, fontSize: 11 },

  input: { ...t.data, backgroundColor: color.surface, color: color.text,
           borderRadius: radius.md, paddingHorizontal: space.md,
           paddingVertical: space.md, fontSize: 22,
           borderWidth: 1, borderColor: color.line },

  optionRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option:      { paddingVertical: space.sm, paddingHorizontal: space.md,
                 borderRadius: radius.sm, backgroundColor: color.surface,
                 borderWidth: 1, borderColor: color.line },
  optionActive:{ backgroundColor: color.iceDim, borderColor: color.ice },
  optionText:      { ...t.body, color: color.textMuted, fontSize: 14 },
  optionTextActive:{ color: color.ice },

  note:  { ...t.body, color: color.textMuted, fontSize: 13, lineHeight: 19 },
  error: { ...t.body, color: color.danger, fontSize: 14 },

  save:         { backgroundColor: color.ice, borderRadius: radius.md,
                  paddingVertical: space.md + 2, alignItems: 'center',
                  marginTop: space.md },
  saveDisabled: { opacity: 0.5 },
  saveText:     { ...t.display, color: color.ground, fontSize: 16 },

  offlineNote: { ...t.body, color: color.textMuted, fontSize: 12,
                 textAlign: 'center' },
});
