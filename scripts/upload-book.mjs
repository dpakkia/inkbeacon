/**
 * Uploads a converted book to the private Blob store and, with --course,
 * adds it to the library (the registry in Blob).
 *
 *   node scripts/upload-book.mjs example --course example-course
 *   node scripts/upload-book.mjs example --course example-course --pages 240
 *   node scripts/upload-book.mjs example --no-video
 *   node scripts/upload-book.mjs example --epub path/to/book.epub
 *
 * --epub also stores the original EPUB for KOReader's catalogue and sets the
 * book's KOReader ids (it must be the exact file you'll read in KOReader).
 * It works for a book already in the library too, without --course.
 * Without --course the files are uploaded but the book doesn't appear in the
 * app: that's for replacing the text of a book that's already listed.
 * Adding to the library imports lib/courses.ts, so it needs a Node version
 * that runs TypeScript directly (22.18+, or 23.6+).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { get, put } from '@vercel/blob';

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
const option = (name) => {
  const index = flags.indexOf(name);
  return index >= 0 ? flags[index + 1] : undefined;
};
if (!source) {
  console.error(
    'Usage: node scripts/upload-book.mjs <source-id> [--course <slug>] [--pages <n>] [--epub <file>] [--no-video]',
  );
  process.exit(1);
}
const noVideo = flags.includes('--no-video');
const courseSlug = option('--course');
const pages = option('--pages');
const epubPath = option('--epub');

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

let koreaderFields = null;
if (epubPath) {
  const { koreaderPartialMd5, koreaderFilenameMd5 } =
    await import('../lib/md5.ts');
  const { safeFileName } = await import('../lib/courses.ts');
  const epub = await readFile(epubPath);
  await upload(
    `studio/books/${source}/original.epub`,
    epub,
    'application/epub+zip',
  );
  const fileName = epubPath.split(/[\\/]/).pop();
  koreaderFields = {
    koreaderDigest: koreaderPartialMd5(new Uint8Array(epub)),
    koreaderFilenameDigest: koreaderFilenameMd5(fileName),
    originalName: safeFileName(fileName) || 'book.epub',
  };
  console.log(
    `original EPUB stored for KOReader (${(epub.length / 1048576).toFixed(1)} MB)`,
  );
}

if (courseSlug || koreaderFields) await addToLibrary();

/** Adds the book to the registry in Blob, like the library page does. */
async function addToLibrary() {
  const { parseRegistry, seedRegistry, isValidSourceId } =
    await import('../lib/courses.ts');
  if (!isValidSourceId(source)) {
    throw new Error(`"${source}" is not a valid book id.`);
  }
  const data = JSON.parse(await readFile(book, 'utf8'));
  const existing = await get('studio/registry.json', {
    access: 'private',
    useCache: false,
  });
  const registry = existing
    ? parseRegistry(await new Response(existing.stream).json())
    : seedRegistry();
  if (!registry) throw new Error('The stored registry is malformed.');

  const alreadyListed = registry.courses
    .flatMap((c) => c.sources)
    .find((s) => s.id === source);
  if (alreadyListed) {
    if (!koreaderFields) {
      console.log(`"${source}" is already in the library: details unchanged.`);
      return;
    }
    Object.assign(alreadyListed, koreaderFields);
    await saveRegistry(registry, existing);
    console.log(`"${source}": KOReader ids updated.`);
    return;
  }
  if (!courseSlug) {
    throw new Error(
      `"${source}" is not in the library yet: add --course <slug>.`,
    );
  }
  const course = registry.courses.find((c) => c.slug === courseSlug);
  if (!course) {
    const slugs = registry.courses.map((c) => c.slug).join(', ');
    throw new Error(`No course "${courseSlug}". Courses: ${slugs}`);
  }
  const title = String(data.title || source);
  course.sources.push({
    id: source,
    kind: 'book',
    title,
    shortTitle: title.slice(0, 30),
    author: String(data.author ?? ''),
    unit: pages ? 'pages' : 'chapters',
    total: pages ? Number(pages) : Number(data.chapterCount) || 0,
    readable: true,
    ...koreaderFields,
  });
  registry.deleted = registry.deleted.filter((id) => id !== source);
  await saveRegistry(registry, existing);
  console.log(`"${source}" added to the course "${course.name}".`);

  async function saveRegistry(next, previous) {
    next.updatedAt = new Date().toISOString();
    if (!parseRegistry(next)) throw new Error('The book details are invalid.');
    const etag = previous?.blob.etag.replace(/^W\//, '');
    await put('studio/registry.json', JSON.stringify(next), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: Boolean(etag),
      ...(etag ? { ifMatch: etag } : {}),
      cacheControlMaxAge: 60,
      contentType: 'application/json',
    });
  }
}
