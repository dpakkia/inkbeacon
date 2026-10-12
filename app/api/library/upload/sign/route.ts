import { getStorage } from '@/lib/storage';
import { s3Storage } from '@/lib/storage/s3';
import {
  allowsContentType,
  uploadPolicy,
  UploadRefusedError,
} from '@/lib/upload-policy';
import { requireLibraryAccess } from '@/lib/library-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Where the browser should PUT one file: a presigned URL to the bucket (S3),
 * or this server's own upload route (folder storage). Either way the path,
 * type and size are checked here first.
 */
export async function POST(request: Request) {
  const denied = await requireLibraryAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as {
    pathname?: unknown;
    contentType?: unknown;
    size?: unknown;
    replace?: unknown;
  } | null;
  const pathname = typeof body?.pathname === 'string' ? body.pathname : '';
  const contentType =
    typeof body?.contentType === 'string' ? body.contentType : '';
  const replace = body?.replace === true;

  try {
    const policy = await uploadPolicy(pathname, { replace });
    if (!allowsContentType(policy, contentType)) {
      throw new UploadRefusedError('This file type is not allowed here.');
    }
    if (typeof body?.size === 'number' && body.size > policy.maxBytes) {
      throw new UploadRefusedError('The file is too large.');
    }
    const storage = getStorage();
    if (storage.kind === 's3') {
      const target = await (storage as ReturnType<typeof s3Storage>).presignPut(
        pathname,
        contentType,
      );
      return Response.json({ method: 'PUT', ...target });
    }
    if (storage.kind === 'filesystem') {
      const query = new URLSearchParams({
        pathname,
        ...(replace ? { replace: '1' } : {}),
      });
      return Response.json({
        method: 'PUT',
        url: `/api/library/upload/file?${query}`,
        headers: { 'content-type': contentType },
      });
    }
    return Response.json(
      { error: 'Use the Vercel Blob upload on this server.' },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof UploadRefusedError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error('Upload: unable to sign', error);
    return Response.json(
      { error: 'Unable to prepare the upload.' },
      { status: 502 },
    );
  }
}
