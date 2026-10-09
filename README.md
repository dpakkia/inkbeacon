# Studio — piattaforma di lettura personalizzata

Uno spazio per studiare i propri testi: si legge capitolo per capitolo, si
evidenziano le frasi, si costruisce uno schema Mermaid per ogni capitolo e si
segna l'avanzamento di ogni corso. Lo stato di studio si sincronizza su un
archivio privato, protetto da una chiave personale.

Costruita con Next.js, Tailwind e Vercel Blob.

## Come funziona

- **Corsi e fonti** sono elencati in `lib/corsi.ts`. È l'unico file da toccare
  per aggiungere un corso o un libro.
- **I libri** non stanno nel repository: si convertono in JSON in locale e si
  caricano su un Vercel Blob store privato. L'app li scarica solo dopo che hai
  inserito la chiave.
- **Lo studio** (evidenziazioni, schemi, avanzamento) si salva nello stesso
  store, in `studio/state.json`.
- **`GET /api/progresso`** restituisce le percentuali per corso, con
  `Authorization: Bearer <STUDIO_ACCESS_KEY>`. Serve a mostrarle altrove (per
  esempio su un display).

## Avvio

Serve Node.js 22.13 o successivo.

```bash
npm install
cp .env.example .env.local   # poi scegli una chiave lunga e casuale
npm run dev
```

Per sincronizzare e leggere i libri serve un Blob store privato: crealo dal
pannello di Vercel, collegalo al progetto e scarica le variabili con
`vercel env pull .env.local`. Aggiungi `STUDIO_ACCESS_KEY` anche alle variabili
del progetto su Vercel.

## Aggiungere un libro

1. Aggiungi la fonte in `lib/corsi.ts`, con un `id` breve (per esempio
   `esempio`).
2. Converti il libro nel formato di lettura, dentro `data-private/` (che è
   ignorata da git):

   ```bash
   # da un EPUB
   python3 scripts/import-epub.py libro.epub --id esempio \
       --title "Titolo" --author "Autore"
   # da un export HTML in un solo file (stile Calibre)
   python3 scripts/import-html-unico.py cartella/ --id esempio \
       --title "Titolo" --author "Autore"
   ```

3. Caricalo nello store:

   ```bash
   node --env-file=.env.local scripts/upload-libro.mjs esempio
   ```

Per provare subito, `esempi/books/esempio.json` è un piccolo libro dimostrativo
già nel formato giusto, abbinato al corso di esempio:

```bash
mkdir -p data-private/books
cp esempi/books/esempio.json data-private/books/
node --env-file=.env.local scripts/upload-libro.mjs esempio
```

Carica solo testi che hai il diritto di usare: lo store è privato, ma i libri
restano opere protette.
