/**
 * The registry of courses and books, in storage (`studio/registry.json`).
 *
 * A missing registry means "not created yet": the seed from `lib/courses.ts`
 * stands in until the first change is saved. Any other failure throws. If a
 * read error fell back to the seed, the next save of the study state would
 * treat every uploaded book as unknown.
 */

import { getStorage, PreconditionFailedError, readJson } from '@/lib/storage';

import { parseRegistry, seedRegistry, type Registry } from '@/lib/courses';
import { isStorageConfigured } from '@/lib/studio-auth';

const REGISTRY_PATH = 'studio/registry.json';

type Loaded = { registry: Registry; etag: string | null };

async function load(): Promise<Loaded> {
  const stored = await readJson(REGISTRY_PATH);
  if (!stored) return { registry: seedRegistry(), etag: null };
  const registry = parseRegistry(stored.value);
  if (!registry) throw new Error('The stored registry is malformed');
  return { registry, etag: stored.etag };
}

/** The current registry; the seed when no storage is configured or nothing is stored yet. */
export async function readRegistry(): Promise<Registry> {
  if (!isStorageConfigured()) return seedRegistry();
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
      await getStorage().put(REGISTRY_PATH, JSON.stringify(next), {
        contentType: 'application/json',
        // first write: fail if someone else created it meanwhile
        ...(etag ? { ifMatch: etag } : { ifNoneMatch: true }),
      });
      return next;
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error;
    }
  }
  throw new RegistryConflictError('The registry kept changing; try again.');
}
