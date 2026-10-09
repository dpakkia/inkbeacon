/**
 * Carica un libro convertito nello store Blob privato.
 *
 *   node scripts/upload-libro.mjs esempio
 *   node scripts/upload-libro.mjs esempio --senza-video
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { put } from '@vercel/blob';

const TIPI = {
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

const [fonte, ...flag] = process.argv.slice(2);
if (!fonte) {
  console.error('Uso: node scripts/upload-libro.mjs <id-fonte> [--senza-video]');
  process.exit(1);
}
const senzaVideo = flag.includes('--senza-video');

const root = new URL('../data-private/', import.meta.url);
const libro = new URL(`books/${fonte}.json`, root);
const mediaDir = join(new URL('media/', root).pathname, fonte);

async function carica(pathname, body, contentType) {
  await put(pathname, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType,
  });
}

await carica(
  `studio/books/${fonte}/book.json`,
  await readFile(libro),
  'application/json',
);
console.log(`book.json caricato per "${fonte}"`);

let media = [];
try {
  media = await readdir(mediaDir);
} catch {
  console.log('Nessuna cartella media: solo testo.');
}
if (senzaVideo) {
  const prima = media.length;
  media = media.filter((f) => !VIDEO.has(extname(f).toLowerCase()));
  console.log(`Esclusi ${prima - media.length} video (--senza-video).`);
}

let caricati = 0;
let byte = 0;
for (let i = 0; i < media.length; i += 8) {
  const lotto = media.slice(i, i + 8);
  // `byte += await …` leggerebbe byte prima dell'await: con i lotti in
  // parallelo gli incrementi si perdono. Somma i risultati, non la variabile.
  const misure = await Promise.all(
    lotto.map(async (filename) => {
      const percorso = join(mediaDir, filename);
      const { size } = await stat(percorso);
      await carica(
        `studio/books/${fonte}/media/${filename}`,
        await readFile(percorso),
        TIPI[extname(filename).toLowerCase()] ?? 'application/octet-stream',
      );
      return size;
    }),
  );
  byte += misure.reduce((a, b) => a + b, 0);
  caricati += lotto.length;
  console.log(`  ${caricati}/${media.length} file media`);
}

console.log(
  `"${fonte}" nello store privato: ${caricati} media, ${(byte / 1048576).toFixed(1)} MB.`,
);
