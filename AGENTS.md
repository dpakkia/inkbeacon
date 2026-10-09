<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Handoff — InkBeacon, a personal reading platform

A personal study space: read a book unit by unit, highlight sentences, build a
Mermaid diagram per chapter, track progress per course. Study state syncs to a
private Vercel Blob store behind a single personal key. UI, code identifiers,
file and route names, comments, docs and commits are in **English**; keep it
that way. (The code was translated from Italian on 2026-10-09; the importers
still recognise Italian chapter/part headings on purpose.)

This repo is the **public template**, extracted on 2026-10-09 from the owner's
private instance. It ships with two invented courses and three demo books. It
is published on GitHub (`origin`) and deployed on Vercel (see "Infrastructure").

## Layout

| Path                                                           | What it is                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/courses.ts`                                               | Types and validation (`parseRegistry`) of the course/book list, and `SEED_COURSES`, which fills the registry only the first time. No server imports: the browser uses it too.                                            |
| `lib/registry.ts`                                              | The live list, `studio/registry.json` in Blob: `readRegistry()` and `updateRegistry(change)` (conditional write on the ETag, retried). A missing registry means the seed; any other read error throws, never falls back. |
| `components/studio.tsx`                                        | The reader app (~2200 lines): reader, highlights, Mermaid editor/preview, progress, sync dialog, free diagrams (`freeSchemes` in code and in stored data). Gets every registry id as `sourceIds`.                        |
| `components/library.tsx`, `app/library/page.tsx`               | The Library page: add a book (convert in the browser + upload), edit courses and book details, delete a book with typed confirmation.                                                                                    |
| `lib/import/`                                                  | In-browser importers, TypeScript ports of the Python scripts (`epub.ts`, `single-html.ts`, shared `common.ts`). Same output as the scripts on the same input.                                                            |
| `lib/reading-format.ts`                                        | Types of the reading format (`ReadingCollection`).                                                                                                                                                                       |
| `app/page.tsx`                                                 | Course list.                                                                                                                                                                                                             |
| `app/[course]/page.tsx`, `app/[course]/[source]/page.tsx`      | Course page; reader for one source. Rendered on request from the registry. `source = 'free'` is the "Free diagrams" pseudo-source present in every course.                                                               |
| `app/api/session`                                              | `GET` status, `POST {accessKey}` sets the session cookie, `DELETE` logs out.                                                                                                                                             |
| `app/api/study-state`                                          | `GET`/`PUT` the study document.                                                                                                                                                                                          |
| `app/api/books/[source]` (+ `/media/[filename]`)               | Streams a book JSON / its media from Blob (bypassing the CDN cache). Session required; only ids in the registry with `readable: true`.                                                                                   |
| `app/api/library`                                              | `GET` the registry; `PUT` edits (names, details, order, which course). Can't add or remove books.                                                                                                                        |
| `app/api/library/upload`                                       | Issues client-upload tokens, only for `studio/books/<id>/…` of an id not in the registry.                                                                                                                                |
| `app/api/library/books` (+ `/[source]`)                        | `POST` adds an uploaded book to the registry; `DELETE {confirm: id}` deletes a book, its study data and its files.                                                                                                       |
| `app/api/progress`                                             | Read-only per-course percentages. Accepts the cookie **or** `Authorization: Bearer <STUDIO_ACCESS_KEY>` (for curl, scripts, an external display).                                                                        |
| `lib/study-state.ts`                                           | Parse/validate/read/write of the study document (`studio/state.json`, `version: 4`), scoped by the registry (`scopeOf`).                                                                                                 |
| `lib/studio-auth.ts`                                           | Key check and session cookie (HMAC of a fixed message keyed by `STUDIO_ACCESS_KEY`, httpOnly, 30 days).                                                                                                                  |
| `scripts/import-epub.py`, `scripts/import-single-html.py`      | Bulk conversion of an EPUB / a single-file Calibre HTML export into `data-private/`.                                                                                                                                     |
| `scripts/upload-book.mjs <id> [--course <slug>] [--pages <n>]` | Uploads `data-private/books/<id>.json` and its media to Blob; with `--course`, adds it to the registry. Run with `node --env-file=.env.local`.                                                                           |
| `examples/books/*.json`                                        | Three demo books (`example`, `study-notes`, `slow-reading`) matching `SEED_COURSES`; original text written for the template.                                                                                             |

## How data flows

- **Books are never in the repo.** The Library page converts them in the
  browser and uploads them straight to the private Blob store (Vercel limits
  function request bodies to 4.5 MB). The client fetches a book only once the
  session is authenticated; until then the reader shows a "Book locked"
  notice with a button that opens the key dialog — not placeholder text.
- **The registry** (`studio/registry.json`) lists courses and books. Every
  page reads it on request. `deleted` lists ids deleted on purpose.
- **Study state** lives in `localStorage` (`studio:*` keys, highlights per
  source in `studio:highlights:<id>`) and is mirrored to Blob with a ~650 ms
  debounced `PUT`. On load, local and server state are **merged**, not
  replaced. Each `PUT` sends `knownSources`; the server keeps its own data
  for any book the tab didn't know about (a tab opened before an upload).
- **Schema evolution is deliberate.** Each source is parsed independently, and
  a source missing from a stored document falls back to its empty value.
  Data for an id the registry doesn't list is kept, not dropped; only ids in
  `deleted` are removed. A registry problem must never cost study data.
  Preserve these properties in any change to `lib/study-state.ts`. The stored
  field names and `studio:*` keys were already English before the
  translation and were deliberately left unchanged.
- **Progress** is summed in units across a course's sources, never averaged
  across percentages. Sources with `unit: 'pages'` are moved by hand: ticking
  a chapter as done does not touch their page count.

## Environment

`.env.example` documents it. Needed: `STUDIO_ACCESS_KEY` and a Blob store
(`BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` + OIDC on Vercel). Without them the
app still runs; sync shows "Server needs setup" and books cannot load.

## Commands

```bash
npm install
npm run dev
npx tsc --noEmit -p .      # type check — must be clean
npm run build              # must pass
npm run lint               # 3 known errors in components/ui/chart.tsx (vendored, pre-existing)
npm run format             # oxfmt 0.61 from package.json; do NOT use `npx oxfmt` (pulls a newer version that reformats untouched code)
```

There are no tests. Verify UI changes in a browser, logged out and logged in.

## Rules

- **Never delete user data.** No deleting Blob objects, `data-private/`,
  `backup-stato/` or `_privato/`; no destructive rewrites of `studio/state.json`.
  Changes to the state format must read old documents without loss.
- **Never print or commit secrets.** Don't echo `.env.local` values in output,
  logs or commits. `.env*` is gitignored except `.env.example`, which holds
  placeholders only.
- **Keep the template personal-data-free.** No real course names, textbook
  titles/authors, excerpts, personal email or local paths in tracked files.
  Copyrighted text belongs in Blob, never in the repo.
- **`_privato/` is local only** (gitignored): the owner's book-specific importers,
  notes, an old `.env.example` and the original git history of the private
  instance. Don't commit it, publish it or remove it.
- **Separate infrastructure from the owner's private instance.** This folder's
  `.env.local` holds placeholders only (Blob token empty). Give this project its
  own Blob store and its own `STUDIO_ACCESS_KEY`; never paste in the private
  instance's credentials, or experiments here will write into real study data.
  The private instance lives in another folder; don't touch it from here.
- Commits: short English subject, a plain sentence (e.g. "The locked book says
  so, …").
  Author is configured locally in this repo.
  No AI attribution anywhere on GitHub: no `Co-Authored-By`, "Generated with",
  session links or similar in commits or PRs. AI use is disclosed only in the
  "AI disclaimer" section at the end of `README.md`; keep it.
- Read `node_modules/next/dist/docs/` before using Next.js APIs (see the block
  above).

## Roadmap

Start from `FIRST_TODO.md` (local, gitignored) if it exists: it has the
details for each step. The app is about **books only**.

0. Translate everything to English. Done 2026-10-09.
   - 0.1 Three sample books in `examples/books/`; the movie-specific
     `'analysis'` source kind removed. Done 2026-10-09.
1. Publish on GitHub. Done 2026-10-09: https://github.com/dpakkia/inkbeacon
   (public, MIT).
2. Audio player for studying, with playlists and live streams from YouTube.
   On hold: YouTube's terms forbid a hidden or background player.
3. Upload and manage books from the app. Done 2026-10-09: the Library page,
   registry in Blob, in-browser EPUB and single-HTML import, confirmed delete.
4. KOReader progress sync (kosync). Note only; not planned yet.

## Infrastructure

- Done 2026-10-09. Vercel project `inkbeacon` (personal scope), connected to
  the GitHub repo: pushes to `main` deploy to https://inkbeacon.vercel.app,
  other branches get previews. `vercel.json` sets the Next.js framework and
  the `cdg1` function region.
- Private Blob store `inkbeacon-blob` (`cdg1`), separate from the private
  instance's store. It holds the three sample books only.
- `STUDIO_ACCESS_KEY` is set for Production, Preview and Development; the
  local copy is in `.env.local` (never print it). `vercel env pull .env.local`
  refreshes the Blob token.
