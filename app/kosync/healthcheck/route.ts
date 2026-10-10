import { isKosyncConfigured, notEnabled } from '@/lib/kosync-auth';

export const dynamic = 'force-dynamic';

export function GET() {
  if (!isKosyncConfigured()) return notEnabled();
  return Response.json({ state: 'OK' });
}
