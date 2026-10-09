/**
 * Reading, validating and writing the study document on Vercel Blob.
 *
 * This used to live inside the `/api/study-state` route. Since `/api/progress`
 * exists too, two routes read the same document: the parser lives here
 * because neither of them can be the owner of the format.
 */

import { get, put } from '@vercel/blob';

import {
  allSources,
  isValidSourceId,
  sourceIds,
  type Registry,
} from '@/lib/courses';

const STORAGE_PATH = 'studio/state.json';
const LEGACY_HIGHLIGHTS_PATH = 'studio/highlights.json';
const COLORS = ['yellow', 'mint', 'coral'] as const;

export type SourceId = string;
export type HighlightColor = (typeof COLORS)[number];
export type MermaidStore = Record<string, string>;

export type StoredFreeScheme = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredHighlight = {
  id: string;
  unitId?: string;
  paragraph: number;
  start: number;
  end: number;
  color: HighlightColor;
  quote: string;
};

export type StudyState = {
  version: 4;
  highlights: Record<SourceId, StoredHighlight[]>;
  progress: Record<SourceId, number>;
  completedUnits: Record<SourceId, string[]>;
  freeSchemes: StoredFreeScheme[];
  mermaidByChapter: MermaidStore;
  updatedAt: string;
};

/**
 * What the parser needs to know about the registry: the books it lists, their
 * totals, and the ids deleted on purpose.
 */
export type StateScope = {
  ids: string[];
  totals: Record<string, number>;
  deleted: Set<string>;
};

export function scopeOf(registry: Registry): StateScope {
  return {
    ids: sourceIds(registry),
    totals: Object.fromEntries(
      allSources(registry).map((s) => [s.id, s.total]),
    ),
    deleted: new Set(registry.deleted),
  };
}

export function emptyState(scope: StateScope): StudyState {
  return {
    version: 4,
    highlights: Object.fromEntries(scope.ids.map((id) => [id, []])),
    progress: Object.fromEntries(scope.ids.map((id) => [id, 0])),
    completedUnits: Object.fromEntries(scope.ids.map((id) => [id, []])),
    freeSchemes: [],
    mermaidByChapter: {},
    updatedAt: new Date(0).toISOString(),
  };
}

// The source registry changes over time. A state written when there were
// three books knows nothing about the ones added later: if a missing source
// made the whole document invalid, adding a book would wipe the study done on
// the others. So each source is read on its own, and a missing one falls back
// to its empty value.
// The reverse holds too: data for an id the registry doesn't list is kept, not
// dropped, unless that id was deleted on purpose. A registry read that went
// wrong must never cost study data.
function keysOf(record: Record<string, unknown>, scope: StateScope) {
  const keys = new Set(scope.ids);
  for (const key of Object.keys(record).slice(0, 2_000)) {
    if (isValidSourceId(key)) keys.add(key);
  }
  return [...keys].filter((key) => !scope.deleted.has(key));
}

function parseCompletedUnits(
  value: unknown,
  scope: StateScope,
): Record<SourceId, string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result = {} as Record<SourceId, string[]>;

  for (const sourceId of keysOf(record, scope)) {
    const units = record[sourceId];
    result[sourceId] =
      Array.isArray(units) &&
      units.length <= 1_000 &&
      units.every(
        (unit) =>
          typeof unit === 'string' && unit.length > 0 && unit.length <= 120,
      )
        ? [...new Set(units as string[])]
        : [];
  }
  return result;
}

function parseFreeSchemes(value: unknown): StoredFreeScheme[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;

  const seen = new Set<string>();
  const result: StoredFreeScheme[] = [];
  for (const scheme of value) {
    if (!scheme || typeof scheme !== 'object' || Array.isArray(scheme))
      return null;
    const item = scheme as Partial<StoredFreeScheme>;
    if (
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) ||
      seen.has(item.id) ||
      typeof item.title !== 'string' ||
      item.title.trim().length === 0 ||
      item.title.length > 160 ||
      typeof item.createdAt !== 'string' ||
      item.createdAt.length > 40 ||
      typeof item.updatedAt !== 'string' ||
      item.updatedAt.length > 40
    ) {
      return null;
    }
    seen.add(item.id);
    result.push({
      id: item.id,
      title: item.title.trim(),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
  return result;
}

function parseMermaidStore(
  value: unknown,
  scope: StateScope,
): MermaidStore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  // one entry per chapter of every book, plus the free diagrams
  if (entries.length > 10_000) return null;

  let totalLength = 0;
  const result: MermaidStore = {};
  for (const [key, code] of entries) {
    if (!key || key.length > 120 || typeof code !== 'string') return null;
    // keys are `<source>:<chapter>` or `free:<scheme>`
    if (scope.deleted.has(key.split(':')[0])) continue;
    totalLength += code.length;
    if (code.length > 100_000 || totalLength > 10_000_000) return null;
    result[key] = code;
  }
  return result;
}

function isHighlight(value: unknown): value is StoredHighlight {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredHighlight>;
  return (
    typeof item.id === 'string' &&
    item.id.length <= 120 &&
    (item.unitId === undefined ||
      (typeof item.unitId === 'string' && item.unitId.length <= 120)) &&
    Number.isInteger(item.paragraph) &&
    Number.isInteger(item.start) &&
    Number.isInteger(item.end) &&
    Number(item.paragraph) >= 0 &&
    Number(item.start) >= 0 &&
    Number(item.end) > Number(item.start) &&
    COLORS.includes(item.color as HighlightColor) &&
    typeof item.quote === 'string' &&
    item.quote.length <= 10_000
  );
}

function parseHighlights(
  value: unknown,
  scope: StateScope,
): Record<SourceId, StoredHighlight[]> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const result = {} as Record<SourceId, StoredHighlight[]>;

  for (const sourceId of keysOf(record, scope)) {
    const highlights = record[sourceId];
    result[sourceId] =
      Array.isArray(highlights) &&
      highlights.length <= 2_000 &&
      highlights.every(isHighlight)
        ? (highlights as StoredHighlight[])
        : [];
  }
  return result;
}

function parseProgress(
  value: unknown,
  scope: StateScope,
): Record<SourceId, number> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const result = {} as Record<SourceId, number>;

  for (const sourceId of keysOf(record, scope)) {
    const progress = record[sourceId];
    // a re-imported book can have more or fewer units than before: the
    // bookmark is clamped to the last page that exists now, not lost
    result[sourceId] = Number.isInteger(progress)
      ? Math.min(
          Math.max(Number(progress), 0),
          scope.totals[sourceId] ?? 100_000,
        )
      : 0;
  }
  return result;
}

export function parseState(
  value: unknown,
  scope: StateScope,
): StudyState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StudyState>;
  const highlights = parseHighlights(record.highlights, scope);
  const progress = parseProgress(record.progress, scope);
  // `?? {}` rather than a hand-written list: the registry decides the keys
  const completedUnits = parseCompletedUnits(
    record.completedUnits ?? {},
    scope,
  );
  const freeSchemes = record.freeSchemes
    ? parseFreeSchemes(record.freeSchemes)
    : [];
  const mermaidByChapter = parseMermaidStore(record.mermaidByChapter, scope);
  if (
    !highlights ||
    !progress ||
    !completedUnits ||
    !freeSchemes ||
    !mermaidByChapter
  )
    return null;
  return {
    version: 4,
    highlights,
    progress,
    completedUnits,
    freeSchemes,
    mermaidByChapter,
    updatedAt:
      typeof record.updatedAt === 'string'
        ? record.updatedAt
        : new Date(0).toISOString(),
  };
}

/** The parsed JSON of a blob; null only when the blob doesn't exist. */
async function readBlob(pathname: string): Promise<{ value: unknown } | null> {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200) {
    throw new Error(`Unexpected response for ${pathname}`);
  }
  return { value: (await new Response(result.stream).json()) as unknown };
}

/**
 * The stored document exists but isn't valid study data (hand-edited, cut
 * off, or over a limit). Treating it as empty would let the browser save its
 * own copy on top, losing everything stored: refuse instead, and touch
 * nothing until someone looks at it.
 */
export class UnreadableStateError extends Error {
  constructor() {
    super(
      'The stored study data can’t be read, so nothing was loaded or saved. ' +
        'Check studio/state.json in the Blob store.',
    );
  }
}

/** A stored document as study state; throws if it exists but is invalid. */
export function parseStoredState(value: unknown, scope: StateScope) {
  const stored = parseState(value, scope);
  if (!stored) throw new UnreadableStateError();
  return { ...stored, initialized: true };
}

export async function readState(scope: StateScope) {
  const stored = await readBlob(STORAGE_PATH);
  if (stored) return parseStoredState(stored.value, scope);

  // nothing stored yet: start empty, with the highlights of the old format
  const state = emptyState(scope);
  const legacy = (await readBlob(LEGACY_HIGHLIGHTS_PATH))?.value as {
    highlights?: unknown;
    updatedAt?: unknown;
  } | null;
  const legacyHighlights = parseHighlights(legacy?.highlights, scope);
  if (legacyHighlights) {
    state.highlights = legacyHighlights;
    if (typeof legacy?.updatedAt === 'string')
      state.updatedAt = legacy.updatedAt;
  }
  return { ...state, initialized: false };
}

export async function writeState(state: StudyState) {
  await put(STORAGE_PATH, JSON.stringify(state), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/json',
  });
}

/** The state without one book's highlights, progress, ticks and diagrams. */
export function withoutSource(state: StudyState, id: string): StudyState {
  const drop = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
  return {
    ...state,
    highlights: drop(state.highlights),
    progress: drop(state.progress),
    completedUnits: drop(state.completedUnits),
    mermaidByChapter: Object.fromEntries(
      Object.entries(state.mermaidByChapter).filter(
        ([key]) => key.split(':')[0] !== id,
      ),
    ),
  };
}
