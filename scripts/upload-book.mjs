/**
 * Uploads a converted book to the private Blob store.
 *
 *   node scripts/upload-book.mjs example
 *   node scripts/upload-book.mjs example --no-video
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { put } from '@vercel/blob';

const TYPES = {
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
};
const VIDEO = new Set(['.mp4', '.m4v', '.webm']);

const [source, ...flags] = process.argv.slice(2);
if (!source) {
  console.error('Usage: node scripts/upload-book.mjs <source-id> [--no-video]');
  process.exit(1);
}
const noVideo = flags.includes('--no-video');

const root = new URL('../data-private/', import.meta.url);
const book = new URL(`books/${source}.json`, root);
const mediaDir = join(new URL('media/', root).pathname, source);

async function upload(pathname, body, contentType) {
  await put(pathname, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType,
  });
}

await upload(
  `studio/books/${source}/book.json`,
  await readFile(book),
  'application/json',
);
console.log(`book.json uploaded for "${source}"`);

let media = [];
try {
  media = await readdir(mediaDir);
} catch {
  console.log('No media folder: text only.');
}
if (noVideo) {
  const before = media.length;
  media = media.filter((f) => !VIDEO.has(extname(f).toLowerCase()));
  console.log(`Skipped ${before - media.length} videos (--no-video).`);
}

let uploaded = 0;
let bytes = 0;
for (let i = 0; i < media.length; i += 8) {
  const batch = media.slice(i, i + 8);
  // `bytes += await …` would read bytes before the await: with parallel
  // batches the increments get lost. Sum the results, not the variable.
  const sizes = await Promise.all(
    batch.map(async (filename) => {
      const path = join(mediaDir, filename);
      const { size } = await stat(path);
      await upload(
        `studio/books/${source}/media/${filename}`,
        await readFile(path),
        TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream',
      );
      return size;
    }),
  );
  bytes += sizes.reduce((a, b) => a + b, 0);
  uploaded += batch.length;
  console.log(`  ${uploaded}/${media.length} media files`);
}

console.log(
  `"${source}" in the private store: ${uploaded} media, ${(bytes / 1048576).toFixed(1)} MB.`,
);
