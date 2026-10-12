/**
 * Shared pieces of the in-browser importers: a port of the block parser in
 * `scripts/import-epub.py`, chapter-number parsing and path helpers.
 * Browser only: it relies on `DOMParser`.
 */

import type { ReadingBlock, ReadingCollection } from '@/lib/reading-format';

/** A block before its media is resolved: `media` holds the raw src. */
export type RawBlock = ReadingBlock & { media?: string };

export type MediaFile = { name: string; data: Uint8Array; contentType: string };

export type ImportResult = {
  book: ReadingCollection;
  media: MediaFile[];
  /** Media references left out: remote, missing, or of an unknown type. */
  missing: number;
};

const BLOCK_TAGS: Record<string, ReadingBlock['kind']> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  p: 'paragraph',
  li: 'list',
  blockquote: 'quote',
  figcaption: 'caption',
};
const SKIP_TAGS = new Set(['style', 'script', 'noscript', 'svg', 'head']);
const MEDIA_TAGS = new Set(['img', 'video', 'source']);

export const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
};

export const DEFAULT_IMAGE_ALT = 'Image from the textbook';

export function clean(value: string) {
  return value.replace(/[\s ]+/g, ' ').trim();
}

/**
 * Readable blocks and media references of an HTML document, in order.
 * Like the Python parser: the outermost block tag owns all the text inside
 * it, text outside block tags is ignored, and media found inside a block
 * comes before that block.
 */
export function extractBlocks(html: string): RawBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: RawBlock[] = [];

  const visit = (node: Node, parts: string[] | null) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (parts) parts.push(child.textContent ?? '');
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      const tag = element.localName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;

      if (MEDIA_TAGS.has(tag)) {
        const src = element.getAttribute('src') ?? element.getAttribute('href');
        // remote ones too: the collector counts what it can't resolve
        if (src) {
          out.push({
            kind: tag === 'img' ? 'image' : 'video',
            media: src,
            alt: clean(element.getAttribute('alt') ?? ''),
          });
        }
        // a <video> can hold <source> children
        visit(element, parts);
        continue;
      }

      if (parts) {
        visit(element, parts);
        continue;
      }
      const kind = BLOCK_TAGS[tag];
      if (!kind) {
        visit(element, null);
        continue;
      }
      const own: string[] = [];
      visit(element, own);
      const text = clean(own.join(''));
      if (text) {
        const block: RawBlock = { kind, text };
        if (kind === 'heading') block.level = Number(tag[1]);
        out.push(block);
      }
    }
  };

  visit(doc.documentElement, null);
  return out;
}

/** The text of the document's <title>, if any. */
export function documentTitle(html: string) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? clean(match[1].replace(/<[^>]+>/g, '')) : '';
}

// Textbooks number chapters in digits, in words or in Roman numerals.
// English and Italian headings are both recognised.
const ORDINALS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  // Italian
  primo: 1,
  secondo: 2,
  terzo: 3,
  quarto: 4,
  quinto: 5,
  sesto: 6,
  settimo: 7,
  ottavo: 8,
  nono: 9,
  decimo: 10,
  undicesimo: 11,
  dodicesimo: 12,
  tredicesimo: 13,
  quattordicesimo: 14,
  quindicesimo: 15,
  sedicesimo: 16,
  diciassettesimo: 17,
  diciottesimo: 18,
  diciannovesimo: 19,
  ventesimo: 20,
  ventunesimo: 21,
  ventiduesimo: 22,
  ventitreesimo: 23,
};
const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
  xvi: 16,
  xvii: 17,
  xviii: 18,
  xix: 19,
  xx: 20,
};
const CHAPTER =
  /^\s*(?:chapter|capitolo)\s+([\p{L}\p{N}_]+)(?![\p{L}\p{N}_])/iu;

/** Chapter number from 'Chapter 3', 'Chapter three', 'Capitolo III'… */
export function chapterNumber(text: string): number | null {
  const match = CHAPTER.exec(text);
  if (!match) return null;
  const token = match[1].toLowerCase();
  if (/^\d+$/.test(token)) return Number(token);
  return ORDINALS[token] ?? ROMAN[token] ?? null;
}

/** POSIX-style path helpers for paths inside an archive. */
export function dirname(path: string) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

export function normalizePath(path: string) {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function joinPath(base: string, relative: string) {
  return normalizePath(base ? `${base}/${relative}` : relative);
}

/** The archive entry for a reference, trying it as written and URL-decoded. */
export function findEntry(files: Map<string, Uint8Array>, path: string) {
  const bare = path.split(/[?#]/)[0];
  if (files.has(bare)) return bare;
  try {
    const decoded = decodeURIComponent(bare);
    if (files.has(decoded)) return decoded;
  } catch {
    // malformed escape: keep the path as written
  }
  return null;
}

/** Extension, type and bytes of a `data:` URI image or video, or null. */
export function decodeDataUri(uri: string) {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(uri);
  const contentType = match?.[1].toLowerCase() ?? '';
  // the first extension listed for the type (jpg, mp4)
  const ext = Object.keys(MEDIA_TYPES).find(
    (key) => MEDIA_TYPES[key] === contentType,
  );
  if (!match || !ext) return null;
  try {
    const data = /;base64$/i.test(match[2])
      ? Uint8Array.from(atob(match[3].replace(/\s+/g, '')), (c) =>
          c.charCodeAt(0),
        )
      : new TextEncoder().encode(decodeURIComponent(match[3]));
    return { ext, contentType, data };
  } catch {
    return null;
  }
}

/**
 * Copies referenced media once each and rewrites blocks to point at the
 * served path, `/api/books/<id>/media/<id>-0000.<ext>`. Media embedded in
 * the page (`data:` URIs) become files too; anything else that can't be
 * found is counted in `missing`.
 */
export class MediaCollector {
  readonly files: MediaFile[] = [];
  missing = 0;
  private readonly byPath = new Map<string, string>();

  constructor(
    private readonly bookId: string,
    private readonly archive: Map<string, Uint8Array>,
  ) {}

  /** `base` is the folder of the document the block comes from. */
  resolve(block: RawBlock, base: string): ReadingBlock | null {
    const raw = block.media ?? '';
    const key = raw.startsWith('data:')
      ? raw
      : findEntry(this.archive, joinPath(base, raw));
    let name = key ? this.byPath.get(key) : undefined;
    if (!name) {
      const file = key ? this.load(key) : null;
      if (!file) {
        this.missing += 1;
        return null;
      }
      name = `${this.bookId}-${String(this.files.length).padStart(4, '0')}.${file.ext}`;
      this.files.push({ name, data: file.data, contentType: file.contentType });
      this.byPath.set(key!, name);
    }
    const resolved: ReadingBlock = {
      kind: block.kind,
      src: `/api/books/${this.bookId}/media/${name}`,
    };
    if (block.kind === 'image') resolved.alt = block.alt || DEFAULT_IMAGE_ALT;
    return resolved;
  }

  private load(key: string) {
    if (key.startsWith('data:')) return decodeDataUri(key);
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    if (!MEDIA_TYPES[ext]) return null;
    return {
      ext,
      contentType: MEDIA_TYPES[ext],
      data: this.archive.get(key)!,
    };
  }
}

export function decodeText(data: Uint8Array) {
  return new TextDecoder('utf-8').decode(data);
}
