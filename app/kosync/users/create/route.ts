import { kosyncError, isKosyncConfigured, notEnabled } from '@/lib/kosync-auth';

export const dynamic = 'force-dynamic';

/** InkBeacon has one reader: registering is off; use "Login" in KOReader. */
export function POST() {
  if (!isKosyncConfigured()) return notEnabled();
  return kosyncError(402, 'User registration is disabled.');
}
