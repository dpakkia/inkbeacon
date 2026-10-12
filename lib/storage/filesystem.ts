import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

import {
  assertSafePath,
  contentTypeOf,
  PreconditionFailedError,
  type Storage,
} from '@/lib/storage/types';

/**
 * A folder on disk: a Docker volume or a directory on a server. One process
 * owns it (InkBeacon isn't meant to run several replicas on one folder), so
 * conditional writes are made atomic with an in-process lock per path.
 */
export function filesystemStorage(root: string): Storage {
  const base = resolve(root);
  const locks = new Map<string, Promise<unknown>>();

  const fileOf = (path: string) => {
    assertSafePath(path);
    const file = resolve(base, path);
    if (!file.startsWith(base + sep))
      throw new Error(`Invalid storage path: ${path}`);
    return file;
  };

  /** size + modification time in nanoseconds: changes on every write */
  const etagOf = async (file: string) => {
    try {
      const info = await stat(file, { bigint: true });
      return {
        etag: `"${info.size}-${info.mtimeNs}"`,
        size: Number(info.size),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };

  /** Runs `task` after any earlier task on the same path has finished. */
  const withLock = async <T>(path: string, task: () => Promise<T>) => {
    const previous = locks.get(path) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    locks.set(path, current);
    try {
      return await current;
    } finally {
      if (locks.get(path) === current) locks.delete(path);
    }
  };

  return {
    kind: 'filesystem',

    async get(path) {
      const file = fileOf(path);
      const meta = await etagOf(file);
      if (!meta) return null;
      return {
        body: Readable.toWeb(
          createReadStream(file),
        ) as ReadableStream<Uint8Array>,
        etag: meta.etag,
        size: meta.size,
        contentType: contentTypeOf(path),
      };
    },

    async head(path) {
      return etagOf(fileOf(path));
    },

    async put(path, body, options) {
      const file = fileOf(path);
      return withLock(path, async () => {
        const current = await etagOf(file);
        if (options.ifNoneMatch && current)
          throw new PreconditionFailedError(path);
        if (options.ifMatch && current?.etag !== options.ifMatch)
          throw new PreconditionFailedError(path);

        await mkdir(dirname(file), { recursive: true });
        // write next to the target, then rename: readers never see half a file
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
          const source =
            typeof body === 'string' || body instanceof Uint8Array
              ? Readable.from([
                  typeof body === 'string' ? Buffer.from(body) : body,
                ])
              : Readable.fromWeb(
                  body as import('node:stream/web').ReadableStream,
                );
          await pipeline(source, createWriteStream(temp));
          await rename(temp, file);
        } catch (error) {
          await rm(temp, { force: true });
          throw error;
        }
        const written = await etagOf(file);
        return { etag: written!.etag };
      });
    },

    async list(prefix) {
      assertSafePath(prefix.replace(/\/$/, '') || 'x');
      const start = resolve(
        base,
        prefix.endsWith('/') ? prefix : dirname(prefix),
      );
      if (!start.startsWith(base)) return [];
      const out: string[] = [];
      const walk = async (dir: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (!entry.name.endsWith('.tmp')) {
            const key = relative(base, full).split(sep).join('/');
            if (key.startsWith(prefix)) out.push(key);
          }
        }
      };
      await walk(start);
      return out;
    },

    async delete(paths) {
      for (const path of paths) await rm(fileOf(path), { force: true });
    },
  };
}
