#!/usr/bin/env python3
"""Convert a single-file HTML export (Calibre style) into the reading format.

Some books arrive as a single index.html with everything inside, instead of an
epub with a spine. Here the units are derived from the section <div>s.

    python3 scripts/import-single-html.py <folder> --id example \
        --title "..." --author "..." [--split 'div class="calibre"']
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import posixpath
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# reuse the epub importer's block parser instead of rewriting it
spec = importlib.util.spec_from_file_location('epub_import', HERE / 'import-epub.py')
epub = importlib.util.module_from_spec(spec)
sys.modules['epub_import'] = epub
spec.loader.exec_module(epub)

PARTS = {'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8}
# English and Italian headings: "Part II" / "Parte II"
RE_PART = re.compile(r'^\s*(?:part|parte)\s+([ivx]+)\b', re.I)
RE_CHAPTER = re.compile(r'^\s*(\d+)\s+(\S.*)$')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('folder', type=Path)
    ap.add_argument('--id', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--author', default='')
    ap.add_argument('--file', default='index.html')
    ap.add_argument('--split', default='div class="calibre"',
                    help='opening of the tag that separates the sections')
    ap.add_argument('--out', type=Path, default=HERE.parent / 'data-private')
    args = ap.parse_args()

    source = args.folder / args.file
    text = source.read_text(encoding='utf-8', errors='replace')

    cuts = [m.start() for m in re.finditer(r'<' + re.escape(args.split) + r'[^>]*>', text)]
    if not cuts:
        print(f'No section with <{args.split}>.', file=sys.stderr)
        return 1
    cuts.append(len(text))

    # The book's index says which entries come after the last part: without
    # this, afterword and bibliography inherit the last part's label.
    entries = [(m.start(), m.group(1), epub.clean(re.sub(r'<[^>]+>', ' ', m.group(2))))
               for m in re.finditer(r'<p class="(index-[^"]*)"[^>]*>(.*?)</p>', text, re.S)]
    last_part = max((p for p, c, _ in entries if c == 'index-pt'), default=None)
    closing = {
        t.split(',')[0].strip().lower()
        for p, c, t in entries
        if last_part is not None and p > last_part and t
    }

    media_dir = args.out / 'media' / args.id
    media_dir.mkdir(parents=True, exist_ok=True)
    copied: dict[str, str] = {}

    units, part, section = [], 0, 0
    label = 'Front matter'

    for i in range(len(cuts) - 1):
        piece = text[cuts[i]:cuts[i + 1]]
        doc = epub.Document()
        doc.feed(piece)
        blocks = doc.blocks
        if not blocks:
            continue

        # the section title is the first text in the block
        first = next((b for b in blocks if b.get('text')), None)
        heading = first['text'] if first else f'Section {i}'

        # an index entry after the last part opens the back matter
        if closing and heading.split(',')[0].strip().lower() in closing:
            if label != 'Back matter':
                part += 1
                section = 0
                label = 'Back matter'

        m_part = RE_PART.match(heading)
        if m_part:
            part = PARTS.get(m_part.group(1).lower(), part + 1)
            section = 0
            label = f'Part {m_part.group(1).upper()}'
        # chapters inside a part start with their number
        m_chapter = RE_CHAPTER.match(heading)
        if m_chapter and part:
            heading = m_chapter.group(2)

        if first:
            blocks.remove(first)

        final = []
        for b in blocks:
            if '_media' not in b:
                final.append(b)
                continue
            rel = posixpath.normpath(b['_media'])
            source_file = args.folder / rel
            ext = rel.rsplit('.', 1)[-1].lower()
            if ext not in epub.MEDIA_EXT or not source_file.exists():
                continue
            if rel not in copied:
                name = f'{args.id}-{len(copied):04d}.{ext}'
                shutil.copy2(source_file, media_dir / name)
                copied[rel] = name
            block = {'kind': b['kind'],
                     'src': f'/api/books/{args.id}/media/{copied[rel]}'}
            if b['kind'] == 'image':
                block['alt'] = b['alt'] or 'Image from the textbook'
            final.append(block)

        if not final:
            continue

        units.append({
            'id': f'{args.id}-{part:02d}-{section}',
            'chapter': part,
            'section': section,
            'location': 'Opening' if part == 0 else f'{part}.{section}',
            'chapterLabel': label,
            'heading': heading,
            'blocks': final,
        })
        section += 1

    book = {
        'version': 1,
        'title': args.title,
        'author': args.author,
        'chapterCount': part,
        'unitCount': len(units),
        'units': units,
    }
    out = args.out / 'books' / f'{args.id}.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(book, ensure_ascii=False), encoding='utf-8')

    kinds: dict[str, int] = {}
    for u in units:
        for b in u['blocks']:
            kinds[b['kind']] = kinds.get(b['kind'], 0) + 1
    size = sum(f.stat().st_size for f in media_dir.iterdir()) / 1048576

    print(f'{args.id}: {len(units)} units, {part} parts')
    print(f'  blocks: {", ".join(f"{k}={v}" for k, v in sorted(kinds.items()))}')
    print(f'  media: {len(copied)} files, {size:.1f} MB')
    print(f'  json: {out.stat().st_size / 1048576:.1f} MB -> {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
