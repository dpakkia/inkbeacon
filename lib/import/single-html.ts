/**
 * Single-file HTML export (Calibre style) -> reading format, in the browser.
 * A port of `scripts/import-single-html.py`: the book is one HTML file, split
 * into sections at a marker tag; "Part II" headings start a new part.
 * Accepts the .html file alone, or a .zip of its folder to include images.
 */

import { unzipSync } from 'fflate';

import {
  clean,
  decodeText,
  dirname,
  extractBlocks,
  joinPath,
  MediaCollector,
  type ImportResult,
} from '@/lib/import/common';
import type { ReadingBlock, ReadingUnit } from '@/lib/reading-format';

export const DEFAULT_SPLIT = 'div class="calibre"';

const PARTS: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
};
// English and Italian headings: "Part II" / "Parte II"
const RE_PART = /^\s*(?:part|parte)\s+([ivx]+)\b/i;
const RE_CHAPTER = /^\s*(\d+)\s+(\S.*)$/;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The HTML file and the files next to it, from a lone .html or a .zip. */
export function readHtmlSource(fileName: string, data: Uint8Array) {
  if (!/\.zip$/i.test(fileName)) {
    return { htmlPath: fileName, files: new Map([[fileName, data]]) };
  }
  let files: Map<string, Uint8Array>;
  try {
    files = new Map(Object.entries(unzipSync(data)));
  } catch {
    throw new Error('This file is not a valid zip archive.');
  }
  const pages = [...files.keys()].filter(
    (path) => /\.x?html?$/i.test(path) && !path.startsWith('__MACOSX/'),
  );
  const index = pages
    .filter((path) => /(^|\/)index\.x?html?$/i.test(path))
    .sort((a, b) => a.length - b.length)[0];
  const htmlPath = index ?? (pages.length === 1 ? pages[0] : null);
  if (!htmlPath) {
    throw new Error(
      'The zip must contain an index.html (or exactly one HTML file).',
    );
  }
  return { htmlPath, files };
}

export function importSingleHtml(
  source: { htmlPath: string; files: Map<string, Uint8Array> },
  options: { id: string; title: string; author: string; split?: string },
): ImportResult {
  const split = options.split?.trim() || DEFAULT_SPLIT;
  const text = decodeText(source.files.get(source.htmlPath)!);
  const base = dirname(source.htmlPath);

  const cuts = [
    ...text.matchAll(new RegExp(`<${escapeRegExp(split)}[^>]*>`, 'g')),
  ].map((match) => match.index);
  if (!cuts.length) throw new Error(`No section starts with <${split}>.`);
  cuts.push(text.length);

  // The book's index says which entries come after the last part: without
  // this, afterword and bibliography inherit the last part's label.
  const entries = [
    ...text.matchAll(/<p class="(index-[^"]*)"[^>]*>([\s\S]*?)<\/p>/g),
  ].map((m) => ({
    at: m.index,
    cls: m[1],
    text: clean(m[2].replace(/<[^>]+>/g, ' ')),
  }));
  const parts = entries.filter((e) => e.cls === 'index-pt').map((e) => e.at);
  const lastPart = parts.length ? Math.max(...parts) : null;
  const closing = new Set(
    entries
      .filter((e) => lastPart !== null && e.at > lastPart && e.text)
      .map((e) => e.text.split(',')[0].trim().toLowerCase()),
  );

  const media = new MediaCollector(options.id, source.files);
  const units: ReadingUnit[] = [];
  let part = 0;
  let section = 0;
  let label = 'Front matter';

  for (let i = 0; i < cuts.length - 1; i += 1) {
    const blocks = extractBlocks(text.slice(cuts[i], cuts[i + 1]));
    if (!blocks.length) continue;

    // the section title is the first text in the block
    const first = blocks.find((b) => b.text);
    let heading = first?.text ?? `Section ${i}`;

    // an index entry after the last part opens the back matter
    if (
      closing.size &&
      closing.has(heading.split(',')[0].trim().toLowerCase()) &&
      label !== 'Back matter'
    ) {
      part += 1;
      section = 0;
      label = 'Back matter';
    }

    const partMatch = RE_PART.exec(heading);
    if (partMatch) {
      part = PARTS[partMatch[1].toLowerCase()] ?? part + 1;
      section = 0;
      label = `Part ${partMatch[1].toUpperCase()}`;
    }
    // chapters inside a part start with their number
    const chapterMatch = RE_CHAPTER.exec(heading);
    if (chapterMatch && part) heading = chapterMatch[2];

    if (first) blocks.splice(blocks.indexOf(first), 1);

    const final: ReadingBlock[] = [];
    for (const block of blocks) {
      if (!block.media) {
        final.push(block);
        continue;
      }
      const resolved = media.resolve(block, joinPath(base, block.media));
      if (resolved) final.push(resolved);
    }
    if (!final.length) continue;

    units.push({
      id: `${options.id}-${String(part).padStart(2, '0')}-${section}`,
      chapter: part,
      section,
      location: part === 0 ? 'Opening' : `${part}.${section}`,
      chapterLabel: label,
      heading,
      blocks: final,
    });
    section += 1;
  }
  if (!units.length)
    throw new Error('No readable text was found in this file.');

  return {
    book: {
      version: 1,
      title: options.title,
      author: options.author,
      chapterCount: part,
      unitCount: units.length,
      units,
    },
    media: media.files,
  };
}
