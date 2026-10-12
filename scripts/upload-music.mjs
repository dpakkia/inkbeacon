/**
 * Uploads a folder of your own music to an audio radio channel, on any
 * storage (it goes through the app's API, like upload-book.mjs).
 *
 *   node --env-file=.env.local scripts/upload-music.mjs ~/Music/study my-music
 *
 * Then declare the channel in lib/radio.ts:
 *   { id: 'my-music', name: 'My music', kind: 'audio', folder: 'my-music' }
 *
 * File names are kept readable but made safe (letters, digits, spaces, . _ -).
 * Env: STUDIO_ACCESS_KEY (required), INKBEACON_URL (default http://localhost:3000).
 * Needs Node 22.18+ (reads lib/upload-client.ts).
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const { uploadFile, uploadMode } = await import('../lib/upload-client.ts');

const TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
};

const [dir, folder] = process.argv.slice(2);
if (!dir || !folder || !/^[a-z0-9][a-z0-9_-]{0,59}$/.test(folder)) {
  console.error(
    'Usage: node scripts/upload-music.mjs <local-folder> <channel-folder>\n' +
      '  <channel-folder>: lowercase letters, digits, - and _ (e.g. my-music)',
  );
  process.exit(1);
}
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
const mode = await uploadMode(base, headers);

/** "Ce n'est rien (Remaster) [2009].mp3" -> "Ce n_est rien Remaster 2009.mp3" */
const safeName = (name) => {
  const ext = extname(name).toLowerCase();
  const stem = name
    .slice(0, -extname(name).length)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '_')
    .replace(/[^A-Za-z0-9._ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 180);
  return `${stem || 'track'}${ext}`;
};

const files = (await readdir(dir)).filter(
  (f) => TYPES[extname(f).toLowerCase()],
);
if (!files.length) {
  console.error(`No audio files (${Object.keys(TYPES).join(' ')}) in ${dir}.`);
  process.exit(1);
}
let done = 0;
for (const file of files.sort()) {
  const type = TYPES[extname(file).toLowerCase()];
  const data = await readFile(join(dir, file));
  await uploadFile(
    `studio/music/${folder}/${safeName(file)}`,
    new Blob([data], { type }),
    {
      mode,
      contentType: type,
      baseUrl: base,
      headers,
    },
  );
  done += 1;
  console.log(`  ${done}/${files.length} ${safeName(file)}`);
}
console.log(
  `\n${done} tracks in studio/music/${folder}/. Declare the channel in lib/radio.ts if you haven't.`,
);
