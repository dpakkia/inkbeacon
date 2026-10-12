import { getStorage } from '@/lib/storage';
import {
  allowsContentType,
  uploadPolicy,
  UploadRefusedError,
} from '@/lib/upload-policy';
import { requireLibraryAccess } from '@/lib/library-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Folder storage: the browser PUTs the file here and it's streamed to disk.
 * Self-hosted, so no request-size limit from a platform; the policy's own
 * limit is enforced while streaming, not only from Content-Length.
 */
export async function PUT(request: Request) {
  const denied = await requireLibraryAccess();
  if (denied) return denied;
  const storage = getStorage();
  if (storage.kind !== 'filesystem') {
    return Response.json(
      { error: 'Not available on this server.' },
      { status: 400 },
    );
  }
  const url = new URL(request.url);
  const pathname = url.searchParams.get('pathname') ?? '';
  const contentType = request.headers.get('content-type') ?? '';

  try {
    const policy = await uploadPolicy(pathname, {
      replace: url.searchParams.get('replace') === '1',
    });
    if (!allowsContentType(policy, contentType)) {
      throw new UploadRefusedError('This file type is not allowed here.');
    }
    if (Number(request.headers.get('content-length') ?? 0) > policy.maxBytes) {
      throw new UploadRefusedError('The file is too large.');
    }
    if (!request.body) throw new UploadRefusedError('Empty upload.');

    let received = 0;
    const limited = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > policy.maxBytes) {
            controller.error(new UploadRefusedError('The file is too large.'));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    await storage.put(pathname, limited, { contentType });
    return Response.json({ pathname, size: received });
  } catch (error) {
    if (error instanceof UploadRefusedError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error('Upload: unable to store a file', error);
    return Response.json(
      { error: 'Unable to store the file.' },
      { status: 502 },
    );
  }
}
