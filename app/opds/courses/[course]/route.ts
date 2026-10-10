import { findCourse } from '@/lib/courses';
import {
  hasOpdsAccess,
  isKosyncConfigured,
  notEnabled,
  opdsUnauthorized,
} from '@/lib/kosync-auth';
import { ATOM_HEADERS, booksFeed, courseScope } from '@/lib/opds';
import { readRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ course: string }> },
) {
  if (!isKosyncConfigured()) return notEnabled();
  if (!hasOpdsAccess(request)) return opdsUnauthorized();
  const { course: slug } = await context.params;
  const registry = await readRegistry();
  const course = findCourse(registry, slug);
  if (!course) return new Response('Unknown course.', { status: 404 });
  const origin = new URL(request.url).origin;
  return new Response(booksFeed(origin, registry, courseScope(course)), {
    headers: ATOM_HEADERS,
  });
}
