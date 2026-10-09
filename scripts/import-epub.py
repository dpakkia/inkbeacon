#!/usr/bin/env python3
"""Convert an EPUB into the ReadingCollection format used by the study platform.

Reads the spine from the OPF (reading order, not filenames), turns each document
into a unit, and copies the media it references. Works on a .epub file or on an
already-extracted directory.

    python3 scripts/import-epub.py <epub|dir> --id example \
        --title "How to study a text" \
        --author "Example author"
"""

from __future__ import annotations

import argparse
import html
import json
import posixpath
import re
import shutil
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

BLOCK_TAGS = {
    'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading',
    'p': 'paragraph', 'li': 'list', 'blockquote': 'quote', 'figcaption': 'caption',
}
SKIP_TAGS = {'style', 'script', 'noscript', 'svg', 'head'}
MEDIA_EXT = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'm4v', 'webm'}
# Textbooks number chapters in digits, in words or in Roman numerals: all are
# needed. Both English and Italian headings are recognised.
ORDINALS = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
    'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6,
    'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10, 'eleventh': 11,
    'twelfth': 12, 'thirteenth': 13, 'fourteenth': 14, 'fifteenth': 15,
    'sixteenth': 16, 'seventeenth': 17, 'eighteenth': 18, 'nineteenth': 19,
    'twentieth': 20,
    # Italian
    'primo': 1, 'secondo': 2, 'terzo': 3, 'quarto': 4, 'quinto': 5, 'sesto': 6,
    'settimo': 7, 'ottavo': 8, 'nono': 9, 'decimo': 10, 'undicesimo': 11,
    'dodicesimo': 12, 'tredicesimo': 13, 'quattordicesimo': 14, 'quindicesimo': 15,
    'sedicesimo': 16, 'diciassettesimo': 17, 'diciottesimo': 18, 'diciannovesimo': 19,
    'ventesimo': 20, 'ventunesimo': 21, 'ventiduesimo': 22, 'ventitreesimo': 23,
}
ROMAN = [('xx', 20), ('xix', 19), ('xviii', 18), ('xvii', 17), ('xvi', 16),
         ('xv', 15), ('xiv', 14), ('xiii', 13), ('xii', 12), ('xi', 11), ('x', 10),
         ('ix', 9), ('viii', 8), ('vii', 7), ('vi', 6), ('iv', 4), ('v', 5),
         ('iii', 3), ('ii', 2), ('i', 1)]
CHAPTER = re.compile(r'^\s*(?:chapter|capitolo)\s+([\w]+)\b[\s.:—-]*(.*)$', re.I)


def chapter_number(text: str) -> int | None:
    """Chapter number from 'Chapter 3', 'Chapter three', 'Chapter III'
    (or the Italian 'Capitolo 3', 'Capitolo terzo', 'Capitolo III')."""
    m = CHAPTER.match(text)
    if not m:
        return None
    token = m.group(1).lower()
    if token.isdigit():
        return int(token)
    if token in ORDINALS:
        return ORDINALS[token]
    for roman, value in ROMAN:
        if token == roman:
            return value
    return None


def clean(value: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(value).replace('\xa0', ' ')).strip()


class EpubSource:
    """Uniform access to a zipped epub or an extracted folder."""

    def __init__(self, path: Path):
        self.zip = zipfile.ZipFile(path) if path.is_file() else None
        self.dir = None if self.zip else path

    def read(self, rel: str) -> bytes:
        if self.zip:
            return self.zip.read(rel)
        return (self.dir / rel).read_bytes()

    def exists(self, rel: str) -> bool:
        try:
            self.read(rel)
            return True
        except (KeyError, OSError):
            return False


class Document(HTMLParser):
    """Extracts readable blocks and media references from an XHTML document."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self.media: list[str] = []          # raw srcs, resolved by the caller
        self.skip = 0
        self.tag: str | None = None
        self.kind: str | None = None
        self.depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        a = dict(attrs)
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if self.skip:
            return

        if tag in ('img', 'video', 'source'):
            src = a.get('src') or a.get('href')
            if src and not src.startswith(('data:', 'http://', 'https://')):
                self.media.append(src)
                self.blocks.append({
                    '_media': src,
                    'kind': 'video' if tag in ('video', 'source') else 'image',
                    'alt': clean(a.get('alt') or ''),
                })
            return

        if self.tag:
            self.depth += 1
            return
        if tag in BLOCK_TAGS:
            self.tag, self.kind, self.depth, self.parts = tag, BLOCK_TAGS[tag], 0, []
            if tag in ('h1', 'h2', 'h3', 'h4'):
                self.level = int(tag[1])

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in SKIP_TAGS and self.skip:
            self.skip -= 1
            return
        if self.skip or not self.tag:
            return
        if self.depth:
            self.depth -= 1
            return
        if tag != self.tag:
            return
        text = clean(''.join(self.parts))
        if text:
            b = {'kind': self.kind, 'text': text}
            if self.kind == 'heading':
                b['level'] = getattr(self, 'level', 2)
            self.blocks.append(b)
        self.tag = self.kind = None
        self.parts = []

    def handle_data(self, data):
        if not self.skip and self.tag:
            self.parts.append(data)


def read_spine(src: EpubSource) -> tuple[str, list[str]]:
    """Path of the OPF and the documents in reading order."""
    container = src.read('META-INF/container.xml').decode('utf-8', 'replace')
    opf_path = re.search(r'full-path="([^"]+)"', container).group(1)
    opf = src.read(opf_path).decode('utf-8', 'replace')

    hrefs = dict(re.findall(r'<item\b[^>]*?id="([^"]+)"[^>]*?href="([^"]+)"', opf))
    hrefs.update({i: h for h, i in
                  re.findall(r'<item\b[^>]*?href="([^"]+)"[^>]*?id="([^"]+)"', opf)})
    base = posixpath.dirname(opf_path)
    spine = [posixpath.join(base, hrefs[i])
             for i in re.findall(r'<itemref\b[^>]*?idref="([^"]+)"', opf) if i in hrefs]
    return opf_path, spine


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('source', type=Path)
    ap.add_argument('--id', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--author', default='')
    ap.add_argument('--out', type=Path,
                    default=Path(__file__).resolve().parents[1] / 'data-private')
    args = ap.parse_args()

    src = EpubSource(args.source)
    _, spine = read_spine(src)
    media_dir = args.out / 'media' / args.id
    media_dir.mkdir(parents=True, exist_ok=True)

    copied: dict[str, str] = {}           # path in the epub -> emitted file name
    units, chapter, section, label = [], 0, 0, 'Front matter'

    for rel in spine:
        try:
            text = src.read(rel).decode('utf-8', 'replace')
        except (KeyError, OSError):
            print(f'  ! missing document: {rel}', file=sys.stderr)
            continue

        doc = Document()
        doc.feed(text)
        blocks = doc.blocks

        # an h1 "Chapter N" opens a new chapter
        for b in blocks:
            if b.get('kind') == 'heading' and b.get('level') == 1:
                n = chapter_number(b.get('text', ''))
                if n is not None:
                    chapter, section = n, 0
                    label = f'Chapter {chapter}'
                break

        # unit title: first useful heading, otherwise <title>
        heading = ''
        for i, b in enumerate(blocks):
            if b.get('kind') == 'heading' and chapter_number(b.get('text', '')) is None:
                heading = blocks.pop(i)['text']
                break
        if not heading:
            m = re.search(r'<title[^>]*>(.*?)</title>', text, re.S)
            heading = clean(re.sub(r'<[^>]+>', '', m.group(1))) if m else rel

        unit_id = f'{args.id}-{chapter:02d}-{section}'

        # media resolution: path relative to the document -> copied file
        final = []
        for b in blocks:
            if '_media' not in b:
                final.append(b)
                continue
            target = posixpath.normpath(posixpath.join(
                posixpath.dirname(rel), re.split(r'[?#]', b['_media'])[0]))
            # hrefs may be URL-encoded ("pic%201.png" for "pic 1.png")
            if not src.exists(target) and src.exists(unquote(target)):
                target = unquote(target)
            ext = target.rsplit('.', 1)[-1].lower()
            if ext not in MEDIA_EXT or not src.exists(target):
                continue
            if target not in copied:
                name = f'{args.id}-{len(copied):04d}.{ext}'
                (media_dir / name).write_bytes(src.read(target))
                copied[target] = name
            block = {'kind': b['kind'],
                     'src': f'/api/books/{args.id}/media/{copied[target]}'}
            if b['kind'] == 'image':
                block['alt'] = b['alt'] or 'Image from the textbook'
            final.append(block)

        if not final:
            continue

        units.append({
            'id': unit_id,
            'chapter': chapter,
            'section': section,
            'location': 'Opening' if chapter == 0 else f'{chapter}.{section}',
            'chapterLabel': label,
            'heading': heading,
            'blocks': final,
        })
        section += 1

    # Some books never write "Chapter N": chapters are titled by topic and each
    # document in the spine is already a chapter of its own.
    if chapter == 0 and len(units) > 1:
        for n, u in enumerate(units, 1):
            u['chapter'] = n
            u['section'] = 0
            u['location'] = f'{n}'
            u['chapterLabel'] = u['heading']
        chapter = len(units)
        print('  (no explicit numbering: one chapter per document)')

    book = {
        'version': 1,
        'title': args.title,
        'author': args.author,
        'chapterCount': chapter,
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

    print(f'{args.id}: {len(units)} units, {chapter} chapters')
    print(f'  blocks: {", ".join(f"{k}={v}" for k, v in sorted(kinds.items()))}')
    print(f'  media: {len(copied)} files, {size:.1f} MB -> {media_dir}')
    print(f'  json: {out.stat().st_size / 1048576:.1f} MB -> {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
