import { AwsClient } from 'aws4fetch';

import {
  assertSafePath,
  contentTypeOf,
  PreconditionFailedError,
  type Storage,
} from '@/lib/storage/types';

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** https://bucket.endpoint/key instead of https://endpoint/bucket/key (AWS). */
  virtualHosted: boolean;
};

const encodeKey = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/');

/**
 * Any S3-compatible bucket: Cloudflare R2, Backblaze B2, MinIO, AWS S3.
 * Conditional writes use If-Match / If-None-Match on PUT (supported by AWS
 * since 2024, R2 and MinIO). Browser uploads use presigned PUT URLs, so the
 * bucket needs a CORS rule allowing PUT from the site's origin.
 */
export function s3Storage(config: S3Config) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });
  const endpoint = config.endpoint.replace(/\/+$/, '');

  const urlOf = (path = '') => {
    if (config.virtualHosted) {
      const url = new URL(endpoint);
      url.hostname = `${config.bucket}.${url.hostname}`;
      return `${url.origin}/${path}`;
    }
    return `${endpoint}/${config.bucket}/${path}`;
  };

  const request = async (
    path: string,
    init: RequestInit & { url?: string },
  ) => {
    const response = await client.fetch(
      init.url ?? urlOf(encodeKey(path)),
      init,
    );
    return response;
  };

  const fail = async (response: Response, what: string) => {
    const text = await response.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? response.statusText;
    return new Error(`S3 ${what} failed: ${response.status} ${code}`);
  };

  const storage: Storage & {
    presignPut(
      path: string,
      contentType: string,
      seconds?: number,
    ): Promise<{ url: string; headers: Record<string, string> }>;
  } = {
    kind: 's3',

    async get(path) {
      assertSafePath(path);
      const response = await request(path, { method: 'GET' });
      if (response.status === 404) return null;
      if (!response.ok || !response.body)
        throw await fail(response, `GET ${path}`);
      return {
        body: response.body,
        etag: response.headers.get('etag') ?? '',
        size: Number(response.headers.get('content-length') ?? 0),
        contentType:
          response.headers.get('content-type') ?? contentTypeOf(path),
      };
    },

    async head(path) {
      assertSafePath(path);
      const response = await request(path, { method: 'HEAD' });
      if (response.status === 404) return null;
      if (!response.ok) throw await fail(response, `HEAD ${path}`);
      return {
        etag: response.headers.get('etag') ?? '',
        size: Number(response.headers.get('content-length') ?? 0),
      };
    },

    async put(path, body, options) {
      assertSafePath(path);
      const headers: Record<string, string> = {
        'content-type': options.contentType,
      };
      if (options.ifMatch) headers['if-match'] = options.ifMatch;
      if (options.ifNoneMatch) headers['if-none-match'] = '*';
      // aws4fetch signs the payload: a stream is read into memory first
      const payload =
        typeof body === 'string' || body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      const response = await request(path, {
        method: 'PUT',
        headers,
        body: payload as BodyInit,
      });
      // 409: AWS's ConditionalRequestConflict, a concurrent conditional write
      if (response.status === 412 || response.status === 409)
        throw new PreconditionFailedError(path);
      if (!response.ok) throw await fail(response, `PUT ${path}`);
      return { etag: response.headers.get('etag') ?? '' };
    },

    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const query = new URLSearchParams({ 'list-type': '2', prefix });
        if (token) query.set('continuation-token', token);
        const response = await request('', {
          method: 'GET',
          url: `${urlOf()}?${query}`,
        });
        if (!response.ok) throw await fail(response, `LIST ${prefix}`);
        const xml = await response.text();
        for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
          keys.push(
            match[1]
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'"),
          );
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(
              xml,
            )?.[1]
          : undefined;
      } while (token);
      return keys;
    },

    async delete(paths) {
      for (let i = 0; i < paths.length; i += 8) {
        await Promise.all(
          paths.slice(i, i + 8).map(async (path) => {
            assertSafePath(path);
            const response = await request(path, { method: 'DELETE' });
            if (!response.ok && response.status !== 404)
              throw await fail(response, `DELETE ${path}`);
          }),
        );
      }
    },

    /** A short-lived URL the browser can PUT one file to, with this content type. */
    async presignPut(path, contentType, seconds = 900) {
      assertSafePath(path);
      const url = new URL(urlOf(encodeKey(path)));
      url.searchParams.set('X-Amz-Expires', String(seconds));
      const signed = await client.sign(url.toString(), {
        method: 'PUT',
        headers: { 'content-type': contentType },
        aws: { signQuery: true },
      });
      return { url: signed.url, headers: { 'content-type': contentType } };
    },
  };
  return storage;
}
