import { allSources } from '@/lib/courses';
import {
  hasOpdsAccess,
  isKosyncConfigured,
  notEnabled,
  opdsUnauthorized,
} from '@/lib/kosync-auth';
import { ATOM_HEADERS, booksFeed } from '@/lib/opds';
import { readRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isKosyncConfigured()) return notEnabled();
  if (!hasOpdsAccess(request)) return opdsUnauthorized();
  const origin = new URL(request.url).origin;
  const registry = await readRegistry();
  return new Response(
    booksFeed(origin, registry, {
      id: 'urn:inkbeacon:all',
      title: 'All books',
      self: '/opds/all',
      sources: allSources(registry),
    }),
    { headers: ATOM_HEADERS },
  );
}
