import { parseRegistry, sourceIds } from '@/lib/courses';
import {
  LibraryError,
  libraryErrorResponse,
  requireLibraryAccess,
} from '@/lib/library-api';
import { readRegistry, updateRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const denied = await requireLibraryAccess();
  if (denied) return denied;
  try {
    return Response.json(await readRegistry(), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return libraryErrorResponse(error, 'read the library');
  }
}

/**
 * Saves edits to courses and book details: names, descriptions, titles,
 * units, totals, order, and which course a book is in. Books are added and
 * deleted through their own routes, so the set of book ids can't change here.
 */
export async function PUT(request: Request) {
  const denied = await requireLibraryAccess();
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as {
    courses?: unknown;
  } | null;

  try {
    const registry = await updateRegistry((current) => {
      const next = parseRegistry({
        version: 1,
        courses: body?.courses,
        deleted: current.deleted,
      });
      if (!next) throw new LibraryError('Some details are invalid.', 400);
      const before = sourceIds(current).sort().join(',');
      const after = sourceIds(next).sort().join(',');
      if (before !== after) {
        throw new LibraryError(
          'The library changed in the meantime. Reload and try again.',
          409,
        );
      }
      // a book keeps whatever readability it had: that's set on upload
      const readable = new Map(
        current.courses.flatMap((c) =>
          c.sources.map((s) => [s.id, s.readable]),
        ),
      );
      for (const course of next.courses) {
        for (const source of course.sources) {
          source.readable = readable.get(source.id) ?? source.readable;
        }
      }
      return next;
    });
    return Response.json(registry);
  } catch (error) {
    return libraryErrorResponse(error, 'save the library');
  }
}
