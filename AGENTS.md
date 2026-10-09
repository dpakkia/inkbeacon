<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Handoff — personal reading platform

A personal study space: read a book unit by unit, highlight sentences, build a
Mermaid diagram per chapter, track progress per course. Study state syncs to a
private Vercel Blob store behind a single personal key. UI, code identifiers,
file and route names, comments, docs and commits are in **English**; keep it
that way. (The code was translated from Italian on 2026-10-09; the importers
still recognise Italian chapter/part headings on purpose.)

This repo is the **public template**, extracted on 2026-10-09 from the owner's
private instance. It ships with two invented courses and three demo books. It
is published on GitHub (`origin`); it has no Vercel project or Blob store yet.

## Layout

| Path                                                      | What it is                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/courses.ts`                                          | Registry of courses (`COURSES`) and their `sources`. Single source of truth: routes, valid ids and progress totals all derive from it. Adding a course or book = editing this file only.                                       |
| `components/studio.tsx`                                   | The whole client app (~2200 lines): reader, highlights, Mermaid editor/preview, progress, sync dialog, free diagrams (`freeSchemes` in code and in stored data).                                                               |
| `app/page.tsx`                                            | Course list.                                                                                                                                                                                                                   |
| `app/[course]/page.tsx`, `app/[course]/[source]/page.tsx` | Course page; reader for one source. Statically generated from `COURSES`. `source = 'free'` is the "Free diagrams" pseudo-source present in every course.                                                                       |
| `app/api/session`                                         | `GET` status, `POST {accessKey}` sets the session cookie, `DELETE` logs out.                                                                                                                                                   |
| `app/api/study-state`                                     | `GET`/`PUT` the study document.                                                                                                                                                                                                |
| `app/api/books/[source]` (+ `/media/[filename]`)          | Streams a book JSON / its media from Blob. Session required; only ids in the registry with `readable: true`.                                                                                                                   |
| `app/api/progress`                                        | Read-only per-course percentages. Accepts the cookie **or** `Authorization: Bearer <STUDIO_ACCESS_KEY>` (for curl, scripts, an external display).                                                                              |
| `lib/study-state.ts`                                      | Parse/validate/read/write of the study document (`studio/state.json`, `version: 4`).                                                                                                                                           |
| `lib/studio-auth.ts`                                      | Key check and session cookie (HMAC of a fixed message keyed by `STUDIO_ACCESS_KEY`, httpOnly, 30 days).                                                                                                                        |
| `scripts/import-epub.py`, `scripts/import-single-html.py` | Convert an EPUB / a single-file Calibre HTML export into the reading format, into `data-private/`.                                                                                                                             |
| `scripts/upload-book.mjs <id>`                            | Uploads `data-private/books/<id>.json` and `data-private/media/<id>/` to Blob under `studio/books/<id>/`. Run with `node --env-file=.env.local`.                                                                               |
| `examples/books/*.json`                                   | Three demo books (`example`, `study-notes`, `slow-reading`) matching the sources in `lib/courses.ts`; original text written for the template. Also the reference for the reading format (`ReadingCollection` in `studio.tsx`). |

## How data flows

- **Books are never in the repo.** They are converted locally into
  `data-private/` (gitignored, also in `.vercelignore`) and uploaded to the
  private Blob store. The client fetches a book only once the session is
  authenticated; until then the reader shows a "Book locked" notice with a
  button that opens the key dialog — not placeholder text.
- **Study state** lives in `localStorage` (`studio:*` keys, highlights per
  source in `studio:highlights:<id>`) and is mirrored to Blob with a ~650 ms
  debounced `PUT`. On load, local and server state are **merged**, not
  replaced.
- **Schema evolution is deliberate.** Each source is parsed independently, and
  a source missing from a stored document falls back to its empty value. That
  is why adding a book to the registry does not discard study done on the
  others. Preserve this property in any change to `lib/study-state.ts`.
  The stored field names and `studio:*` keys were already English before the
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
2. Audio player for studying: playlists and live streams from YouTube, built
   into the code, played through a hidden embed. Check YouTube's embed terms
   first.
3. Upload and manage books from the app (moves the registry from
   `lib/courses.ts` to Blob).
4. KOReader progress sync (kosync). Note only; not planned yet.

## Infrastructure

- Own Vercel project + private Blob store + new `STUDIO_ACCESS_KEY` for this
  template's deployment. Needs the owner's go-ahead.
