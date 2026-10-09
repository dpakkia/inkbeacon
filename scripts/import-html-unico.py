#!/usr/bin/env python3
"""Converte un export HTML monolitico (stile Calibre) nel formato di lettura.

Alcuni libri arrivano come un solo index.html con tutto dentro, invece che
come epub con uno spine. Qui le unita' si ricavano dai <div> di sezione.

    python3 scripts/import-html-unico.py <cartella> --id esempio \
        --title "..." --author "..." [--taglio 'div class="calibre"']
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

QUI = Path(__file__).resolve().parent

# riusa il parser di blocchi dell'importer epub invece di riscriverlo
spec = importlib.util.spec_from_file_location('epub_import', QUI / 'import-epub.py')
epub = importlib.util.module_from_spec(spec)
sys.modules['epub_import'] = epub
spec.loader.exec_module(epub)

PARTI = {'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8}
RE_PARTE = re.compile(r'^\s*parte\s+([ivx]+)\b', re.I)
RE_CAPITOLO = re.compile(r'^\s*(\d+)\s+(\S.*)$')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('cartella', type=Path)
    ap.add_argument('--id', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--author', default='')
    ap.add_argument('--file', default='index.html')
    ap.add_argument('--taglio', default='div class="calibre"',
                    help='apertura del tag che separa le sezioni')
    ap.add_argument('--out', type=Path, default=QUI.parent / 'data-private')
    args = ap.parse_args()

    sorgente = args.cartella / args.file
    testo = sorgente.read_text(encoding='utf-8', errors='replace')

    tagli = [m.start() for m in re.finditer(r'<' + re.escape(args.taglio) + r'[^>]*>', testo)]
    if not tagli:
        print(f'Nessuna sezione con <{args.taglio}>.', file=sys.stderr)
        return 1
    tagli.append(len(testo))

    # L'indice del libro dice quali voci vengono dopo l'ultima parte: senza
    # questo, postfazione e bibliografia ereditano l'etichetta dell'ultima parte.
    voci = [(m.start(), m.group(1), epub.clean(re.sub(r'<[^>]+>', ' ', m.group(2))))
            for m in re.finditer(r'<p class="(index-[^"]*)"[^>]*>(.*?)</p>', testo, re.S)]
    ultima_parte = max((p for p, c, _ in voci if c == 'index-pt'), default=None)
    chiusura = {
        t.split(',')[0].strip().lower()
        for p, c, t in voci
        if ultima_parte is not None and p > ultima_parte and t
    }

    media_dir = args.out / 'media' / args.id
    media_dir.mkdir(parents=True, exist_ok=True)
    copiati: dict[str, str] = {}

    units, parte, sezione = [], 0, 0
    etichetta = 'Materiali introduttivi'

    for i in range(len(tagli) - 1):
        pezzo = testo[tagli[i]:tagli[i + 1]]
        doc = epub.Documento()
        doc.feed(pezzo)
        blocks = doc.blocks
        if not blocks:
            continue

        # il titolo della sezione e' il primo testo del blocco
        primo = next((b for b in blocks if b.get('text')), None)
        heading = primo['text'] if primo else f'Sezione {i}'

        # una voce dell'indice successiva all'ultima parte apre i materiali finali
        if chiusura and heading.split(',')[0].strip().lower() in chiusura:
            if etichetta != 'Materiali finali':
                parte += 1
                sezione = 0
                etichetta = 'Materiali finali'

        m_parte = RE_PARTE.match(heading)
        if m_parte:
            parte = PARTI.get(m_parte.group(1).lower(), parte + 1)
            sezione = 0
            etichetta = f'Parte {m_parte.group(1).upper()}'
        # i capitoli dentro una parte iniziano con il loro numero
        m_cap = RE_CAPITOLO.match(heading)
        if m_cap and parte:
            heading = m_cap.group(2)

        if primo:
            blocks.remove(primo)

        finali = []
        for b in blocks:
            if '_media' not in b:
                finali.append(b)
                continue
            rel = posixpath.normpath(b['_media'])
            fonte_file = args.cartella / rel
            ext = rel.rsplit('.', 1)[-1].lower()
            if ext not in epub.MEDIA_EXT or not fonte_file.exists():
                continue
            if rel not in copiati:
                nome = f'{args.id}-{len(copiati):04d}.{ext}'
                shutil.copy2(fonte_file, media_dir / nome)
                copiati[rel] = nome
            blocco = {'kind': b['kind'],
                      'src': f'/api/books/{args.id}/media/{copiati[rel]}'}
            if b['kind'] == 'image':
                blocco['alt'] = b['alt'] or 'Immagine dal manuale'
            finali.append(blocco)

        if not finali:
            continue

        units.append({
            'id': f'{args.id}-{parte:02d}-{sezione}',
            'chapter': parte,
            'section': sezione,
            'location': 'Apertura' if parte == 0 else f'{parte}.{sezione}',
            'chapterLabel': etichetta,
            'heading': heading,
            'blocks': finali,
        })
        sezione += 1

    libro = {
        'version': 1,
        'title': args.title,
        'author': args.author,
        'chapterCount': parte,
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

    print(f'{args.id}: {len(units)} unita\', {parte} parti')
    print(f'  blocchi: {", ".join(f"{k}={v}" for k, v in sorted(tipi.items()))}')
    print(f'  media: {len(copiati)} file, {peso:.1f} MB')
    print(f'  json: {out.stat().st_size / 1048576:.1f} MB -> {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
