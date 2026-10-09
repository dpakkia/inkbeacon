import {
  clearStudioSession,
  createStudioSession,
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
  isValidAccessKey,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    configured: isStudioConfigured() && isBlobConfigured(),
    authenticated: await hasStudioSession(),
  });
}

export async function POST(request: Request) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Sincronizzazione server non configurata.' },
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
    return Response.json({ error: 'Chiave non valida.' }, { status: 401 });
  }

  await createStudioSession();
  return Response.json({ authenticated: true });
}

export async function DELETE() {
  await clearStudioSession();
  return Response.json({ authenticated: false });
}
