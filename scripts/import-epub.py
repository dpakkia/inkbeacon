#!/usr/bin/env python3
"""Convert an EPUB into the ReadingCollection format used by the study platform.

Reads the spine from the OPF (reading order, not filenames), turns each document
into a unit, and copies the media it references. Works on a .epub file or on an
already-extracted directory.

    python3 scripts/import-epub.py <epub|dir> --id esempio \
        --title "Come si studia un testo" \
        --author "Autore di esempio"
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

BLOCK_TAGS = {
    'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading',
    'p': 'paragraph', 'li': 'list', 'blockquote': 'quote', 'figcaption': 'caption',
}
SKIP_TAGS = {'style', 'script', 'noscript', 'svg', 'head'}
MEDIA_EXT = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'm4v', 'webm'}
# I manuali numerano i capitoli in cifre, in lettere o in romano: servono tutti.
ORDINALI = {
    'primo': 1, 'secondo': 2, 'terzo': 3, 'quarto': 4, 'quinto': 5, 'sesto': 6,
    'settimo': 7, 'ottavo': 8, 'nono': 9, 'decimo': 10, 'undicesimo': 11,
    'dodicesimo': 12, 'tredicesimo': 13, 'quattordicesimo': 14, 'quindicesimo': 15,
    'sedicesimo': 16, 'diciassettesimo': 17, 'diciottesimo': 18, 'diciannovesimo': 19,
    'ventesimo': 20, 'ventunesimo': 21, 'ventiduesimo': 22, 'ventitreesimo': 23,
}
ROMANI = [('xx', 20), ('xix', 19), ('xviii', 18), ('xvii', 17), ('xvi', 16),
          ('xv', 15), ('xiv', 14), ('xiii', 13), ('xii', 12), ('xi', 11), ('x', 10),
          ('ix', 9), ('viii', 8), ('vii', 7), ('vi', 6), ('iv', 4), ('v', 5),
          ('iii', 3), ('ii', 2), ('i', 1)]
CAPITOLO = re.compile(r'^\s*capitolo\s+([\w]+)\b[\s.:—-]*(.*)$', re.I)


def numero_capitolo(testo: str) -> int | None:
    """Numero del capitolo da 'Capitolo 3', 'Capitolo terzo', 'Capitolo III'."""
    m = CAPITOLO.match(testo)
    if not m:
        return None
    token = m.group(1).lower()
    if token.isdigit():
        return int(token)
    if token in ORDINALI:
        return ORDINALI[token]
    for romano, valore in ROMANI:
        if token == romano:
            return valore
    return None


def clean(value: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(value).replace('\xa0', ' ')).strip()


class Sorgente:
    """Accesso uniforme a un epub zippato o a una cartella estratta."""

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


class Documento(HTMLParser):
    """Estrae blocchi leggibili e riferimenti multimediali da un documento XHTML."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self.media: list[str] = []          # src grezzi, risolti dal chiamante
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


def leggi_spine(src: Sorgente) -> tuple[str, list[str]]:
    """Percorso dell'OPF e documenti nell'ordine di lettura."""
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
    ap.add_argument('sorgente', type=Path)
    ap.add_argument('--id', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--author', default='')
    ap.add_argument('--out', type=Path,
                    default=Path(__file__).resolve().parents[1] / 'data-private')
    args = ap.parse_args()

    src = Sorgente(args.sorgente)
    _, spine = leggi_spine(src)
    media_dir = args.out / 'media' / args.id
    media_dir.mkdir(parents=True, exist_ok=True)

    copiati: dict[str, str] = {}          # percorso nell'epub -> nome file emesso
    units, capitolo, sezione, etichetta = [], 0, 0, 'Materiali introduttivi'

    for rel in spine:
        try:
            testo = src.read(rel).decode('utf-8', 'replace')
        except (KeyError, OSError):
            print(f'  ! documento assente: {rel}', file=sys.stderr)
            continue

        doc = Documento()
        doc.feed(testo)
        blocks = doc.blocks

        # un h1 "Capitolo N" apre un capitolo nuovo
        for b in blocks:
            if b.get('kind') == 'heading' and b.get('level') == 1:
                n = numero_capitolo(b.get('text', ''))
                if n is not None:
                    capitolo, sezione = n, 0
                    etichetta = f'Capitolo {capitolo}'
                break

        # titolo dell'unita': primo heading utile, altrimenti <title>
        heading = ''
        for i, b in enumerate(blocks):
            if b.get('kind') == 'heading' and numero_capitolo(b.get('text', '')) is None:
                heading = blocks.pop(i)['text']
                break
        if not heading:
            m = re.search(r'<title[^>]*>(.*?)</title>', testo, re.S)
            heading = clean(re.sub(r'<[^>]+>', '', m.group(1))) if m else rel

        unit_id = f'{args.id}-{capitolo:02d}-{sezione}'

        # risoluzione dei media: percorso relativo al documento -> file copiato
        finali = []
        for b in blocks:
            if '_media' not in b:
                finali.append(b)
                continue
            target = posixpath.normpath(posixpath.join(posixpath.dirname(rel), b['_media']))
            ext = target.rsplit('.', 1)[-1].lower()
            if ext not in MEDIA_EXT or not src.exists(target):
                continue
            if target not in copiati:
                nome = f'{args.id}-{len(copiati):04d}.{ext}'
                (media_dir / nome).write_bytes(src.read(target))
                copiati[target] = nome
            blocco = {'kind': b['kind'],
                      'src': f'/api/books/{args.id}/media/{copiati[target]}'}
            if b['kind'] == 'image':
                blocco['alt'] = b['alt'] or 'Immagine dal manuale'
            finali.append(blocco)

        if not finali:
            continue

        units.append({
            'id': unit_id,
            'chapter': capitolo,
            'section': sezione,
            'location': 'Apertura' if capitolo == 0 else f'{capitolo}.{sezione}',
            'chapterLabel': etichetta,
            'heading': heading,
            'blocks': finali,
        })
        sezione += 1

    # Alcuni volumi non scrivono mai "Capitolo N": i capitoli sono titolati per
    # argomento e ogni documento dello spine e' gia' un capitolo a se'.
    if capitolo == 0 and len(units) > 1:
        for n, u in enumerate(units, 1):
            u['chapter'] = n
            u['section'] = 0
            u['location'] = f'{n}'
            u['chapterLabel'] = u['heading']
        capitolo = len(units)
        print('  (nessuna numerazione esplicita: un capitolo per documento)')

    libro = {
        'version': 1,
        'title': args.title,
        'author': args.author,
        'chapterCount': capitolo,
        'unitCount': len(units),
        'units': units,
    }
    out = args.out / 'books' / f'{args.id}.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(libro, ensure_ascii=False), encoding='utf-8')

    tipi: dict[str, int] = {}
    for u in units:
        for b in u['blocks']:
            tipi[b['kind']] = tipi.get(b['kind'], 0) + 1
    peso = sum(f.stat().st_size for f in media_dir.iterdir()) / 1048576

    print(f'{args.id}: {len(units)} unita\', {capitolo} capitoli')
    print(f'  blocchi: {", ".join(f"{k}={v}" for k, v in sorted(tipi.items()))}')
    print(f'  media: {len(copiati)} file, {peso:.1f} MB -> {media_dir}')
    print(f'  json: {out.stat().st_size / 1048576:.1f} MB -> {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
