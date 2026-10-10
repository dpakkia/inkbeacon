import {
  hasKosyncAccess,
  unauthorized,
  isKosyncConfigured,
  notEnabled,
} from '@/lib/kosync-auth';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (!isKosyncConfigured()) return notEnabled();
  if (!hasKosyncAccess(request)) return unauthorized();
  return Response.json({ authorized: 'OK' });
}
