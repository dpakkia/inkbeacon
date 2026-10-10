import {
  hasKosyncAccess,
  kosyncError,
  unauthorized,
  isKosyncConfigured,
  notEnabled,
} from '@/lib/kosync-auth';
import { DOCUMENT_PATTERN, writeRecord } from '@/lib/kosync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * KOReader pushes its position: `{document, progress, percentage, device,
 * device_id, metadata?}`. KOReader waits at most a few seconds, so this only
 * validates and writes; matching the document to a book happens when the
 * reader asks for it.
 */
export async function PUT(request: Request) {
  if (!isKosyncConfigured()) return notEnabled();
  if (!hasKosyncAccess(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const document = typeof body?.document === 'string' ? body.document : '';
  if (!document) return kosyncError(403, "Field 'document' not provided.");
  if (!DOCUMENT_PATTERN.test(document)) {
    return kosyncError(
      403,
      "Field 'document' contains characters the read route cannot serve.",
    );
  }
  const percentage = Number(body?.percentage);
  const { progress, device, device_id } = body ?? {};
  if (
    !Number.isFinite(percentage) ||
    typeof progress !== 'string' ||
    !progress ||
    progress.length > 2_000 ||
    typeof device !== 'string' ||
    !device ||
    device.length > 200 ||
    (device_id !== undefined &&
      (typeof device_id !== 'string' || device_id.length > 200))
  ) {
    return kosyncError(403, 'Invalid request');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  try {
    await writeRecord([document], {
      progress,
      percentage: Math.min(Math.max(percentage, 0), 1),
      device,
      ...(device_id ? { device_id: device_id as string } : {}),
      timestamp,
    });
  } catch (error) {
    console.error('kosync: unable to store progress', error);
    return kosyncError(502, 'Unknown server error.');
  }
  return Response.json({ document, timestamp });
}
