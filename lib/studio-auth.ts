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

export function isBlobConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID,
  );
}

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

export async function createStudioSession() {
  const accessKey = getAccessKey();
  if (!accessKey) return;
  (await cookies()).set(SESSION_COOKIE, getSessionValue(accessKey), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    priority: 'high',
  });
}

export async function clearStudioSession() {
  (await cookies()).set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
}

/**
 * Accesso per le rotte chiamabili anche fuori dal browser.
 *
 * Il cookie vale per la piattaforma aperta in una scheda; `Authorization:
 * Bearer <STUDIO_ACCESS_KEY>` vale per curl, per uno script o per una
 * dashboard esterna, che un cookie httpOnly non ce l'hanno.
 */
export async function hasStudioAccess(request: Request) {
  const header = request.headers.get('authorization')?.trim() ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(header);
  if (bearer && isValidAccessKey(bearer[1])) return true;
  return hasStudioSession();
}
