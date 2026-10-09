import { get } from '@vercel/blob';

import { findSource } from '@/lib/courses';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ source: string }> },
) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Book storage is not configured.' },
      { status: 503 },
    );
  }
  if (!(await hasStudioSession())) {
    return Response.json({ error: 'Access required.' }, { status: 401 });
  }

  const { source } = await context.params;
  // the registry is also the list of what may be requested
  const entry = findSource(source);
  if (!entry?.readable) {
    return Response.json({ error: 'Unknown source.' }, { status: 404 });
  }

  try {
    const result = await get(`studio/books/${source}/book.json`, {
      access: 'private',
      useCache: true,
    });
    if (!result || result.statusCode !== 200) {
      return Response.json({ error: 'Book not found.' }, { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (error) {
    console.error(`Unable to read "${source}" from Vercel Blob`, error);
    return Response.json(
      { error: 'Unable to load the book.' },
      { status: 502 },
    );
  }
}
