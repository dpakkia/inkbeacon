# InkBeacon

A beacon of light in a “content” world where reading is hard-to-navigate.

A space for studying your own texts: read chapter by chapter, highlight
sentences, build a Mermaid diagram for each chapter and track the progress of
every course. Study state syncs to a private store, protected by a personal
key.

Built with Next.js, Tailwind and Vercel Blob.

## How it works

- **Courses and sources** are listed in `lib/courses.ts`. It's the only file to
  touch to add a course or a book.
- **Books** don't live in the repository: they're converted to JSON locally
  and uploaded to a private Vercel Blob store. The app downloads them only
  after you've entered the key.
- **Your study** (highlights, diagrams, progress) is saved to the same store,
  in `studio/state.json`.
- **`GET /api/progress`** returns the percentages per course, with
  `Authorization: Bearer <STUDIO_ACCESS_KEY>`. It's there to show them
  elsewhere (on a display, for example).

## Getting started

You need Node.js 22.13 or later.

```bash
npm install
cp .env.example .env.local   # then pick a long, random key
npm run dev
```

To sync and read books you need a private Blob store: create it from the
Vercel dashboard, connect it to the project and pull the variables with
`vercel env pull .env.local`. Add `STUDIO_ACCESS_KEY` to the project's
variables on Vercel too.

## Adding a book

1. Add the source to `lib/courses.ts`, with a short `id` (for example
   `example`).
2. Convert the book to the reading format, inside `data-private/` (which git
   ignores):

   ```bash
   # from an EPUB
   python3 scripts/import-epub.py book.epub --id example \
       --title "Title" --author "Author"
   # from a single-file HTML export (Calibre style)
   python3 scripts/import-single-html.py folder/ --id example \
       --title "Title" --author "Author"
   ```

   Chapter and part headings are recognised in English ("Chapter 3",
   "Part II") and Italian ("Capitolo 3", "Parte II").

3. Upload it to the store:

   ```bash
   node --env-file=.env.local scripts/upload-book.mjs example
   ```

To try it straight away, `examples/books/` holds three small demo books
already in the right format, matching the two example courses in
`lib/courses.ts`. `slow-reading` counts progress in pages, which you move by
hand.

```bash
mkdir -p data-private/books
cp examples/books/*.json data-private/books/
for id in example study-notes slow-reading; do
  node --env-file=.env.local scripts/upload-book.mjs "$id"
done
```

Only upload texts you have the right to use: the store is private, but books
remain copyrighted works.

## AI disclaimer

This code was automated in various steps, but with inspection so close I
wouldn't personally consider it "vibe-coding". That said, many issues were
solved with the use of models from Anthropic, OpenAI, and local-running Qwen.
