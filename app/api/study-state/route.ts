import { readRegistry } from '@/lib/registry';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';
import {
  parseState,
  readState,
  scopeOf,
  UnreadableStateError,
  writeState,
  type StudyState,
} from '@/lib/study-state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireSession() {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Server sync is not configured.' },
      { status: 503 },
    );
  }
  if (!(await hasStudioSession())) {
    return Response.json({ error: 'Access required.' }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const scope = scopeOf(await readRegistry());
    return Response.json(await readState(scope), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return failure(error, 'read');
  }
}

function failure(error: unknown, action: 'read' | 'save') {
  if (error instanceof UnreadableStateError) {
    console.error('Stored study state is invalid; refusing to load or save');
    return Response.json({ error: error.message }, { status: 500 });
  }
  console.error(`Unable to ${action} study state on Vercel Blob`, error);
  return Response.json(
    { error: `Unable to ${action} the study data.` },
    { status: 502 },
  );
}

/**
 * Keeps the server's data for every book the saving tab didn't know about.
 * A tab opened before a book was uploaded sends no entry for it, which would
 * otherwise read as "empty" and wipe what another tab saved.
 */
function keepUnknownSources(
  state: StudyState,
  current: StudyState,
  known: Set<string>,
) {
  const isUnknown = (key: string) => key !== 'free' && !known.has(key);
  for (const field of ['highlights', 'progress', 'completedUnits'] as const) {
    const merged: Record<string, unknown> = { ...state[field] };
    for (const [key, value] of Object.entries(current[field])) {
      if (isUnknown(key)) merged[key] = value;
    }
    (state[field] as Record<string, unknown>) = merged;
  }
  for (const [key, code] of Object.entries(current.mermaidByChapter)) {
    if (isUnknown(key.split(':')[0])) state.mermaidByChapter[key] = code;
  }
}

export async function PUT(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const rawState = await request.json().catch(() => null);

  try {
    const scope = scopeOf(await readRegistry());
    const state = parseState(rawState, scope);
    if (!state) {
      return Response.json(
        { error: 'Invalid study data format.' },
        { status: 400 },
      );
    }

    const input = rawState as Record<string, unknown>;
    const known = Array.isArray(input.knownSources)
      ? new Set(
          input.knownSources.filter(
            (id): id is string => typeof id === 'string',
          ),
        )
      : null;
    // always read what's stored first: it throws if the stored document is
    // unreadable, so a save can never overwrite it
    const current = await readState(scope);
    if (!Object.hasOwn(input, 'completedUnits'))
      state.completedUnits = current.completedUnits;
    if (!Object.hasOwn(input, 'freeSchemes'))
      state.freeSchemes = current.freeSchemes;
    if (known && current.initialized) keepUnknownSources(state, current, known);
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    return Response.json({ updatedAt: state.updatedAt });
  } catch (error) {
    return failure(error, 'save');
  }
}
