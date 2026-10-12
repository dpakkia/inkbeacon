import {
  clearStudioSession,
  createStudioSession,
  hasStudioSession,
  isStorageConfigured,
  isStudioConfigured,
  isHttpsRequest,
  isValidAccessKey,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    configured: isStudioConfigured() && isStorageConfigured(),
    authenticated: await hasStudioSession(),
  });
}

export async function POST(request: Request) {
  if (!isStudioConfigured() || !isStorageConfigured()) {
    return Response.json(
      { error: 'Server sync is not configured.' },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    accessKey?: unknown;
  } | null;
  if (
    typeof body?.accessKey !== 'string' ||
    !isValidAccessKey(body.accessKey)
  ) {
    return Response.json({ error: 'Invalid key.' }, { status: 401 });
  }

  await createStudioSession(isHttpsRequest(request));
  return Response.json({ authenticated: true });
}

export async function DELETE(request: Request) {
  await clearStudioSession(isHttpsRequest(request));
  return Response.json({ authenticated: false });
}
