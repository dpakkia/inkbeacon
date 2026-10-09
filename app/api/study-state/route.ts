import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';
import { parseState, readState, writeState } from '@/lib/stato-studio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireSession() {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Sincronizzazione server non configurata.' },
      { status: 503 },
    );
  }
  if (!(await hasStudioSession())) {
    return Response.json({ error: 'Accesso richiesto.' }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    return Response.json(await readState(), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('Unable to read study state from Vercel Blob', error);
    return Response.json(
      { error: 'Impossibile leggere i dati di studio.' },
      { status: 502 },
    );
  }
}

export async function PUT(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const rawState = await request.json().catch(() => null);
  const state = parseState(rawState);
  if (!state) {
    return Response.json(
      { error: 'Formato dei dati di studio non valido.' },
      { status: 400 },
    );
  }

  try {
    const input = rawState as Record<string, unknown>;
    if (
      !Object.hasOwn(input, 'completedUnits') ||
      !Object.hasOwn(input, 'freeSchemes')
    ) {
      const current = await readState();
      if (!Object.hasOwn(input, 'completedUnits'))
        state.completedUnits = current.completedUnits;
      if (!Object.hasOwn(input, 'freeSchemes'))
        state.freeSchemes = current.freeSchemes;
    }
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    return Response.json({ updatedAt: state.updatedAt });
  } catch (error) {
    console.error('Unable to write study state to Vercel Blob', error);
    return Response.json(
      { error: 'Impossibile salvare i dati di studio.' },
      { status: 502 },
    );
  }
}
