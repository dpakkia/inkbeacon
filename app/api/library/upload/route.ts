import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

import { findSource, isValidSourceId } from '@/lib/courses';
import { isKosyncConfigured } from '@/lib/kosync-auth';
import { readRegistry } from '@/lib/registry';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MEDIA = /^[a-z0-9-]+-\d{4}\.(gif|jpe?g|png|svg|webp|mp4|m4v|webm)$/;
const MB = 1024 * 1024;

/**
 * Issues short-lived tokens so the browser can upload a converted book
 * straight to Blob (Vercel functions accept at most 4.5 MB per request).
 * Only `studio/books/<id>/book.json` and `.../media/<id>-0000.<ext>` are
 * allowed, and only for an id no registered book uses: an upload can never
 * overwrite a book that's already in the library.
 */
export async function POST(request: Request) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Server storage is not configured.' },
      { status: 503 },
    );
  }
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!(await hasStudioSession())) throw new Error('Access required.');
        const match =
          /^studio\/books\/([^/]+)\/(book\.json|original\.epub|media\/([^/]+))$/.exec(
            pathname,
          );
        const id = match?.[1] ?? '';
        const mediaName = match?.[3];
        if (
          !match ||
          !isValidSourceId(id) ||
          (mediaName !== undefined &&
            (!MEDIA.test(mediaName) || !mediaName.startsWith(`${id}-`)))
        ) {
          throw new Error('This upload path is not allowed.');
        }
        // the original EPUB, kept for KOReader's catalogue: may be attached
        // to a book already in the library, and only replaces that file
        if (match[2] === 'original.epub') {
          if (!isKosyncConfigured()) {
            throw new Error('KOReader support is not enabled.');
          }
          return {
            allowedContentTypes: ['application/epub+zip'],
            maximumSizeInBytes: 500 * MB,
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60,
          };
        }
        if (findSource(await readRegistry(), id)) {
          throw new Error(`A book with the id "${id}" already exists.`);
        }
        return mediaName
          ? {
              allowedContentTypes: ['image/*', 'video/*'],
              maximumSizeInBytes: 500 * MB,
              addRandomSuffix: false,
              allowOverwrite: true,
              cacheControlMaxAge: 60,
            }
          : {
              allowedContentTypes: ['application/json'],
              maximumSizeInBytes: 100 * MB,
              addRandomSuffix: false,
              allowOverwrite: true,
              cacheControlMaxAge: 60,
            };
      },
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload refused.';
    return Response.json({ error: message }, { status: 400 });
  }
}
