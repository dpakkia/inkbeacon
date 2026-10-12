import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del,
  get,
  head,
  list,
  put,
} from '@vercel/blob';

import {
  assertSafePath,
  PreconditionFailedError,
  type Storage,
} from '@/lib/storage/types';

/** `get` returns a weak ETag (W/"…"); a conditional `put` matches only the strong form. */
const strong = (etag: string) => etag.replace(/^W\//, '');

export function vercelBlobStorage(): Storage {
  return {
    kind: 'vercel-blob',

    async get(path) {
      assertSafePath(path);
      // straight from storage: never a stale CDN copy
      const result = await get(path, { access: 'private', useCache: false });
      if (!result) return null;
      if (result.statusCode !== 200)
        throw new Error(`Unexpected response for ${path}`);
      return {
        body: result.stream,
        etag: strong(result.blob.etag),
        size: result.blob.size,
        contentType: result.blob.contentType,
      };
    },

    async head(path) {
      assertSafePath(path);
      try {
        const blob = await head(path);
        return { etag: strong(blob.etag), size: blob.size };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },

    async put(path, body, options) {
      assertSafePath(path);
      try {
        // the SDK takes Buffers, not plain Uint8Arrays
        const payload = body instanceof Uint8Array ? Buffer.from(body) : body;
        const result = await put(path, payload, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: !options.ifNoneMatch,
          ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
          cacheControlMaxAge: 60,
          contentType: options.contentType,
        });
        return { etag: strong(result.etag) };
      } catch (error) {
        const conflict =
          error instanceof BlobPreconditionFailedError ||
          (error instanceof Error && /already exists/i.test(error.message));
        if (conflict) throw new PreconditionFailedError(path);
        throw error;
      }
    },

    async list(prefix) {
      const paths: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        paths.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return paths;
    },

    async delete(paths) {
      for (let i = 0; i < paths.length; i += 500) {
        await del(paths.slice(i, i + 500));
      }
    },
  };
}
