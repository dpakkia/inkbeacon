import { get } from '@vercel/blob';

import { trovaFonte } from '@/lib/corsi';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ fonte: string }> },
) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Archivio del libro non configurato.' },
      { status: 503 },
    );
  }
  if (!(await hasStudioSession())) {
    return Response.json({ error: 'Accesso richiesto.' }, { status: 401 });
  }

  const { fonte } = await context.params;
  // il registro e' anche la lista di cio' che e' lecito chiedere
  const scheda = trovaFonte(fonte);
  if (!scheda?.leggibile) {
    return Response.json({ error: 'Fonte sconosciuta.' }, { status: 404 });
  }

  try {
    const result = await get(`studio/books/${fonte}/book.json`, {
      access: 'private',
      useCache: true,
    });
    if (!result || result.statusCode !== 200) {
      return Response.json({ error: 'Libro non trovato.' }, { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (error) {
    console.error(`Unable to read "${fonte}" from Vercel Blob`, error);
    return Response.json(
      { error: 'Impossibile caricare il libro.' },
      { status: 502 },
    );
  }
}
