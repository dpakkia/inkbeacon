/**
 * The storage every part of InkBeacon goes through: books, media, the study
 * document, the course list, KOReader positions. Three backends implement
 * it (`lib/storage/index.ts` picks one from the environment):
 *
 * - `vercel-blob`: a private Vercel Blob store (Vercel deployments)
 * - `filesystem`: a folder on disk (Docker volume, manual install)
 * - `s3`: any S3-compatible bucket (Cloudflare R2, Backblaze B2, MinIO, AWS)
 *
 * Paths are slash-separated keys such as `studio/state.json`.
 */

export type StorageKind = 'vercel-blob' | 'filesystem' | 's3';

export type StoredObject = {
  body: ReadableStream<Uint8Array>;
  /** Strong ETag, usable as `ifMatch` in a later `put`. */
  etag: string;
  size: number;
  contentType: string;
};

export type PutOptions = {
  contentType: string;
  /** Write only if the object still has this ETag (optimistic concurrency). */
  ifMatch?: string;
  /** Write only if the object doesn't exist yet. */
  ifNoneMatch?: boolean;
};

export interface Storage {
  readonly kind: StorageKind;
  /** null when the object doesn't exist; throws on any other failure. */
  get(path: string): Promise<StoredObject | null>;
  head(path: string): Promise<{ etag: string; size: number } | null>;
  /** Throws `PreconditionFailedError` when `ifMatch`/`ifNoneMatch` don't hold. */
  put(
    path: string,
    body: string | Uint8Array | ReadableStream<Uint8Array>,
    options: PutOptions,
  ): Promise<{ etag: string }>;
  /** Every path under a prefix. */
  list(prefix: string): Promise<string[]>;
  delete(paths: string[]): Promise<void>;
}

export class PreconditionFailedError extends Error {
  constructor(path: string) {
    super(`"${path}" changed in the meantime`);
  }
}

/** Content type from a path's extension, for backends that don't store one. */
export function contentTypeOf(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return (
    {
      json: 'application/json',
      epub: 'application/epub+zip',
      gif: 'image/gif',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      opus: 'audio/ogg',
      flac: 'audio/flac',
      wav: 'audio/wav',
    }[ext] ?? 'application/octet-stream'
  );
}

/** Rejects keys that could escape a folder or a bucket prefix. */
export function assertSafePath(path: string) {
  if (
    !path ||
    path.length > 512 ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    // spaces too: music files are rarely named without them
    !/^[A-Za-z0-9._/ -]+$/.test(path) ||
    path.split('/').some((part) => part !== part.trim())
  ) {
    throw new Error(`Invalid storage path: ${path}`);
  }
}
