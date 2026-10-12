import { createHmac, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';

const SESSION_COOKIE = 'studio-session';
const SESSION_MESSAGE = 'studio-session-v1';

function getAccessKey() {
  return process.env.STUDIO_ACCESS_KEY?.trim() ?? '';
}

function getSessionValue(accessKey: string) {
  return createHmac('sha256', accessKey)
    .update(SESSION_MESSAGE)
    .digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function isStudioConfigured() {
  return Boolean(getAccessKey());
}

/** Some storage backend is configured (see lib/storage). */
export { isStorageConfigured } from '@/lib/storage';

export function isValidAccessKey(candidate: string) {
  const accessKey = getAccessKey();
  return Boolean(accessKey) && safeEqual(candidate, accessKey);
}

export async function hasStudioSession() {
  const accessKey = getAccessKey();
  if (!accessKey) return false;
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  return safeEqual(session, getSessionValue(accessKey));
}

/**
 * Whether the request came over HTTPS (directly, or through Vercel or a
 * reverse proxy). The session cookie is marked Secure only then: a server on
 * a home network over plain HTTP must still be able to log in.
 */
export function isHttpsRequest(request: Request) {
  return (
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
  );
}

export async function createStudioSession(secure: boolean) {
  const accessKey = getAccessKey();
  if (!accessKey) return;
  (await cookies()).set(SESSION_COOKIE, getSessionValue(accessKey), {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    priority: 'high',
  });
}

export async function clearStudioSession(secure: boolean) {
  (await cookies()).set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: 0,
    path: '/',
  });
}

/**
 * Access for routes that can also be called from outside the browser.
 *
 * The cookie covers the platform open in a tab; `Authorization: Bearer
 * <STUDIO_ACCESS_KEY>` covers curl, a script or an external dashboard, none of
 * which have an httpOnly cookie.
 */
export async function hasStudioAccess(request: Request) {
  const header = request.headers.get('authorization')?.trim() ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(header);
  if (bearer && isValidAccessKey(bearer[1])) return true;
  return hasStudioSession();
}
