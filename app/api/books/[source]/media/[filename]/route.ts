import { get } from '@vercel/blob';

import { findSource } from '@/lib/courses';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The name must start with the source id: no cross-source access. */
const VALID_NAME = /^[a-zA-Z0-9.-]+\.(gif|jpe?g|png|svg|webp|mp4|m4v|webm)$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ source: string; filename: string }> },
) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return new Response('Storage is not configured.', { status: 503 });
  }
  if (!(await hasStudioSession())) {
    return new Response('Access required.', { status: 401 });
  }

  const { source, filename } = await context.params;
  if (!findSource(source)?.readable) {
    return new Response('Unknown source.', { status: 404 });
  }
  if (!VALID_NAME.test(filename) || !filename.startsWith(`${source}-`)) {
    return new Response('Invalid file.', { status: 400 });
  }

  try {
    const result = await get(`studio/books/${source}/media/${filename}`, {
      access: 'private',
      useCache: true,
    });
    if (!result || result.statusCode !== 200) {
      return new Response('Media not found.', { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': result.blob.contentType,
      },
    });
  } catch (error) {
    console.error(
      `Unable to read media for "${source}" from Vercel Blob`,
      error,
    );
    return new Response('Unable to load the media.', { status: 502 });
  }
}
