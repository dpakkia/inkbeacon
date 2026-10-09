import { head } from '@vercel/blob';

import {
  findCourse,
  findSource,
  isValidCourseSlug,
  isValidSourceId,
  parseRegistry,
  slugify,
  type Source,
} from '@/lib/courses';
import {
  LibraryError,
  libraryErrorResponse,
  requireLibraryAccess,
} from '@/lib/library-api';
import { updateRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  source?: Partial<Source>;
  /** An existing course… */
  course?: string;
  /** …or a new one, created with this name. */
  newCourse?: { name?: string; description?: string };
};

/** Adds an uploaded book to the library, once its book.json is in Blob. */
export async function POST(request: Request) {
  const denied = await requireLibraryAccess();
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as Body | null;
  const id = body?.source?.id ?? '';
  if (!isValidSourceId(id)) {
    return Response.json({ error: 'Invalid book id.' }, { status: 400 });
  }

  try {
    const uploaded = await head(`studio/books/${id}/book.json`).catch(
      () => null,
    );
    if (!uploaded) {
      throw new LibraryError('The book file was not uploaded.', 400);
    }

    const registry = await updateRegistry((current) => {
      if (findSource(current, id)) {
        throw new LibraryError(
          `A book with the id "${id}" already exists.`,
          409,
        );
      }
      const source = { ...body?.source, id, kind: 'book', readable: true };

      let slug = body?.course ?? '';
      if (body?.newCourse) {
        const name = body.newCourse.name?.trim() ?? '';
        const base = slugify(name, 60) || 'course';
        slug = base;
        for (let n = 2; findCourse(current, slug); n += 1)
          slug = `${base}-${n}`;
        if (!name || !isValidCourseSlug(slug)) {
          throw new LibraryError('Invalid course name.', 400);
        }
        current.courses.push({
          slug,
          name,
          description: body.newCourse.description?.trim() ?? '',
          sources: [],
        });
      }
      const course = findCourse(current, slug);
      if (!course) throw new LibraryError('Unknown course.', 400);
      course.sources.push(source as Source);

      const next = parseRegistry({
        ...current,
        // uploading an id again after deleting it starts fresh
        deleted: current.deleted.filter((d) => d !== id),
      });
      if (!next) throw new LibraryError('Some book details are invalid.', 400);
      return next;
    });
    return Response.json(registry);
  } catch (error) {
    return libraryErrorResponse(error, 'add the book');
  }
}
