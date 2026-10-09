/**
 * EPUB -> reading format, in the browser. A port of `scripts/import-epub.py`:
 * the spine gives the reading order, each document becomes a unit, an h1
 * "Chapter N" opens a new chapter, and referenced media are copied once.
 */

import { unzipSync } from 'fflate';

import {
  chapterNumber,
  decodeText,
  dirname,
  documentTitle,
  extractBlocks,
  findEntry,
  joinPath,
  MediaCollector,
  type ImportResult,
  type RawBlock,
} from '@/lib/import/common';
import type { ReadingBlock, ReadingUnit } from '@/lib/reading-format';

export type EpubMetadata = { title: string; author: string };

function readArchive(data: Uint8Array) {
  try {
    return new Map(Object.entries(unzipSync(data)));
  } catch {
    throw new Error('This file is not a valid EPUB (it is not a zip archive).');
  }
}

function parseXml(text: string) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

/** Elements by local name, with or without a namespace or prefix (dc:title). */
function byLocalName(doc: Document, name: string) {
  return Array.from(doc.getElementsByTagName('*')).filter(
    (element) =>
      (element.localName ?? element.nodeName).split(':').pop() === name,
  );
}

function readPackage(files: Map<string, Uint8Array>) {
  const container = files.get('META-INF/container.xml');
  if (!container) throw new Error('This EPUB has no META-INF/container.xml.');
  const rootfile = byLocalName(parseXml(decodeText(container)), 'rootfile')[0];
  const opfPath = rootfile?.getAttribute('full-path');
  const opfEntry = opfPath ? findEntry(files, opfPath) : null;
  if (!opfEntry) throw new Error('This EPUB has no package (.opf) file.');

  const opf = parseXml(decodeText(files.get(opfEntry)!));
  const base = dirname(opfEntry);
  const hrefs = new Map(
    byLocalName(opf, 'item').map((item) => [
      item.getAttribute('id') ?? '',
      item.getAttribute('href') ?? '',
    ]),
  );
  const spine = byLocalName(opf, 'itemref')
    .map((ref) => hrefs.get(ref.getAttribute('idref') ?? ''))
    .filter((href): href is string => Boolean(href))
    .map((href) => joinPath(base, href));

  const text = (name: string) =>
    byLocalName(opf, name)[0]?.textContent?.trim() ?? '';
  return { spine, metadata: { title: text('title'), author: text('creator') } };
}

/** Title and author from the EPUB's own metadata, to prefill the form. */
export function readEpubMetadata(data: Uint8Array): EpubMetadata {
  return readPackage(readArchive(data)).metadata;
}

export function importEpub(
  data: Uint8Array,
  options: { id: string; title: string; author: string },
): ImportResult {
  const files = readArchive(data);
  const { spine } = readPackage(files);
  const media = new MediaCollector(options.id, files);

  const units: ReadingUnit[] = [];
  let chapter = 0;
  let section = 0;
  let label = 'Front matter';

  for (const rel of spine) {
    const entry = findEntry(files, rel);
    if (!entry) continue;
    const html = decodeText(files.get(entry)!);
    const blocks: RawBlock[] = extractBlocks(html);

    // an h1 "Chapter N" opens a new chapter
    const firstH1 = blocks.find((b) => b.kind === 'heading' && b.level === 1);
    if (firstH1) {
      const n = chapterNumber(firstH1.text ?? '');
      if (n !== null) {
        chapter = n;
        section = 0;
        label = `Chapter ${chapter}`;
      }
    }

    // unit title: first useful heading, otherwise <title>
    let heading = '';
    const headingIndex = blocks.findIndex(
      (b) => b.kind === 'heading' && chapterNumber(b.text ?? '') === null,
    );
    if (headingIndex >= 0) {
      heading = blocks[headingIndex].text ?? '';
      blocks.splice(headingIndex, 1);
    }
    if (!heading) heading = documentTitle(html) || rel;

    const final: ReadingBlock[] = [];
    for (const block of blocks) {
      if (!block.media) {
        final.push(block);
        continue;
      }
      const resolved = media.resolve(
        block,
        joinPath(dirname(entry), block.media),
      );
      if (resolved) final.push(resolved);
    }
    if (!final.length) continue;

    units.push({
      id: `${options.id}-${String(chapter).padStart(2, '0')}-${section}`,
      chapter,
      section,
      location: chapter === 0 ? 'Opening' : `${chapter}.${section}`,
      chapterLabel: label,
      heading,
      blocks: final,
    });
    section += 1;
  }

  // Some books never write "Chapter N": chapters are titled by topic and each
  // document in the spine is already a chapter of its own.
  if (chapter === 0 && units.length > 1) {
    units.forEach((unit, index) => {
      unit.chapter = index + 1;
      unit.section = 0;
      unit.location = String(index + 1);
      unit.chapterLabel = unit.heading;
    });
    chapter = units.length;
  }
  if (!units.length)
    throw new Error('No readable text was found in this EPUB.');

  return {
    book: {
      version: 1,
      title: options.title,
      author: options.author,
      chapterCount: chapter,
      unitCount: units.length,
      units,
    },
    media: media.files,
  };
}
