/**
 * Uploads one file to the library, whatever the server's storage is.
 * Used by the Library page (in the browser) and by scripts/upload-book.mjs
 * (in Node, with a `baseUrl` and the session cookie in `headers`).
 *
 * - `vercel-blob`: straight to Blob with a short-lived token (the SDK's
 *   client upload, multipart for large files).
 * - `signed`: ask /api/library/upload/sign where to PUT the file (a
 *   presigned bucket URL, or this server's own upload route), then PUT it.
 */

export type UploadMode = 'vercel-blob' | 'signed';

export type UploadOptions = {
  mode: UploadMode;
  contentType: string;
  /** Allow replacing a book already in the library (the CLI's --replace). */
  replace?: boolean;
  /** For use outside the browser: the server's origin. */
  baseUrl?: string;
  /** For use outside the browser: e.g. the session cookie. */
  headers?: Record<string, string>;
};

export async function uploadMode(
  baseUrl = '',
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${baseUrl}/api/library/upload`, { headers });
  if (!response.ok) throw new Error('Unable to reach the library.');
  return ((await response.json()) as { mode: UploadMode }).mode;
}

export async function uploadFile(
  pathname: string,
  body: Blob | string,
  options: UploadOptions,
) {
  const base = options.baseUrl ?? '';
  const size =
    typeof body === 'string'
      ? new TextEncoder().encode(body).length
      : body.size;

  if (options.mode === 'vercel-blob') {
    const { upload } = await import('@vercel/blob/client');
    await upload(pathname, body, {
      access: 'private',
      handleUploadUrl: `${base}/api/library/upload`,
      contentType: options.contentType,
      multipart: size > 8 * 1024 * 1024,
      clientPayload: JSON.stringify({ replace: Boolean(options.replace) }),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    return;
  }

  const signResponse = await fetch(`${base}/api/library/upload/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify({
      pathname,
      contentType: options.contentType,
      size,
      replace: Boolean(options.replace),
    }),
  });
  const target = (await signResponse.json().catch(() => null)) as {
    url?: string;
    headers?: Record<string, string>;
    error?: string;
  } | null;
  if (!signResponse.ok || !target?.url) {
    throw new Error(target?.error ?? 'The upload was refused.');
  }
  // our own route needs the session; a presigned bucket URL needs nothing else
  const sameOrigin = target.url.startsWith('/');
  const response = await fetch(
    sameOrigin ? `${base}${target.url}` : target.url,
    {
      method: 'PUT',
      headers: { ...target.headers, ...(sameOrigin ? options.headers : {}) },
      body,
    },
  );
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(detail?.error ?? `Upload failed (${response.status}).`);
  }
}
