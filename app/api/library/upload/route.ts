import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

import { getStorage, storageKind } from '@/lib/storage';
import { uploadPolicy } from '@/lib/upload-policy';
import {
  hasStudioSession,
  isStorageConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * How uploads work on this server: `vercel-blob` (the browser uploads
 * straight to Blob with a token from POST here) or `signed` (POST
 * /api/library/upload/sign returns where to PUT the file).
 */
export async function GET() {
  if (!(await hasStudioSession()))
    return Response.json({ error: 'Access required.' }, { status: 401 });
  return Response.json({
    mode: storageKind() === 'vercel-blob' ? 'vercel-blob' : 'signed',
  });
}

/**
 * Vercel Blob only: issues short-lived tokens so the browser uploads straight
 * to Blob (Vercel functions accept at most 4.5 MB per request). What may be
 * uploaded is decided by `uploadPolicy`.
 */
export async function POST(request: Request) {
  if (!isStudioConfigured() || !isStorageConfigured()) {
    return Response.json(
      { error: 'Server storage is not configured.' },
      { status: 503 },
    );
  }
  if (getStorage().kind !== 'vercel-blob') {
    return Response.json(
      { error: 'Use /api/library/upload/sign on this server.' },
      { status: 400 },
    );
  }
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!(await hasStudioSession())) throw new Error('Access required.');
        const { replace } = JSON.parse(clientPayload || '{}') as {
          replace?: boolean;
        };
        const policy = await uploadPolicy(pathname, { replace });
        return {
          allowedContentTypes: policy.contentTypes,
          maximumSizeInBytes: policy.maxBytes,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload refused.';
    return Response.json({ error: message }, { status: 400 });
  }
}
