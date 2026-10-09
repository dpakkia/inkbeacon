import { get } from '@vercel/blob';

import { trovaFonte } from '@/lib/corsi';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Il nome deve iniziare con l'id della fonte: nessun accesso incrociato. */
const NOME_VALIDO = /^[a-zA-Z0-9.-]+\.(gif|jpe?g|png|svg|webp|mp4|m4v|webm)$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ fonte: string; filename: string }> },
) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return new Response('Archivio non configurato.', { status: 503 });
  }
  if (!(await hasStudioSession())) {
    return new Response('Accesso richiesto.', { status: 401 });
  }

  const { fonte, filename } = await context.params;
  if (!trovaFonte(fonte)?.leggibile) {
    return new Response('Fonte sconosciuta.', { status: 404 });
  }
  if (!NOME_VALIDO.test(filename) || !filename.startsWith(`${fonte}-`)) {
    return new Response('File non valido.', { status: 400 });
  }

  try {
    const result = await get(`studio/books/${fonte}/media/${filename}`, {
      access: 'private',
      useCache: true,
    });
    if (!result || result.statusCode !== 200) {
      return new Response('Media non trovato.', { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': result.blob.contentType,
      },
    });
  } catch (error) {
    console.error(`Unable to read media for "${fonte}" from Vercel Blob`, error);
    return new Response('Impossibile caricare il media.', { status: 502 });
  }
}
