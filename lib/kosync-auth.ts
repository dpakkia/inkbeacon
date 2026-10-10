import { timingSafeEqual } from 'node:crypto';

import { md5Hex } from '@/lib/md5';

/**
 * KOReader sends `x-auth-user` and `x-auth-key` = MD5 of the password typed on
 * the device. InkBeacon has one reader, so any user name is accepted and the
 * key must match MD5(KOREADER_PASSWORD): a password of its own, so the device
 * holds nothing that unlocks the rest of the app.
 */
export function isKosyncConfigured() {
  return Boolean(process.env.KOREADER_PASSWORD?.trim());
}

export function hasKosyncAccess(request: Request) {
  const password = process.env.KOREADER_PASSWORD?.trim();
  const user = request.headers.get('x-auth-user') ?? '';
  const key = (request.headers.get('x-auth-key') ?? '').toLowerCase();
  if (!password || !user || user.includes(':') || !/^[0-9a-f]{32}$/.test(key))
    return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(md5Hex(password)));
}

/** Errors in the reference server's shape: `{ "message": … }`. */
export function kosyncError(status: number, message: string) {
  return Response.json({ message }, { status });
}

export const unauthorized = () => kosyncError(401, 'Unauthorized');

/** KOReader support is optional: without KOREADER_PASSWORD it doesn't exist. */
export const notEnabled = () =>
  kosyncError(404, 'KOReader support is not enabled on this server.');

/**
 * The OPDS catalogue uses HTTP Basic auth (KOReader's catalogue settings):
 * any user name, password = KOREADER_PASSWORD. Compared as MD5 digests so
 * the constant-time check works on equal lengths.
 */
export function hasOpdsAccess(request: Request) {
  const password = process.env.KOREADER_PASSWORD?.trim();
  const header = request.headers.get('authorization') ?? '';
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!password || !match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const given = decoded.slice(decoded.indexOf(':') + 1);
  if (!decoded.includes(':')) return false;
  return timingSafeEqual(
    Buffer.from(md5Hex(given)),
    Buffer.from(md5Hex(password)),
  );
}

export function opdsUnauthorized() {
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="InkBeacon", charset="UTF-8"' },
  });
}
