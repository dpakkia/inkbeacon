import {
  hasOpdsAccess,
  isKosyncConfigured,
  notEnabled,
  opdsUnauthorized,
} from '@/lib/kosync-auth';
import { ATOM_HEADERS, rootFeed } from '@/lib/opds';
import { readRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** KOReader catalogue root: "All books" and one entry per course. */
export async function GET(request: Request) {
  if (!isKosyncConfigured()) return notEnabled();
  if (!hasOpdsAccess(request)) return opdsUnauthorized();
  const origin = new URL(request.url).origin;
  return new Response(rootFeed(origin, await readRegistry()), {
    headers: ATOM_HEADERS,
  });
}
