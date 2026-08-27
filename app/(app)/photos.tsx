/**
 * Progress photos — what the client sees.
 *
 * Three fixed poses, once a week. Fixed because the comparison is the whole
 * value and it only works if the framing is repeatable; a free-for-all camera
 * roll produces twelve weeks of unusable angles.
 *
 * Two things are handled with more care here than anywhere else in the app,
 * because this is the most personal data it holds:
 *
 *   Photos are PRIVATE by default. Nothing reaches the coach until the client
 *   turns sharing on for that week, and the storage policy enforces it
 *   independently — a bug in this screen cannot leak one.
 *
 *   The copy stays clinical. Date, pose, weight. Nothing about the body
 *   itself, no encouragement, no commentary. A progress photo screen that
 *   editorialises is one somebody stops opening.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, ScrollView,
  StyleSheet, Switch, Text, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useIdentity } from '../../src/lib/auth';
import {
  listPhotos, uploadPhoto, signedUrl, setDayVisibility, deletePhoto,
  todayIso, POSES, POSE_LABEL, type Pose, type PhotoRow,
} from '../../src/repositories/photos';
import { color, radius, space, type as t } from '../../src/theme';

/** Monday of the week a date falls in — how weeks are grouped everywhere. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Signed URLs expire, so each thumbnail fetches its own and refreshes when
 *  the path changes. Cheap, and it means no permanent link exists anywhere. */
function SignedImage({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await signedUrl(path);
      if (!cancelled) setUrl(u);
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (!url) return <View style={s.thumb}><ActivityIndicator color={color.textMuted} /></View>;
  return <Image source={{ uri: url }} style={s.thumb} accessibilityLabel={label} />;
}

function Placeholder({ label }: { label: string }) {
  return (
    <View style={[s.thumb, s.thumbEmpty]}>
      <Text style={s.placeholderText}>{label}</Text>
    </View>
  );
}

export default function PhotosScreen() {
  const { clientId } = useIdentity();
  const today = todayIso();
  const thisWeek = weekStart(today);

  const [photos, setPhotos] = useState<PhotoRow[] | null>(null);
  const [busy, setBusy] = useState<Pose | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPhotos(await listPhotos(clientId));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your photos.');
      setPhotos([]);
    }
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function capture(pose: Pose, fromLibrary: boolean) {
    setError(null);

    const perm = fromLibrary
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();

    if (!perm.granted) {
      setError(
        fromLibrary
          ? 'Photo access is off. Turn it on in Settings to pick an existing photo.'
          : 'Camera access is off. Turn it on in Settings to take a photo.',
      );
      return;
    }

    const result = fromLibrary
      ? await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1,
        })
      : await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1, cameraType:
            ImagePicker.CameraType.front,
        });

    if (result.canceled || !result.assets?.[0]) return;

    setBusy(pose);
    try {
      await uploadPhoto({ clientId, uri: result.assets[0].uri, pose });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed. Your photo is still on your phone — try again.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete(p: PhotoRow) {
    Alert.alert(
      'Delete this photo?',
      'It is removed from your phone\u2019s account and from your coach\u2019s view. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await deletePhoto(p.id, p.storagePath);
              await refresh();
            } catch (e: any) {
              setError(e?.message ?? 'Could not delete that photo.');
            }
          },
        },
      ],
    );
  }

  if (photos === null) {
    return <View style={s.boot}><ActivityIndicator color={color.ice} /></View>;
  }

  const currentWeek = photos.filter((p) => weekStart(p.takenOn) === thisWeek);
  const byPoseNow = new Map(currentWeek.map((p) => [p.pose ?? 'front', p]));

  // Group the rest by date, newest first.
  const past = photos.filter((p) => weekStart(p.takenOn) !== thisWeek);
  const dates = [...new Set(past.map((p) => p.takenOn))].sort().reverse();

  const sharedThisWeek = currentWeek.length > 0 && currentWeek.every((p) => p.visibleToCoach);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>PROGRESS</Text>
      <Text style={s.title}>Photos</Text>

      <Text style={s.body}>
        Front, side and back, once a week. Same spot, same light, same time of
        day — the comparison only works if the framing does.
      </Text>

      {error && <Text style={s.error}>{error}</Text>}

      {/* --- This week ------------------------------------------------ */}
      <View style={s.card}>
        <Text style={s.cardTitle}>This week</Text>

        <View style={s.poseRow}>
          {POSES.map((pose) => {
            const existing = byPoseNow.get(pose);
            return (
              <View key={pose} style={s.poseCol}>
                {busy === pose ? (
                  <View style={[s.thumb, s.thumbEmpty]}>
                    <ActivityIndicator color={color.ice} />
                  </View>
                ) : existing ? (
                  <Pressable onLongPress={() => confirmDelete(existing)}>
                    <SignedImage
                      path={existing.storagePath}
                      label={`${POSE_LABEL[pose]}, ${formatDate(existing.takenOn)}`}
                    />
                  </Pressable>
                ) : (
                  <Placeholder label="—" />
                )}

                <Text style={s.poseLabel}>{POSE_LABEL[pose]}</Text>

                <Pressable
                  style={s.smallButton}
                  onPress={() => capture(pose, false)}
                  disabled={busy !== null}
                >
                  <Text style={s.smallButtonText}>
                    {existing ? 'Retake' : 'Camera'}
                  </Text>
                </Pressable>

                <Pressable
                  style={s.linkButton}
                  onPress={() => capture(pose, true)}
                  disabled={busy !== null}
                >
                  <Text style={s.linkText}>Choose</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* Sharing is per week and off by default. */}
        <View style={s.shareRow}>
          <View style={s.shareCopy}>
            <Text style={s.shareLabel}>Share this week with your coach</Text>
            <Text style={s.muted}>
              {currentWeek.length === 0
                ? 'Nothing to share yet.'
                : sharedThisWeek
                  ? 'Your coach can see this week.'
                  : 'Private to you.'}
            </Text>
          </View>
          <Switch
            value={sharedThisWeek}
            disabled={currentWeek.length === 0}
            onValueChange={async (v) => {
              try {
                const dateToday = currentWeek[0]?.takenOn ?? today;
                await setDayVisibility(clientId, dateToday, v);
                await refresh();
              } catch (e: any) {
                setError(e?.message ?? 'Could not change sharing.');
              }
            }}
            trackColor={{ false: color.line, true: color.ice }}
          />
        </View>
      </View>

      {/* --- History -------------------------------------------------- */}
      {dates.length > 0 && (
        <>
          <Text style={s.section}>History</Text>
          {dates.map((date) => {
            const forDate = past.filter((p) => p.takenOn === date);
            const byPose = new Map(forDate.map((p) => [p.pose ?? 'front', p]));
            const shared = forDate.every((p) => p.visibleToCoach);

            return (
              <View key={date} style={s.card}>
                <View style={s.historyHead}>
                  <Text style={s.historyDate}>{formatDate(date)}</Text>
                  <Text style={s.muted}>{shared ? 'shared' : 'private'}</Text>
                </View>
                <View style={s.poseRow}>
                  {POSES.map((pose) => {
                    const p = byPose.get(pose);
                    return (
                      <View key={pose} style={s.poseCol}>
                        {p ? (
                          <Pressable onLongPress={() => confirmDelete(p)}>
                            <SignedImage
                              path={p.storagePath}
                              label={`${POSE_LABEL[pose]}, ${formatDate(date)}`}
                            />
                          </Pressable>
                        ) : (
                          <Placeholder label="—" />
                        )}
                        <Text style={s.poseLabel}>{POSE_LABEL[pose]}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </>
      )}

      {photos.length === 0 && (
        <Text style={s.body}>No photos yet.</Text>
      )}

      <Text style={s.footnote}>
        Photos are stored privately and are never used for anything except your
        own comparison and, if you turn it on, your coach's review. Hold any
        photo to delete it.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: color.ground },
  content: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.sm },
  boot:    { flex: 1, alignItems: 'center', justifyContent: 'center',
             backgroundColor: color.ground },

  eyebrow: { ...t.label, color: color.ice, fontSize: 11 },
  title:   { ...t.display, color: color.text, fontSize: 30 },
  section: { ...t.label, color: color.textMuted, fontSize: 11, marginTop: space.lg },
  body:    { ...t.body, color: color.textMuted, fontSize: 14, lineHeight: 20 },
  muted:   { ...t.body, color: color.textMuted, fontSize: 12 },
  error:   { ...t.body, color: color.danger, fontSize: 14 },

  card:      { backgroundColor: color.surface, borderRadius: radius.md,
               padding: space.md, gap: space.md, borderWidth: 1,
               borderColor: color.line, marginTop: space.md },
  cardTitle: { ...t.label, color: color.text, fontSize: 15 },

  poseRow: { flexDirection: 'row', gap: space.sm },
  poseCol: { flex: 1, alignItems: 'center', gap: space.xs },

  thumb: {
    width: '100%', aspectRatio: 3 / 4, borderRadius: radius.sm,
    backgroundColor: color.ground, alignItems: 'center', justifyContent: 'center',
  },
  thumbEmpty: { borderWidth: 1, borderColor: color.line },
  placeholderText: { ...t.body, color: color.textMuted, fontSize: 18 },

  poseLabel: { ...t.label, color: color.textMuted, fontSize: 10 },

  smallButton: {
    borderWidth: 1, borderColor: color.line, borderRadius: radius.sm,
    paddingVertical: space.xs, paddingHorizontal: space.sm, alignSelf: 'stretch',
    alignItems: 'center',
  },
  smallButtonText: { ...t.label, color: color.text, fontSize: 11 },
  linkButton: { paddingVertical: 2 },
  linkText:   { ...t.label, color: color.ice, fontSize: 11 },

  shareRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.md,
  },
  shareCopy:  { flex: 1, gap: 2 },
  shareLabel: { ...t.body, color: color.text, fontSize: 14 },

  historyHead: { flexDirection: 'row', justifyContent: 'space-between',
                 alignItems: 'baseline' },
  historyDate: { ...t.data, color: color.text, fontSize: 15 },

  footnote: { ...t.body, color: color.textMuted, fontSize: 11, lineHeight: 17,
              marginTop: space.lg },
});
