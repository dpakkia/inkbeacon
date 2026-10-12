import { AUDIO_FOLDER_PATTERN, CHANNELS } from '@/lib/radio';
import { getStorage } from '@/lib/storage';
import { requireLibraryAccess } from '@/lib/library-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i;

/** The tracks of an audio channel: the files in studio/music/<folder>/. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ folder: string }> },
) {
  const denied = await requireLibraryAccess();
  if (denied) return denied;
  const { folder } = await context.params;
  const declared = CHANNELS.some(
    (c) => c.kind === 'audio' && c.folder === folder,
  );
  if (!declared || !AUDIO_FOLDER_PATTERN.test(folder)) {
    return Response.json({ error: 'Unknown channel.' }, { status: 404 });
  }
  try {
    const prefix = `studio/music/${folder}/`;
    const tracks = (await getStorage().list(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((name) => !name.includes('/') && AUDIO.test(name))
      .sort((a, b) => a.localeCompare(b));
    return Response.json(
      { tracks },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error(`Radio: unable to list "${folder}"`, error);
    return Response.json(
      { error: 'Unable to list the music.' },
      { status: 502 },
    );
  }
}
