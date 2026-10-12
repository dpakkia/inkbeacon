import { findSource } from '@/lib/courses';
import { readRegistry } from '@/lib/registry';
import { getStorage } from '@/lib/storage';
import {
  hasStudioSession,
  isStorageConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ source: string }> },
) {
  if (!isStudioConfigured() || !isStorageConfigured()) {
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
  try {
    const entry = findSource(await readRegistry(), source);
    if (!entry?.readable) {
      return Response.json({ error: 'Unknown source.' }, { status: 404 });
    }

    const object = await getStorage().get(`studio/books/${source}/book.json`);
    if (!object) {
      return Response.json({ error: 'Book not found.' }, { status: 404 });
    }
    return new Response(object.body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (error) {
    console.error(`Unable to read "${source}" from storage`, error);
    return Response.json(
      { error: 'Unable to load the book.' },
      { status: 502 },
    );
  }
}
