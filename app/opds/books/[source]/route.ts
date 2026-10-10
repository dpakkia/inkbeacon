import { get } from '@vercel/blob';

import { findSource } from '@/lib/courses';
import {
  hasOpdsAccess,
  isKosyncConfigured,
  notEnabled,
  opdsUnauthorized,
} from '@/lib/kosync-auth';
import { readRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The original EPUB, byte for byte: KOReader identifies a book by a hash of
 * its bytes, so this exact file is what makes progress sync match.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ source: string }> },
) {
  if (!isKosyncConfigured()) return notEnabled();
  if (!hasOpdsAccess(request)) return opdsUnauthorized();
  const { source: id } = await context.params;
  try {
    const source = findSource(await readRegistry(), id);
    if (!source?.originalName) {
      return new Response('No EPUB stored for this book.', { status: 404 });
    }
    const result = await get(`studio/books/${id}/original.epub`, {
      access: 'private',
      useCache: false,
    });
    if (!result || result.statusCode !== 200) {
      return new Response('EPUB not found.', { status: 404 });
    }
    const name = source.originalName;
    return new Response(result.stream, {
      headers: {
        'Content-Type': 'application/epub+zip',
        'Content-Length': String(result.blob.size),
        'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error(`OPDS: unable to serve "${id}"`, error);
    return new Response('Unable to load the EPUB.', { status: 502 });
  }
}
