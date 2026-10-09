/**
 * The registry of courses and books, stored in Blob.
 *
 * A missing registry means "not created yet": the seed from `lib/courses.ts`
 * stands in until the first change is saved. Any other failure throws. If a
 * read error fell back to the seed, the next save of the study state would
 * treat every uploaded book as unknown.
 */

import { BlobPreconditionFailedError, get, put } from '@vercel/blob';

import { parseRegistry, seedRegistry, type Registry } from '@/lib/courses';
import { isBlobConfigured } from '@/lib/studio-auth';

const REGISTRY_PATH = 'studio/registry.json';

type Loaded = { registry: Registry; etag: string | null };

async function load(): Promise<Loaded> {
  const result = await get(REGISTRY_PATH, {
    access: 'private',
    useCache: false,
  });
  if (!result) return { registry: seedRegistry(), etag: null };
  if (result.statusCode !== 200)
    throw new Error('Unexpected registry response');
  const registry = parseRegistry(await new Response(result.stream).json());
  if (!registry) throw new Error('The stored registry is malformed');
  // `get` returns a weak ETag (W/"…"); a conditional `put` only matches the
  // strong form
  return { registry, etag: result.blob.etag.replace(/^W\//, '') };
}

/** The current registry; the seed when Blob isn't configured or nothing is stored yet. */
export async function readRegistry(): Promise<Registry> {
  if (!isBlobConfigured()) return seedRegistry();
  return (await load()).registry;
}

export class RegistryConflictError extends Error {}

/**
 * Applies `change` to the latest registry and saves it, retrying when another
 * write landed in between. `change` may throw to abort; it must not have side
 * effects, because it can run more than once.
 */
export async function updateRegistry(
  change: (registry: Registry) => Registry,
): Promise<Registry> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { registry, etag } = await load();
    const next = parseRegistry({
      ...change(structuredClone(registry)),
      updatedAt: new Date().toISOString(),
    });
    if (!next) throw new Error('The changed registry is invalid');
    try {
      await put(REGISTRY_PATH, JSON.stringify(next), {
        access: 'private',
        addRandomSuffix: false,
        // first write: fail if someone else created it meanwhile
        allowOverwrite: etag !== null,
        ...(etag ? { ifMatch: etag } : {}),
        cacheControlMaxAge: 60,
        contentType: 'application/json',
      });
      return next;
    } catch (error) {
      const conflict =
        error instanceof BlobPreconditionFailedError ||
        (error instanceof Error && /already exists/i.test(error.message));
      if (!conflict) throw error;
    }
  }
  throw new RegistryConflictError('The registry kept changing; try again.');
}
