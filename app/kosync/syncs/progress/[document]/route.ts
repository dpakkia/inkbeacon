import {
  hasKosyncAccess,
  kosyncError,
  unauthorized,
  isKosyncConfigured,
  notEnabled,
} from '@/lib/kosync-auth';
import { DOCUMENT_PATTERN, readRecord } from '@/lib/kosync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The last position stored for a document, or `{}` if there is none. */
export async function GET(
  request: Request,
  context: { params: Promise<{ document: string }> },
) {
  if (!isKosyncConfigured()) return notEnabled();
  if (!hasKosyncAccess(request)) return unauthorized();
  const { document } = await context.params;
  if (!DOCUMENT_PATTERN.test(document)) {
    return kosyncError(403, "Field 'document' not provided.");
  }
  try {
    const record = await readRecord(document);
    return Response.json(record ? { document, ...record } : {}, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('kosync: unable to read progress', error);
    return kosyncError(502, 'Unknown server error.');
  }
}
