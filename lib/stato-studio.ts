/**
 * Lettura, validazione e scrittura del documento di studio su Vercel Blob.
 *
 * Stava dentro la route `/api/study-state`. Da quando esiste anche
 * `/api/progresso`, due rotte leggono lo stesso documento: il parser vive qui
 * perche' una sola di esse non puo' essere la proprietaria del formato.
 */

import { get, put } from '@vercel/blob';

import { ID_FONTI, TOTALI_FONTI } from '@/lib/corsi';

const STORAGE_PATH = 'studio/state.json';
const LEGACY_HIGHLIGHTS_PATH = 'studio/highlights.json';
const SOURCE_IDS = ID_FONTI;
const COLORS = ['yellow', 'mint', 'coral'] as const;
const SOURCE_TOTALS = TOTALI_FONTI;

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

export function emptyState(): StudyState {
  return {
    version: 4,
    highlights: Object.fromEntries(SOURCE_IDS.map((id) => [id, []])),
    progress: Object.fromEntries(SOURCE_IDS.map((id) => [id, 0])),
    completedUnits: Object.fromEntries(SOURCE_IDS.map((id) => [id, []])),
    freeSchemes: [],
    mermaidByChapter: {},
    updatedAt: new Date(0).toISOString(),
  };
}

// Il registro delle fonti cresce nel tempo. Uno stato scritto quando i libri
// erano tre non conosce quelli aggiunti dopo: se una fonte assente facesse
// scartare tutto il documento, aggiungere un libro cancellerebbe lo studio
// fatto sugli altri. Quindi ogni fonte si legge per conto suo e quella che
// manca torna al proprio valore vuoto.
function parseCompletedUnits(
  value: unknown,
): Record<SourceId, string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result = {} as Record<SourceId, string[]>;

  for (const sourceId of SOURCE_IDS) {
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

function parseMermaidStore(value: unknown): MermaidStore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 500) return null;

  let totalLength = 0;
  const result: MermaidStore = {};
  for (const [key, code] of entries) {
    if (!key || key.length > 120 || typeof code !== 'string') return null;
    totalLength += code.length;
    if (code.length > 100_000 || totalLength > 2_000_000) return null;
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
): Record<SourceId, StoredHighlight[]> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const result = {} as Record<SourceId, StoredHighlight[]>;

  for (const sourceId of SOURCE_IDS) {
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

function parseProgress(value: unknown): Record<SourceId, number> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const result = {} as Record<SourceId, number>;

  for (const sourceId of SOURCE_IDS) {
    const progress = record[sourceId];
    // un libro reimportato puo' avere piu' o meno unita' di prima: il
    // segnalibro si taglia all'ultima pagina che esiste ora, non si perde
    result[sourceId] = Number.isInteger(progress)
      ? Math.min(Math.max(Number(progress), 0), SOURCE_TOTALS[sourceId] ?? 0)
      : 0;
  }
  return result;
}

export function parseState(value: unknown): StudyState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StudyState>;
  const highlights = parseHighlights(record.highlights);
  const progress = parseProgress(record.progress);
  // `?? {}` e non una lista scritta a mano: le chiavi le decide il registro
  const completedUnits = parseCompletedUnits(record.completedUnits ?? {});
  const freeSchemes = record.freeSchemes
    ? parseFreeSchemes(record.freeSchemes)
    : [];
  const mermaidByChapter = parseMermaidStore(record.mermaidByChapter);
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

async function readBlob(pathname: string) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return (await new Response(result.stream).json()) as unknown;
}

export async function readState() {
  const stored = parseState(await readBlob(STORAGE_PATH));
  if (stored) return { ...stored, initialized: true };

  const state = emptyState();
  const legacy = (await readBlob(LEGACY_HIGHLIGHTS_PATH)) as {
    highlights?: unknown;
    updatedAt?: unknown;
  } | null;
  const legacyHighlights = parseHighlights(legacy?.highlights);
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
