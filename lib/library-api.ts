/** Shared guards for the library routes. */

import { RegistryConflictError } from '@/lib/registry';
import {
  hasStudioSession,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

/** An error with a status, safe to show to the user. */
export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requireLibraryAccess() {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Server storage is not configured.' },
      { status: 503 },
    );
  }
  if (!(await hasStudioSession())) {
    return Response.json({ error: 'Access required.' }, { status: 401 });
  }
  return null;
}

export function libraryErrorResponse(error: unknown, action: string) {
  if (error instanceof LibraryError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RegistryConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  console.error(`Library: unable to ${action}`, error);
  return Response.json(
    { error: `Unable to ${action}. Try again.` },
    { status: 502 },
  );
}
