/**
 * Uploads a converted book (from scripts/import-*.py) to an InkBeacon server
 * and adds it to the library. It talks to the app's own API, so it works the
 * same whatever the server's storage is (Vercel Blob, S3, a folder).
 *
 *   node --env-file=.env.local scripts/upload-book.mjs my-book --course example-course
 *   node --env-file=.env.local scripts/upload-book.mjs my-book --course example-course --pages 240
 *   node --env-file=.env.local scripts/upload-book.mjs my-book --epub book.epub   (attach the EPUB, KOReader)
 *   node --env-file=.env.local scripts/upload-book.mjs my-book --replace          (re-upload a listed book's text)
 *
 * Reads data-private/books/<id>.json and data-private/media/<id>/.
 * Env: STUDIO_ACCESS_KEY (required), INKBEACON_URL (default http://localhost:3000).
 * Needs a Node version that runs TypeScript directly (22.18+, or 23.6+).
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const { uploadFile, uploadMode } = await import('../lib/upload-client.ts');

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
if (!source || source.startsWith('-')) {
  console.error(
    'Usage: node scripts/upload-book.mjs <source-id> [--course <slug>] [--pages <n>] [--epub <file>] [--replace] [--no-video]',
  );
  process.exit(1);
}
const courseSlug = option('--course');
const pages = option('--pages');
const epubPath = option('--epub');
const replace = flags.includes('--replace');
const noVideo = flags.includes('--no-video');

const base = (process.env.INKBEACON_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const accessKey = process.env.STUDIO_ACCESS_KEY?.trim();
if (!accessKey) {
  console.error(
    'Set STUDIO_ACCESS_KEY (for example with --env-file=.env.local).',
  );
  process.exit(1);
}

// log in: the session cookie authorizes every request below
const login = await fetch(`${base}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ accessKey }),
});
if (!login.ok) {
  console.error(
    `Login to ${base} failed (${login.status}): check STUDIO_ACCESS_KEY.`,
  );
  process.exit(1);
}
const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };

async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.error ?? `${path}: HTTP ${response.status}`);
  return body;
}

const library = await api('/api/library');
const listed = library.courses
  .flatMap((c) => c.sources)
  .find((s) => s.id === source);
// a listed book whose text isn't stored yet (the demo books on a new server)
const textMissing =
  Boolean(listed) &&
  (await fetch(`${base}/api/books/${source}`, { headers })).status === 404;

const mode = await uploadMode(base, headers);
const upload = (path, body, contentType) =>
  uploadFile(path, body, {
    mode,
    contentType,
    replace: replace || textMissing,
    baseUrl: base,
    headers,
  });

if (listed && !replace && !textMissing && !epubPath) {
  console.error(
    `"${source}" is already in the library. Use --replace to re-upload its text, or --epub to attach its EPUB.`,
  );
  process.exit(1);
}
if (!listed && !courseSlug) {
  console.error(`"${source}" is not in the library yet: add --course <slug>.`);
  process.exit(1);
}

const root = new URL('../data-private/', import.meta.url);
const bookPath = new URL(`books/${source}.json`, root);
const mediaDir = join(new URL('media/', root).pathname, source);
let book = null;

// the text and its media: for a new book, a missing text, or with --replace
if (!listed || replace || textMissing) {
  const json = await readFile(bookPath, 'utf8');
  book = JSON.parse(json);
  let media = [];
  try {
    media = await readdir(mediaDir);
  } catch {
    console.log('No media folder: text only.');
  }
  if (noVideo)
    media = media.filter((f) => !VIDEO.has(extname(f).toLowerCase()));
  let done = 0;
  for (let i = 0; i < media.length; i += 4) {
    const batch = media.slice(i, i + 4);
    await Promise.all(
      batch.map(async (name) => {
        const type =
          TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
        const data = await readFile(join(mediaDir, name));
        await upload(
          `studio/books/${source}/media/${name}`,
          new Blob([data], { type }),
          type,
        );
      }),
    );
    done += batch.length;
    console.log(`  ${done}/${media.length} media files`);
  }
  await upload(`studio/books/${source}/book.json`, json, 'application/json');
  console.log(`book.json uploaded for "${source}"`);
}

// the original EPUB, for KOReader's catalogue and sync
let koreaderFields = null;
if (epubPath) {
  const { koreaderPartialMd5, koreaderFilenameMd5 } =
    await import('../lib/md5.ts');
  const { safeFileName } = await import('../lib/courses.ts');
  const epub = await readFile(epubPath);
  await upload(
    `studio/books/${source}/original.epub`,
    new Blob([epub], { type: 'application/epub+zip' }),
    'application/epub+zip',
  );
  const fileName = epubPath.split(/[\\/]/).pop();
  koreaderFields = {
    koreaderDigest: koreaderPartialMd5(new Uint8Array(epub)),
    koreaderFilenameDigest: koreaderFilenameMd5(fileName),
    originalName: safeFileName(fileName) || 'book.epub',
  };
  console.log(
    `original EPUB stored (${(epub.length / 1048576).toFixed(1)} MB)`,
  );
}

if (!listed) {
  const title = String(book.title || source);
  const next = await api('/api/library/books', {
    method: 'POST',
    body: JSON.stringify({
      course: courseSlug,
      source: {
        id: source,
        title,
        shortTitle: title.slice(0, 30),
        author: String(book.author ?? ''),
        unit: pages ? 'pages' : 'chapters',
        total: pages ? Number(pages) : Number(book.chapterCount) || 0,
        ...koreaderFields,
      },
    }),
  });
  const course = next.courses.find((c) => c.slug === courseSlug);
  console.log(
    `"${source}" added to the course "${course?.name ?? courseSlug}".`,
  );
} else if (koreaderFields) {
  const courses = library.courses.map((c) => ({
    ...c,
    sources: c.sources.map((s) =>
      s.id === source ? { ...s, ...koreaderFields } : s,
    ),
  }));
  await api('/api/library', {
    method: 'PUT',
    body: JSON.stringify({ courses, settings: library.settings }),
  });
  console.log(`"${source}": EPUB attached for KOReader.`);
} else {
  console.log(`"${source}": text ${textMissing ? 'uploaded' : 'replaced'}.`);
}
