import { findSource, type Source } from '@/lib/courses';
import { isKosyncConfigured } from '@/lib/kosync-auth';
import {
  INKBEACON_DEVICE,
  INKBEACON_DEVICE_ID,
  readNewestRecord,
  spineFromXPointer,
  writeRecord,
  xpointerForSpine,
} from '@/lib/kosync';
import { readRegistry } from '@/lib/registry';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function digestsOf(source: Source) {
  return [source.koreaderDigest, source.koreaderFilenameDigest].filter(
    (d): d is string => Boolean(d),
  );
}

async function guard() {
  if (!isKosyncConfigured() || !isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'KOReader support is not enabled.' },
      { status: 404 },
    );
  }
  if (!(await hasStudioSession())) {
    return Response.json({ error: 'Access required.' }, { status: 401 });
  }
  return null;
}

/**
 * The newest KOReader-side position for a book (`?source=<id>`), for the
 * reader's "Continue from …" offer. `spine` is the EPUB file it points into.
 */
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('source') ?? '';
  try {
    const source = findSource(await readRegistry(), id);
    const digests = source ? digestsOf(source) : [];
    if (!digests.length) return Response.json({ record: null });
    const record = await readNewestRecord(digests);
    return Response.json(
      {
        record,
        spine: record ? spineFromXPointer(record.progress) : null,
        fromInkBeacon: record?.device_id === INKBEACON_DEVICE_ID,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('kosync: unable to read a position', error);
    return Response.json(
      { error: 'Unable to read the position.' },
      { status: 502 },
    );
  }
}

/**
 * Phase 2: InkBeacon's own position, `{source, spine, percentage}`, stored as
 * a kosync record KOReader will see: the start of that EPUB file.
 */
export async function PUT(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as {
    source?: unknown;
    spine?: unknown;
    percentage?: unknown;
  } | null;
  const spine = Number(body?.spine);
  const percentage = Number(body?.percentage);
  if (
    typeof body?.source !== 'string' ||
    !Number.isInteger(spine) ||
    spine < 0 ||
    spine > 100_000 ||
    !Number.isFinite(percentage)
  ) {
    return Response.json({ error: 'Invalid position.' }, { status: 400 });
  }
  try {
    const source = findSource(await readRegistry(), body.source);
    const digests = source ? digestsOf(source) : [];
    if (!digests.length) {
      return Response.json(
        { error: 'This book has no KOReader id.' },
        { status: 404 },
      );
    }
    const timestamp = Math.floor(Date.now() / 1000);
    await writeRecord(digests, {
      progress: xpointerForSpine(spine),
      percentage: Math.min(Math.max(percentage, 0), 1),
      device: INKBEACON_DEVICE,
      device_id: INKBEACON_DEVICE_ID,
      timestamp,
    });
    return Response.json({ timestamp });
  } catch (error) {
    console.error('kosync: unable to store a position', error);
    return Response.json(
      { error: 'Unable to store the position.' },
      { status: 502 },
    );
  }
}
