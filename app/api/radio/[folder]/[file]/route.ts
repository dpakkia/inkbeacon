import { AUDIO_FOLDER_PATTERN } from '@/lib/radio';
import { getStorage } from '@/lib/storage';
import { requireLibraryAccess } from '@/lib/library-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One track of an audio channel, for the logged-in reader only. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ folder: string; file: string }> },
) {
  const denied = await requireLibraryAccess();
  if (denied) return denied;
  const { folder, file } = await context.params;
  const name = decodeURIComponent(file);
  if (
    !AUDIO_FOLDER_PATTERN.test(folder) ||
    name.includes('/') ||
    name.startsWith('.')
  ) {
    return new Response('Invalid track.', { status: 400 });
  }
  try {
    const object = await getStorage().get(`studio/music/${folder}/${name}`);
    if (!object) return new Response('Track not found.', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.contentType,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error(`Radio: unable to serve "${folder}/${name}"`, error);
    return new Response('Unable to load the track.', { status: 502 });
  }
}
