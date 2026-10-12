/**
 * Picks the storage backend from the environment.
 *
 * `STORAGE` chooses explicitly: `vercel-blob`, `filesystem` or `s3`.
 * Without it, the first that's configured wins:
 *   - Vercel Blob: `BLOB_READ_WRITE_TOKEN` (or `BLOB_STORE_ID` + OIDC on Vercel)
 *   - S3: `S3_BUCKET` (+ `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
 *     `S3_REGION` default "auto", `S3_VIRTUAL_HOSTED=true` for AWS-style URLs)
 *   - Folder: `STORAGE_DIR`
 * On Vercel the filesystem is temporary, so `filesystem` is refused there:
 * data written to it would disappear.
 */

import { filesystemStorage } from '@/lib/storage/filesystem';
import { s3Storage } from '@/lib/storage/s3';
import type { Storage, StorageKind } from '@/lib/storage/types';
import { vercelBlobStorage } from '@/lib/storage/vercel-blob';

export { PreconditionFailedError } from '@/lib/storage/types';
export type { Storage, StorageKind } from '@/lib/storage/types';

const env = (name: string) => process.env[name]?.trim() || undefined;

export function storageKind(): StorageKind | null {
  const chosen = env('STORAGE');
  const kind: StorageKind | null =
    chosen === 'vercel-blob' || chosen === 'filesystem' || chosen === 's3'
      ? chosen
      : env('BLOB_READ_WRITE_TOKEN') || env('BLOB_STORE_ID')
        ? 'vercel-blob'
        : env('S3_BUCKET')
          ? 's3'
          : env('STORAGE_DIR')
            ? 'filesystem'
            : null;
  if (kind === 'filesystem' && (process.env.VERCEL || !env('STORAGE_DIR')))
    return null;
  if (
    kind === 's3' &&
    !(
      env('S3_BUCKET') &&
      env('S3_ENDPOINT') &&
      env('S3_ACCESS_KEY_ID') &&
      env('S3_SECRET_ACCESS_KEY')
    )
  )
    return null;
  return kind;
}

export function isStorageConfigured() {
  return storageKind() !== null;
}

let cached: { key: string; storage: Storage } | null = null;

/** The configured storage; throws if none is. */
export function getStorage(): Storage {
  const kind = storageKind();
  if (!kind) throw new Error('No storage is configured (see INSTALL.md).');
  const key = `${kind}:${env('STORAGE_DIR')}:${env('S3_ENDPOINT')}:${env('S3_BUCKET')}`;
  if (cached?.key === key) return cached.storage;
  const storage =
    kind === 'vercel-blob'
      ? vercelBlobStorage()
      : kind === 'filesystem'
        ? filesystemStorage(env('STORAGE_DIR')!)
        : s3Storage({
            endpoint: env('S3_ENDPOINT')!,
            bucket: env('S3_BUCKET')!,
            region: env('S3_REGION') ?? 'auto',
            accessKeyId: env('S3_ACCESS_KEY_ID')!,
            secretAccessKey: env('S3_SECRET_ACCESS_KEY')!,
            virtualHosted: env('S3_VIRTUAL_HOSTED') === 'true',
          });
  cached = { key, storage };
  return storage;
}

/** Parsed JSON and its ETag; null when the object doesn't exist. */
export async function readJson(path: string) {
  const object = await getStorage().get(path);
  if (!object) return null;
  return {
    value: (await new Response(object.body).json()) as unknown,
    etag: object.etag,
  };
}
