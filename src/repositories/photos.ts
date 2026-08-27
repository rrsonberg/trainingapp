/**
 * Progress photos.
 *
 * The one place in this app that talks to the network directly.
 *
 * Everything else writes to SQLite and lets the outbox replay it, but the
 * outbox carries JSON rows and a photo is a two-megabyte binary. Queuing those
 * in SQLite would put the device's whole photo history in the database file.
 * So the upload is awaited, the UI shows it happening, and a failure leaves
 * the local file untouched so it can be retried.
 *
 * Storage layout is dictated by the bucket policy, not by preference:
 * the first folder MUST be the client's auth uid, because the policy compares
 * it against auth.uid(). Anything else is rejected by the server no matter
 * what the app thinks.
 *
 *   {clientId}/{taken_on}/{pose}-{uuid}.jpg
 *
 * Photos default to PRIVATE. visible_to_coach is false until the client turns
 * it on, and the coach's read policy checks that flag independently of the UI.
 *
 * ---------------------------------------------------------------------------
 * ADAPTER — the one import I could not verify. If your Supabase client is
 * exported under a different name or path, fix this line and nothing else.
 * ---------------------------------------------------------------------------
 */
import { supabase } from '../lib/supabase';           // ← adapter
import * as ImageManipulator from 'expo-image-manipulator';

export type Pose = 'front' | 'side' | 'back';
export const POSES: Pose[] = ['front', 'side', 'back'];
export const POSE_LABEL: Record<Pose, string> = {
  front: 'Front', side: 'Side', back: 'Back',
};

const BUCKET = 'progress-photos';

/** Long edge in pixels after resize. Comfortably enough to see change over
 *  twelve weeks, and roughly a tenth the bytes of an untouched camera file —
 *  which matters, because storage egress is the line item that grows fastest
 *  in an app like this. */
const MAX_EDGE = 1440;
const QUALITY = 0.72;

function uuid(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Today in the device's own timezone. A photo taken at 11pm belongs to that
 *  day, not to UTC tomorrow. */
export function todayIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Shrink before upload.
 *
 * Done on device rather than server-side because the saving that matters is
 * the upload itself — a client on a gym's wifi should not be pushing four
 * megabytes three times a week.
 */
async function compress(uri: string): Promise<{ uri: string; width: number; height: number }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_EDGE } }],
    { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: result.uri, width: result.width, height: result.height };
}

export type UploadArgs = {
  clientId: string;
  uri: string;
  pose: Pose;
  takenOn?: string;
  bodyWeightKg?: number | null;
  note?: string | null;
  visibleToCoach?: boolean;
};

/**
 * Compress, upload, record.
 *
 * If the row insert fails after the file lands, the file is removed again
 * rather than left orphaned in the bucket — an object with no row is
 * invisible to every screen and would just accumulate silently.
 */
export async function uploadPhoto(args: UploadArgs): Promise<void> {
  const takenOn = args.takenOn ?? todayIso();
  const small = await compress(args.uri);

  const path = `${args.clientId}/${takenOn}/${args.pose}-${uuid()}.jpg`;

  // fetch() on a local file URI gives the bytes without pulling in a base64
  // round trip, which on a large photo is both slower and memory-hungry.
  const response = await fetch(small.uri);
  const bytes = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { error: rowError } = await supabase.from('progress_photos').insert({
    client_generated_id: uuid(),
    client_id: args.clientId,
    storage_path: path,
    pose: args.pose,
    taken_on: takenOn,
    body_weight_kg: args.bodyWeightKg ?? null,
    note: args.note ?? null,
    // Private until they say otherwise. The default belongs on the safe side
    // of a decision this personal.
    visible_to_coach: args.visibleToCoach ?? false,
    width: small.width,
    height: small.height,
    byte_size: bytes.byteLength,
  });

  if (rowError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Could not save the photo record: ${rowError.message}`);
  }
}

export type PhotoRow = {
  id: string;
  storagePath: string;
  pose: Pose | null;
  takenOn: string;
  bodyWeightKg: number | null;
  note: string | null;
  visibleToCoach: boolean;
};

/** Everything this client has, newest first. Uses the same RPC the coach
 *  console reads, so the two can never drift apart. */
export async function listPhotos(clientId: string): Promise<PhotoRow[]> {
  const { data, error } = await supabase.rpc('photo_timeline', { p_client_id: clientId });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r: any) => ({
    id: r.id,
    storagePath: r.storage_path,
    pose: r.pose,
    takenOn: r.taken_on,
    bodyWeightKg: r.body_weight_kg,
    note: r.note,
    visibleToCoach: r.visible_to_coach,
  }));
}

/**
 * A short-lived link to view one photo.
 *
 * The bucket is private, so there is no permanent URL to hold on to. Every
 * render mints a fresh signed link that expires, which is the whole point —
 * a leaked URL stops working.
 */
export async function signedUrl(storagePath: string, seconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Share or unshare a whole day's photos with the coach. */
export async function setDayVisibility(
  clientId: string,
  takenOn: string,
  visible: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('progress_photos')
    .update({ visible_to_coach: visible })
    .eq('client_id', clientId)
    .eq('taken_on', takenOn)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
}

/**
 * Delete, properly.
 *
 * The row is soft-deleted like everything else, but the FILE is removed for
 * real. A client deleting a photo of their own body means delete, and a
 * soft-deleted row pointing at a live object would not be that.
 */
export async function deletePhoto(id: string, storagePath: string): Promise<void> {
  const { error } = await supabase
    .from('progress_photos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.storage.from(BUCKET).remove([storagePath]);
}
