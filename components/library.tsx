'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookPlus,
  Check,
  FolderPlus,
  LoaderCircle,
  LockKeyhole,
  Trash2,
  Upload,
} from 'lucide-react';
import { upload } from '@vercel/blob/client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  allSources,
  isValidSourceId,
  slugify,
  type Course,
  type Registry,
  type Source,
  type SourceUnit,
} from '@/lib/courses';
import type { ImportResult } from '@/lib/import/common';

type Access = 'checking' | 'unconfigured' | 'locked' | 'open';
const NEW_COURSE = '__new__';
const UPLOAD_URL = '/api/library/upload';

async function jsonOrError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? 'Something went wrong.');
  return payload;
}

/** Removes a deleted book's copy from this browser's local cache. */
function forgetLocally(id: string) {
  try {
    window.localStorage.removeItem(`studio:highlights:${id}`);
    for (const key of ['studio:progress', 'studio:completed-units']) {
      const record = JSON.parse(
        window.localStorage.getItem(key) ?? '{}',
      ) as Record<string, unknown>;
      delete record[id];
      window.localStorage.setItem(key, JSON.stringify(record));
    }
    const mermaid = JSON.parse(
      window.localStorage.getItem('studio:mermaid-by-chapter') ?? '{}',
    ) as Record<string, string>;
    for (const key of Object.keys(mermaid)) {
      if (key.split(':')[0] === id) delete mermaid[key];
    }
    window.localStorage.setItem(
      'studio:mermaid-by-chapter',
      JSON.stringify(mermaid),
    );
  } catch {
    // a broken local cache is rebuilt from the server on the next visit
  }
}

export default function Library({ initial }: { initial: Registry }) {
  const router = useRouter();
  const [access, setAccess] = useState<Access>('checking');
  const [accessKey, setAccessKey] = useState('');
  const [accessError, setAccessError] = useState('');
  const [registry, setRegistry] = useState(initial);
  const [draft, setDraft] = useState<Course[]>(initial.courses);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toDelete, setToDelete] = useState<Source | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(registry.courses),
    [draft, registry],
  );

  useEffect(() => {
    void (async () => {
      try {
        const session = (await (
          await fetch('/api/session', { cache: 'no-store' })
        ).json()) as { configured: boolean; authenticated: boolean };
        setAccess(
          !session.configured
            ? 'unconfigured'
            : session.authenticated
              ? 'open'
              : 'locked',
        );
      } catch {
        setAccess('unconfigured');
      }
    })();
  }, []);

  const applyRegistry = useCallback(
    (next: Registry) => {
      setRegistry(next);
      setDraft(next.courses);
      router.refresh();
    },
    [router],
  );

  const unlock = async () => {
    setAccessError('');
    try {
      await jsonOrError(
        await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessKey }),
        }),
      );
      setAccessKey('');
      setAccess('open');
      const fresh = (await jsonOrError(
        await fetch('/api/library', { cache: 'no-store' }),
      )) as Registry;
      applyRegistry(fresh);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const next = (await jsonOrError(
        await fetch('/api/library', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courses: draft }),
        }),
      )) as Registry;
      applyRegistry(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const updateCourse = (index: number, patch: Partial<Course>) =>
    setDraft((courses) =>
      courses.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );

  const updateSource = (id: string, patch: Partial<Source>) =>
    setDraft((courses) =>
      courses.map((c) => ({
        ...c,
        sources: c.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),
    );

  const moveCourse = (index: number, delta: number) =>
    setDraft((courses) => {
      const next = [...courses];
      const [course] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, course);
      return next;
    });

  const moveSourceWithin = (courseIndex: number, id: string, delta: number) =>
    setDraft((courses) =>
      courses.map((c, i) => {
        if (i !== courseIndex) return c;
        const sources = [...c.sources];
        const from = sources.findIndex((s) => s.id === id);
        const [source] = sources.splice(from, 1);
        sources.splice(
          Math.max(0, Math.min(sources.length, from + delta)),
          0,
          source,
        );
        return { ...c, sources };
      }),
    );

  const moveSourceTo = (id: string, slug: string) =>
    setDraft((courses) => {
      const source = courses.flatMap((c) => c.sources).find((s) => s.id === id);
      if (!source) return courses;
      return courses.map((c) => ({
        ...c,
        sources:
          c.slug === slug
            ? [...c.sources.filter((s) => s.id !== id), source]
            : c.sources.filter((s) => s.id !== id),
      }));
    });

  const addCourse = () =>
    setDraft((courses) => {
      const base = 'new-course';
      let slug = base;
      for (let n = 2; courses.some((c) => c.slug === slug); n += 1)
        slug = `${base}-${n}`;
      return [
        ...courses,
        { slug, name: 'New course', description: '', sources: [] },
      ];
    });

  if (access === 'checking') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-ink">
        <LoaderCircle className="size-4 animate-spin" /> Checking access…
      </p>
    );
  }
  if (access === 'unconfigured') {
    return (
      <p className="text-sm text-muted-ink">
        The server isn’t set up yet: the library needs a Blob store and an
        access key (see the README).
      </p>
    );
  }
  if (access === 'locked') {
    return (
      <form
        className="max-w-sm space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <p className="flex items-center gap-2 text-sm text-muted-ink">
          <LockKeyhole className="size-4" /> Enter the access key to manage the
          library.
        </p>
        <Input
          type="password"
          value={accessKey}
          onChange={(event) => setAccessKey(event.target.value)}
          placeholder="Access key"
          aria-label="Access key"
          autoComplete="current-password"
        />
        {accessError && (
          <p className="text-xs text-destructive">{accessError}</p>
        )}
        <Button type="submit" disabled={!accessKey.trim()}>
          Unlock
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-12">
      <UploadForm
        registry={registry}
        disabled={dirty}
        onAdded={(next) => applyRegistry(next)}
      />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-heading text-xl font-medium">
            Courses and books
          </h2>
          <Button variant="outline" size="sm" onClick={addCourse}>
            <FolderPlus /> New course
          </Button>
        </div>

        {draft.map((course, index) => (
          <div
            key={course.slug}
            className="space-y-3 rounded-xl border border-line bg-card/60 p-4"
          >
            <div className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 gap-2">
                <Input
                  value={course.name}
                  onChange={(e) =>
                    updateCourse(index, { name: e.target.value })
                  }
                  aria-label="Course name"
                  className="font-heading text-base"
                />
                <Input
                  value={course.description}
                  onChange={(e) =>
                    updateCourse(index, { description: e.target.value })
                  }
                  placeholder="Description (optional)"
                  aria-label="Course description"
                />
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move course up"
                  disabled={index === 0}
                  onClick={() => moveCourse(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move course down"
                  disabled={index === draft.length - 1}
                  onClick={() => moveCourse(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove empty course"
                  title={
                    course.sources.length
                      ? 'Move or delete its books first'
                      : 'Remove this empty course'
                  }
                  disabled={course.sources.length > 0}
                  onClick={() =>
                    setDraft((courses) => courses.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>

            {course.sources.length === 0 ? (
              <p className="text-xs text-muted-ink">No books in this course.</p>
            ) : (
              <ul className="space-y-2">
                {course.sources.map((source, sourceIndex) => (
                  <li
                    key={source.id}
                    className="grid gap-2 rounded-lg border border-line/80 bg-paper/60 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={source.title}
                        onChange={(e) =>
                          updateSource(source.id, { title: e.target.value })
                        }
                        aria-label="Title"
                        className="min-w-48 flex-1"
                      />
                      <Input
                        value={source.shortTitle}
                        onChange={(e) =>
                          updateSource(source.id, {
                            shortTitle: e.target.value,
                          })
                        }
                        aria-label="Short title"
                        title="Short title, shown in the book picker"
                        className="w-36"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={source.author}
                        onChange={(e) =>
                          updateSource(source.id, { author: e.target.value })
                        }
                        placeholder="Author"
                        aria-label="Author"
                        className="min-w-40 flex-1"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={source.total}
                        onChange={(e) =>
                          updateSource(source.id, {
                            total: Math.max(
                              0,
                              Math.round(Number(e.target.value) || 0),
                            ),
                          })
                        }
                        aria-label="Total"
                        className="w-24"
                      />
                      <NativeSelect
                        value={source.unit}
                        onChange={(e) =>
                          updateSource(source.id, {
                            unit: e.target.value as SourceUnit,
                          })
                        }
                        aria-label="Unit"
                      >
                        <NativeSelectOption value="chapters">
                          chapters
                        </NativeSelectOption>
                        <NativeSelectOption value="pages">
                          pages
                        </NativeSelectOption>
                      </NativeSelect>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-ink">
                      <code className="rounded bg-secondary px-1.5 py-0.5">
                        {source.id}
                      </code>
                      <NativeSelect
                        size="sm"
                        value={course.slug}
                        onChange={(e) =>
                          moveSourceTo(source.id, e.target.value)
                        }
                        aria-label="Course"
                      >
                        {draft.map((c) => (
                          <NativeSelectOption key={c.slug} value={c.slug}>
                            {c.name || c.slug}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <span className="ml-auto flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Move book up"
                          disabled={sourceIndex === 0}
                          onClick={() => moveSourceWithin(index, source.id, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Move book down"
                          disabled={sourceIndex === course.sources.length - 1}
                          onClick={() => moveSourceWithin(index, source.id, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive"
                          disabled={dirty}
                          title={
                            dirty
                              ? 'Save or discard your edits first'
                              : undefined
                          }
                          onClick={() => setToDelete(source)}
                        >
                          <Trash2 /> Delete
                        </Button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <div className="sticky bottom-4 flex items-center justify-end gap-3">
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <Button
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => setDraft(registry.courses)}
          >
            Discard
          </Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Check />}{' '}
            Save changes
          </Button>
        </div>
      </section>

      <DeleteDialog
        source={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={(next, id) => {
          forgetLocally(id);
          setToDelete(null);
          applyRegistry(next);
        }}
      />
    </div>
  );
}

function DeleteDialog({
  source,
  onClose,
  onDeleted,
}: {
  source: Source | null;
  onClose: () => void;
  onDeleted: (registry: Registry, id: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    if (!source) return;
    setBusy(true);
    setError('');
    try {
      const payload = (await jsonOrError(
        await fetch(`/api/library/books/${source.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: typed }),
        }),
      )) as { registry: Registry };
      setTyped('');
      onDeleted(payload.registry, source.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={Boolean(source)}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setTyped('');
          setError('');
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{source?.title}”?</DialogTitle>
          <DialogDescription>
            This deletes the book’s text and images, and all its highlights,
            diagrams and progress. It can’t be undone. Type{' '}
            <code className="font-semibold text-ink">{source?.id}</code> to
            confirm.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Book id"
          placeholder={source?.id}
          autoComplete="off"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter className="mx-0 -mb-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || typed !== source?.id}
            onClick={() => void remove()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}{' '}
            Delete for good
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Format = 'epub' | 'html';

function UploadForm({
  registry,
  disabled,
  onAdded,
}: {
  registry: Registry;
  disabled: boolean;
  onAdded: (registry: Registry) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [shortTitle, setShortTitle] = useState('');
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [course, setCourse] = useState(registry.courses[0]?.slug ?? NEW_COURSE);
  const [newCourseName, setNewCourseName] = useState('');
  const [unit, setUnit] = useState<SourceUnit>('chapters');
  const [pages, setPages] = useState('');
  const [split, setSplit] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const format: Format | null = file
    ? /\.epub$/i.test(file.name)
      ? 'epub'
      : 'html'
    : null;
  const takenIds = useMemo(
    () => new Set(allSources(registry).map((s) => s.id)),
    [registry],
  );
  const idProblem = !id
    ? 'Choose an id.'
    : !isValidSourceId(id)
      ? 'Use lowercase letters, digits and dashes (max 40).'
      : takenIds.has(id)
        ? 'Another book already uses this id.'
        : '';

  const chooseFile = async (next: File | null) => {
    setFile(next);
    setStatus('');
    setError('');
    if (!next) return;
    let suggested = next.name.replace(/\.(epub|zip|x?html?)$/i, '');
    if (/\.epub$/i.test(next.name)) {
      try {
        const { readEpubMetadata } = await import('@/lib/import/epub');
        const meta = readEpubMetadata(new Uint8Array(await next.arrayBuffer()));
        if (meta.title) suggested = meta.title;
        if (meta.author) setAuthor(meta.author);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setTitle(suggested);
    setShortTitle(suggested.slice(0, 30));
    if (!idEdited) setId(slugify(suggested));
  };

  const ready =
    file &&
    title.trim() &&
    shortTitle.trim() &&
    !idProblem &&
    (course !== NEW_COURSE || newCourseName.trim()) &&
    (unit === 'chapters' || Number(pages) > 0);

  const submit = async () => {
    if (!file || !ready) return;
    setBusy(true);
    setError('');
    try {
      setStatus('Converting…');
      const data = new Uint8Array(await file.arrayBuffer());
      const options = { id, title: title.trim(), author: author.trim() };
      let result: ImportResult;
      if (format === 'epub') {
        const { importEpub } = await import('@/lib/import/epub');
        result = importEpub(data, options);
      } else {
        const { importSingleHtml, readHtmlSource } =
          await import('@/lib/import/single-html');
        result = importSingleHtml(readHtmlSource(file.name, data), {
          ...options,
          split,
        });
      }

      const { book, media } = result;
      let done = 0;
      for (let i = 0; i < media.length; i += 4) {
        await Promise.all(
          media.slice(i, i + 4).map(async (m) => {
            await upload(
              `studio/books/${id}/media/${m.name}`,
              new Blob([m.data as BlobPart]),
              {
                access: 'private',
                handleUploadUrl: UPLOAD_URL,
                contentType: m.contentType,
                multipart: m.data.byteLength > 8 * 1024 * 1024,
              },
            );
            done += 1;
            setStatus(`Uploading images and videos… ${done}/${media.length}`);
          }),
        );
      }

      setStatus('Uploading the text…');
      const json = JSON.stringify(book);
      await upload(`studio/books/${id}/book.json`, json, {
        access: 'private',
        handleUploadUrl: UPLOAD_URL,
        contentType: 'application/json',
        multipart: json.length > 8 * 1024 * 1024,
      });

      setStatus('Adding it to the library…');
      const next = (await jsonOrError(
        await fetch('/api/library/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: {
              id,
              title: title.trim(),
              shortTitle: shortTitle.trim(),
              author: author.trim(),
              unit,
              total:
                unit === 'pages'
                  ? Math.round(Number(pages))
                  : book.chapterCount,
            },
            ...(course === NEW_COURSE
              ? { newCourse: { name: newCourseName.trim() } }
              : { course }),
          }),
        }),
      )) as Registry;

      setStatus(
        `Added “${title.trim()}”: ${book.unitCount} sections in ${book.chapterCount} chapters, ${media.length} images or videos.`,
      );
      setFile(null);
      setIdEdited(false);
      onAdded(next);
    } catch (e) {
      setStatus('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-line bg-card/60 p-5">
      <h2 className="flex items-center gap-2 font-heading text-xl font-medium">
        <BookPlus className="size-5" /> Add a book
      </h2>
      <p className="text-sm text-muted-ink">
        An EPUB, or a single-file HTML export (Calibre style): the .html alone,
        or a .zip of its folder to keep the images. The book is converted in
        this browser and uploaded to your private store.
      </p>

      <Input
        type="file"
        accept=".epub,.html,.htm,.xhtml,.zip"
        aria-label="Book file"
        disabled={busy || disabled}
        onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
      />

      {file && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            {(fid) => (
              <Input
                id={fid}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Field label="Author">
            {(fid) => (
              <Input
                id={fid}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            )}
          </Field>
          <Field label="Short title (book picker)">
            {(fid) => (
              <Input
                id={fid}
                value={shortTitle}
                maxLength={60}
                onChange={(e) => setShortTitle(e.target.value)}
              />
            )}
          </Field>
          <Field label="Id (in links; can’t be changed later)">
            {(fid) => (
              <>
                <Input
                  id={fid}
                  value={id}
                  onChange={(e) => {
                    setIdEdited(true);
                    setId(e.target.value.toLowerCase());
                  }}
                  aria-invalid={Boolean(idProblem)}
                />
                {idProblem && (
                  <span className="text-destructive">{idProblem}</span>
                )}
              </>
            )}
          </Field>
          <Field label="Course">
            {(fid) => (
              <NativeSelect
                id={fid}
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                className="w-full"
              >
                {registry.courses.map((c) => (
                  <NativeSelectOption key={c.slug} value={c.slug}>
                    {c.name}
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value={NEW_COURSE}>
                  New course…
                </NativeSelectOption>
              </NativeSelect>
            )}
          </Field>
          {course === NEW_COURSE ? (
            <Field label="New course name">
              {(fid) => (
                <Input
                  id={fid}
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                />
              )}
            </Field>
          ) : (
            <span />
          )}
          <Field label="Track progress in">
            {(fid) => (
              <NativeSelect
                id={fid}
                value={unit}
                onChange={(e) => setUnit(e.target.value as SourceUnit)}
                className="w-full"
              >
                <NativeSelectOption value="chapters">
                  chapters (ticked as you finish them)
                </NativeSelectOption>
                <NativeSelectOption value="pages">
                  pages (moved by hand)
                </NativeSelectOption>
              </NativeSelect>
            )}
          </Field>
          {unit === 'pages' ? (
            <Field label="Number of pages">
              {(fid) => (
                <Input
                  id={fid}
                  type="number"
                  min={1}
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                />
              )}
            </Field>
          ) : (
            <span />
          )}
          {format === 'html' && (
            <Field
              label="Section marker (advanced; leave empty for Calibre exports)"
              wide
            >
              {(fid) => (
                <Input
                  id={fid}
                  value={split}
                  placeholder='div class="calibre"'
                  onChange={(e) => setSplit(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!ready || busy || disabled}
          onClick={() => void submit()}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{' '}
          Convert and upload
        </Button>
        {disabled && (
          <span className="text-xs text-muted-ink">
            Save or discard your edits below first.
          </span>
        )}
        {status && <span className="text-xs text-muted-ink">{status}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <p className="text-xs text-muted-ink">
        Only upload texts you have the right to use. Large books can take a
        while; keep this tab open until it says “Added”.{' '}
        <Link href="/" className="underline underline-offset-4">
          Back to the courses
        </Link>
      </p>
    </section>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={`grid gap-1 text-xs text-muted-ink ${wide ? 'sm:col-span-2' : ''}`}
    >
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}
