import { del, list } from '@vercel/blob';

import { findSource, isValidSourceId } from '@/lib/courses';
import {
  LibraryError,
  libraryErrorResponse,
  requireLibraryAccess,
} from '@/lib/library-api';
import { readRegistry, updateRegistry } from '@/lib/registry';
import {
  readState,
  scopeOf,
  withoutSource,
  writeState,
} from '@/lib/study-state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Deletes a book for good: its entry in the library, its highlights,
 * progress, ticks and diagrams, then its file and media in Blob.
 * The body must repeat the id (`{ "confirm": "<id>" }`), which the library
 * page asks the user to type.
 *
 * Calling it again for an id that's already gone finishes a deletion that
 * failed halfway (for example while removing the files).
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ source: string }> },
) {
  const denied = await requireLibraryAccess();
  if (denied) return denied;

  const { source: id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    confirm?: unknown;
  } | null;
  if (!isValidSourceId(id) || body?.confirm !== id) {
    return Response.json(
      { error: 'Type the book id to confirm.' },
      { status: 400 },
    );
  }

  try {
    const before = await readRegistry();
    if (!findSource(before, id) && !before.deleted.includes(id)) {
      throw new LibraryError('Unknown book.', 404);
    }

    // 1. out of the library: nothing serves it from now on
    const registry = await updateRegistry((current) => ({
      ...current,
      courses: current.courses.map((course) => ({
        ...course,
        sources: course.sources.filter((s) => s.id !== id),
      })),
      deleted: [...current.deleted.filter((d) => d !== id), id],
    }));

    // 2. its study data (already dropped by the parser, since the id is now
    // in `deleted`; removed explicitly as well)
    const { initialized, ...state } = await readState(scopeOf(registry));
    if (initialized) {
      await writeState({
        ...withoutSource(state, id),
        updatedAt: new Date().toISOString(),
      });
    }

    // 3. its files
    let removed = 0;
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: `studio/books/${id}/`,
        cursor,
        limit: 1000,
      });
      if (page.blobs.length) {
        await del(page.blobs.map((blob) => blob.pathname));
        removed += page.blobs.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return Response.json({ registry, removedFiles: removed });
  } catch (error) {
    return libraryErrorResponse(error, 'delete the book');
  }
}
