<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Handoff — piattaforma di lettura personalizzata

A personal study space: read a book unit by unit, highlight sentences, build a
Mermaid diagram per chapter, track progress per course. Study state syncs to a
private Vercel Blob store behind a single personal key. UI, code identifiers
and comments are in **Italian**; keep it that way.

This repo is the **public template**, extracted on 2026-10-09 from the owner's
private instance. It ships with one invented course and one demo book. It has
one commit, no remote, no Vercel project and no Blob store yet.

## Layout

| Path | What it is |
|---|---|
| `lib/corsi.ts` | Registry of courses (`CORSI`) and their sources (`fonti`). Single source of truth: routes, valid ids and progress totals all derive from it. Adding a course or book = editing this file only. |
| `components/studio.tsx` | The whole client app (~2200 lines): reader, highlights, Mermaid editor/preview, progress, sync dialog, free schemes. |
| `app/page.tsx` | Course list. |
| `app/[corso]/page.tsx`, `app/[corso]/[fonte]/page.tsx` | Course page; reader for one source. Statically generated from `CORSI`. `fonte = 'free'` is the "Schemi liberi" pseudo-source present in every course. |
| `app/api/session` | `GET` status, `POST {accessKey}` sets the session cookie, `DELETE` logs out. |
| `app/api/study-state` | `GET`/`PUT` the study document. |
| `app/api/books/[fonte]` (+ `/media/[filename]`) | Streams a book JSON / its media from Blob. Session required; only ids in the registry with `leggibile: true`. |
| `app/api/progresso` | Read-only per-course percentages. Accepts the cookie **or** `Authorization: Bearer <STUDIO_ACCESS_KEY>` (for curl, scripts, an external display). |
| `lib/stato-studio.ts` | Parse/validate/read/write of the study document (`studio/state.json`, `version: 4`). |
| `lib/studio-auth.ts` | Key check and session cookie (HMAC of a fixed message keyed by `STUDIO_ACCESS_KEY`, httpOnly, 30 days). |
| `scripts/import-epub.py`, `scripts/import-html-unico.py` | Convert an EPUB / a single-file Calibre HTML export into the reading format, into `data-private/`. |
| `scripts/upload-libro.mjs <id>` | Uploads `data-private/books/<id>.json` and `data-private/media/<id>/` to Blob under `studio/books/<id>/`. Run with `node --env-file=.env.local`. |
| `esempi/books/esempio.json` | Demo book matching the example source `esempio`. Also the reference for the reading format (`ReadingCollection` in `studio.tsx`). |

## How data flows

- **Books are never in the repo.** They are converted locally into
  `data-private/` (gitignored, also in `.vercelignore`) and uploaded to the
  private Blob store. The client fetches a book only once the session is
  authenticated; until then the reader shows a "Libro bloccato" notice with a
  button that opens the key dialog — not placeholder text.
- **Study state** lives in `localStorage` (`studio:*` keys, highlights per
  source in `studio:highlights:<id>`) and is mirrored to Blob with a ~650 ms
  debounced `PUT`. On load, local and server state are **merged**, not
  replaced.
- **Schema evolution is deliberate.** Each source is parsed independently, and
  a source missing from a stored document falls back to its empty value. That
  is why adding a book to the registry does not discard study done on the
  others. Preserve this property in any change to `lib/stato-studio.ts`.
- **Progress** is summed in units across a course's sources, never averaged
  across percentages. Sources with `unit: 'pagine'` are moved by hand: ticking
  a chapter as done does not touch their page count.

## Environment

`.env.example` documents it. Needed: `STUDIO_ACCESS_KEY` and a Blob store
(`BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` + OIDC on Vercel). Without them the
app still runs; sync shows "Server da configurare" and books cannot load.

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
  `.env.local` still points at the private instance's Blob store and key. Before
  running this copy against a server, give it its own Blob store and its own
  `STUDIO_ACCESS_KEY`, or experiments here will write into real study data.
  The private instance lives in another folder; don't touch it from here.
- Commits: short Italian subject in the style "Il libro bloccato lo dice, …".
  Author is configured locally in this repo.
- Read `node_modules/next/dist/docs/` before using Next.js APIs (see the block
  above).

## Open items

1. Create the GitHub repo and push (owner: `dpakkia`; visibility and name not
   decided yet — ask).
2. Own Vercel project + private Blob store + new `STUDIO_ACCESS_KEY` for this
   template's deployment.
3. Optional: a LICENSE file (owner hasn't chosen one).
