/**
 * KOReader progress sync ("kosync"): the store and position helpers.
 *
 * Positions live in their own blob, `studio/kosync.json`, keyed by KOReader's
 * document id, never inside `studio/state.json`: the browser saves the whole
 * study document at once and would race with the e-reader. Records come from
 * KOReader (PUT /kosync/syncs/progress) or from InkBeacon's reader (phase 2,
 * `device_id` = INKBEACON_DEVICE_ID). Last writer wins, as in kosync itself.
 */

import { BlobPreconditionFailedError, get, put } from '@vercel/blob';

const STORE_PATH = 'studio/kosync.json';
const MAX_DOCUMENTS = 5_000;

/** Document ids KOReader's reference server accepts. */
export const DOCUMENT_PATTERN = /^[A-Za-z0-9_]{1,128}$/;
export const INKBEACON_DEVICE = 'InkBeacon';
export const INKBEACON_DEVICE_ID = 'inkbeacon-web';

export type KosyncRecord = {
  /** A crengine XPointer for EPUBs (`/body/DocFragment[N]/…`), a page number for PDFs. */
  progress: string;
  /** 0–1, in the writer's own layout: not comparable across readers. */
  percentage: number;
  device: string;
  device_id?: string;
  /** Unix seconds. */
  timestamp: number;
};

type Store = { version: 1; documents: Record<string, KosyncRecord> };

function parseRecord(value: unknown): KosyncRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.progress !== 'string' ||
    r.progress.length > 2_000 ||
    typeof r.percentage !== 'number' ||
    !Number.isFinite(r.percentage) ||
    typeof r.device !== 'string' ||
    r.device.length > 200 ||
    (r.device_id !== undefined &&
      (typeof r.device_id !== 'string' || r.device_id.length > 200)) ||
    !Number.isInteger(r.timestamp)
  ) {
    return null;
  }
  return {
    progress: r.progress,
    percentage: Math.min(Math.max(r.percentage, 0), 1),
    device: r.device,
    ...(r.device_id ? { device_id: r.device_id as string } : {}),
    timestamp: r.timestamp as number,
  };
}

function parseStore(value: unknown): Store | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const documents = (value as { documents?: unknown }).documents;
  if (!documents || typeof documents !== 'object' || Array.isArray(documents))
    return null;
  const result: Store = { version: 1, documents: {} };
  for (const [id, raw] of Object.entries(documents)) {
    const record = parseRecord(raw);
    // an invalid entry is skipped, not fatal: it only holds a reading position
    if (DOCUMENT_PATTERN.test(id) && record) result.documents[id] = record;
  }
  return result;
}

async function load(): Promise<{ store: Store; etag: string | null }> {
  const result = await get(STORE_PATH, { access: 'private', useCache: false });
  if (!result) return { store: { version: 1, documents: {} }, etag: null };
  if (result.statusCode !== 200)
    throw new Error('Unexpected kosync store response');
  const store = parseStore(await new Response(result.stream).json());
  if (!store) throw new Error('The kosync store is malformed');
  // `get` returns a weak ETag; a conditional `put` matches only the strong form
  return { store, etag: result.blob.etag.replace(/^W\//, '') };
}

export async function readRecord(document: string) {
  return (await load()).store.documents[document] ?? null;
}

/** The newest record among several document ids (a book can have two). */
export async function readNewestRecord(documents: string[]) {
  const { store } = await load();
  return (
    documents
      .map((id) => store.documents[id])
      .filter((r): r is KosyncRecord => Boolean(r))
      .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null
  );
}

/** Stores one record under each given document id, retrying on conflicts. */
export async function writeRecord(documents: string[], record: KosyncRecord) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { store, etag } = await load();
    for (const id of documents) store.documents[id] = record;
    const ids = Object.keys(store.documents);
    if (ids.length > MAX_DOCUMENTS) {
      // keep the most recently updated documents
      ids
        .sort(
          (a, b) => store.documents[a].timestamp - store.documents[b].timestamp,
        )
        .slice(0, ids.length - MAX_DOCUMENTS)
        .forEach((id) => delete store.documents[id]);
    }
    try {
      await put(STORE_PATH, JSON.stringify(store), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: etag !== null,
        ...(etag ? { ifMatch: etag } : {}),
        cacheControlMaxAge: 60,
        contentType: 'application/json',
      });
      return;
    } catch (error) {
      const conflict =
        error instanceof BlobPreconditionFailedError ||
        (error instanceof Error && /already exists/i.test(error.message));
      if (!conflict) throw error;
    }
  }
  throw new Error('The kosync store kept changing');
}

/**
 * The 0-based spine index a crengine XPointer points into:
 * `/body/DocFragment[12]/…` → 11; `/body/DocFragment/…` (a one-file book) → 0.
 */
export function spineFromXPointer(progress: string): number | null {
  const match = /^\/body\/DocFragment(?:\[(\d+)\])?(?=$|[/.])/.exec(progress);
  if (!match) return null;
  return match[1] ? Math.max(Number(match[1]) - 1, 0) : 0;
}

/**
 * A crengine XPointer to the start of a spine file. crengine resolves a path
 * with no offset to the element itself (`createXPointerV2`), and `[1]` works
 * for one-file books too.
 */
export function xpointerForSpine(spine: number) {
  return `/body/DocFragment[${spine + 1}]/body`;
}
