'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Cloud,
  CloudOff,
  Code2,
  Eye,
  FilePlus2,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Moon,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Sun,
  Trash2,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

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
import { Progress } from '@/components/ui/progress';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Course, Source } from '@/lib/courses';
import type {
  ReadingBlock,
  ReadingCollection,
  ReadingUnit,
} from '@/lib/reading-format';
import { useIsMobile } from '@/hooks/use-mobile';

type StudySourceId = string;
type SourceId = string;
type EditorMode = 'visual' | 'code';
type HighlightColor = 'yellow' | 'mint' | 'coral';
type Theme = 'light' | 'dark';
type SyncStatus =
  | 'checking'
  | 'unconfigured'
  | 'locked'
  | 'saving'
  | 'saved'
  | 'error';

type Preview = {
  location: string;
  chapter: string;
  heading: string;
  paragraphs: string[];
};

type ReaderSource = Source & Preview;

type Highlight = {
  id: string;
  unitId?: string;
  paragraph: number;
  start: number;
  end: number;
  color: HighlightColor;
  quote: string;
};

type PendingSelection = Omit<Highlight, 'id' | 'color'> & {
  x: number;
  y: number;
};

type HighlightStore = Record<StudySourceId, Highlight[]>;
type ProgressStore = Record<StudySourceId, number>;
type CompletedStore = Record<StudySourceId, string[]>;
type MermaidStore = Record<string, string>;

type FreeScheme = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type StudyStatePayload = {
  highlights: HighlightStore;
  progress: ProgressStore;
  completedUnits: CompletedStore;
  freeSchemes: FreeScheme[];
  mermaidByChapter: MermaidStore;
  initialized: boolean;
};

/** Placeholder text for sources whose full text doesn't exist yet. */
const PREVIEWS: Record<string, Preview> = {};

const EMPTY_PREVIEW: Preview = {
  location: '',
  chapter: '',
  heading: '',
  paragraphs: [],
};

/** The 'free diagrams' entry is not a book: it appears in every course. */
const FREE_DIAGRAMS: ReaderSource = {
  id: 'free',
  kind: 'diagrams',
  shortTitle: 'Free diagrams',
  title: 'Free diagrams',
  author: '',
  unit: 'diagrams',
  total: 0,
  readable: false,
  ...EMPTY_PREVIEW,
};

const DEFAULT_MERMAID_BY_CHAPTER: MermaidStore = {};

const HIGHLIGHT_CLASSES: Record<HighlightColor, string> = {
  yellow:
    'bg-[#f7df86]/70 decoration-[#b68a00] dark:bg-[#8b7428]/70 dark:decoration-[#e8cb61]',
  mint: 'bg-[#d8d9d7]/85 decoration-[#6e716f] dark:bg-[#565957]/85 dark:decoration-[#b9bcba]',
  coral:
    'bg-[#efb9a8]/65 decoration-[#a8472d] dark:bg-[#824936]/80 dark:decoration-[#e99c83]',
};

const COLOR_BUTTONS: Array<{
  color: HighlightColor;
  label: string;
  className: string;
}> = [
  { color: 'yellow', label: 'Yellow', className: 'bg-[#f3d76d]' },
  { color: 'mint', label: 'Grey', className: 'bg-[#b9bcba]' },
  { color: 'coral', label: 'Coral', className: 'bg-[#e9a18a]' },
];

const emptyHighlights = (ids: string[]): HighlightStore =>
  Object.fromEntries(ids.map((id) => [id, [] as Highlight[]]));

const emptyProgress = (ids: string[]): ProgressStore =>
  Object.fromEntries(ids.map((id) => [id, 0]));

const emptyCompleted = (ids: string[]): CompletedStore =>
  Object.fromEntries(ids.map((id) => [id, [] as string[]]));

// The browser may hold a localStorage written when there were three sources:
// that store has no keys for the books added later, and using it as is blows
// up the first `completedUnits[source].includes(...)`.
// The registry decides the keys; the saved data fills the ones it knows.
function perSource<T>(
  ids: string[],
  saved: unknown,
  empty: () => T,
): Record<string, T> {
  const record =
    saved && typeof saved === 'object' && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    ids.map((id) => [id, (record[id] as T | undefined) ?? empty()]),
  );
}

const FREE_SCHEME_STARTER = `flowchart LR
    A[Main idea] --> B[First connection]`;
const MIN_DIAGRAM_ZOOM = 0.5;
const MAX_DIAGRAM_ZOOM = 2;
const DIAGRAM_ZOOM_STEP = 0.1;

const SYNC_LABELS: Record<SyncStatus, string> = {
  checking: 'Checking sync…',
  unconfigured: 'Server needs setup',
  locked: 'Sync locked',
  saving: 'Saving to server…',
  saved: 'Saved to server',
  error: 'Server unreachable',
};

function mergeHighlights(
  ids: string[],
  server: HighlightStore,
  cached: HighlightStore,
): HighlightStore {
  return Object.fromEntries(
    ids.map((sourceId) => {
      const unique = new Map<string, Highlight>();
      for (const storedHighlight of [
        ...(server[sourceId] ?? []),
        ...(cached[sourceId] ?? []),
      ]) {
        const highlight = storedHighlight;
        const signature = `${highlight.unitId ?? 'legacy'}:${highlight.paragraph}:${highlight.start}:${highlight.end}:${highlight.quote}`;
        if (!unique.has(signature)) unique.set(signature, highlight);
      }
      return [sourceId, [...unique.values()]];
    }),
  ) as HighlightStore;
}

function mergeCompletedUnits(
  ids: string[],
  server: CompletedStore,
  cached: CompletedStore,
): CompletedStore {
  return Object.fromEntries(
    ids.map((sourceId) => [
      sourceId,
      [...new Set([...(server[sourceId] ?? []), ...(cached[sourceId] ?? [])])],
    ]),
  ) as CompletedStore;
}

function mergeFreeSchemes(
  server: FreeScheme[],
  cached: FreeScheme[],
): FreeScheme[] {
  const merged = new Map<string, FreeScheme>();
  for (const scheme of [...cached, ...server]) {
    const existing = merged.get(scheme.id);
    if (
      !existing ||
      new Date(scheme.updatedAt).getTime() >=
        new Date(existing.updatedAt).getTime()
    ) {
      merged.set(scheme.id, scheme);
    }
  }
  return [...merged.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function Studio({
  course,
  source: initialSource,
  sourceIds,
}: {
  course: Course;
  source: Source;
  /** Every book in the registry, not only this course's: study data is shared. */
  sourceIds: string[];
}) {
  const router = useRouter();

  // The selectable sources are the course's own, plus the free diagrams.
  const sources = useMemo<ReaderSource[]>(
    () => [
      ...course.sources.map((s) => ({
        ...s,
        ...(PREVIEWS[s.id] ?? EMPTY_PREVIEW),
      })),
      FREE_DIAGRAMS,
    ],
    [course],
  );

  const isMobile = useIsMobile();
  const readerRef = useRef<HTMLElement>(null);
  const diagramCounter = useRef(0);
  // fixed for the life of the page: a book added meanwhile shows up on reload
  const [ids] = useState(sourceIds);
  const highlightStoreRef = useRef<HighlightStore>(emptyHighlights(ids));
  const progressRef = useRef<ProgressStore>(emptyProgress(ids));
  const completedStoreRef = useRef<CompletedStore>(emptyCompleted(ids));
  const freeSchemesRef = useRef<FreeScheme[]>([]);
  const mermaidStoreRef = useRef<MermaidStore>(DEFAULT_MERMAID_BY_CHAPTER);
  const sourceIdRef = useRef<SourceId>(initialSource.id);
  const serverReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceId, setSourceId] = useState<SourceId>(initialSource.id);
  const [progress, setProgress] = useState<ProgressStore>(() =>
    emptyProgress(ids),
  );
  const [completedUnits, setCompletedUnits] = useState<CompletedStore>(() =>
    emptyCompleted(ids),
  );
  const [freeSchemes, setFreeSchemes] = useState<FreeScheme[]>([]);
  const [activeFreeSchemeId, setActiveFreeSchemeId] = useState('');
  const [schemeDialogOpen, setSchemeDialogOpen] = useState(false);
  const [schemeDialogMode, setSchemeDialogMode] = useState<'create' | 'rename'>(
    'create',
  );
  const [schemeTitleDraft, setSchemeTitleDraft] = useState('');
  const [schemeToDelete, setSchemeToDelete] = useState<FreeScheme | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('visual');
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [mermaidHelpOpen, setMermaidHelpOpen] = useState(false);
  const [mermaidDrafts, setMermaidDrafts] = useState<MermaidStore>(
    DEFAULT_MERMAID_BY_CHAPTER,
  );
  const [savedMermaidByChapter, setSavedMermaidByChapter] =
    useState<MermaidStore>(DEFAULT_MERMAID_BY_CHAPTER);
  const [diagramSvg, setDiagramSvg] = useState('');
  const [diagramError, setDiagramError] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('checking');
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [accessError, setAccessError] = useState('');
  const [books, setBooks] = useState<Record<string, ReadingCollection>>({});
  const [bookStatus, setBookStatus] = useState<
    Record<string, 'idle' | 'loading' | 'ready' | 'error'>
  >({});
  const [unitIndexes, setUnitIndexes] = useState<Record<string, number>>({});

  const source = useMemo(
    () => sources.find((item) => item.id === sourceId) ?? sources[0],
    [sourceId, sources],
  );
  const studySourceId: StudySourceId | null =
    sourceId === 'free' ? null : sourceId;
  const activeFreeScheme =
    freeSchemes.find((scheme) => scheme.id === activeFreeSchemeId) ??
    freeSchemes[0] ??
    null;
  const isDark = theme === 'dark';
  const fallbackUnit = useMemo<ReadingUnit>(
    () => ({
      id: `${source.id}-default`,
      chapter: 0,
      section: 0,
      location: source.location,
      chapterLabel: source.chapter,
      heading: source.heading,
      blocks: source.paragraphs.map((text) => ({ kind: 'paragraph', text })),
    }),
    [source],
  );
  const isCollectionSource = source.readable;
  const activeCollection = books[sourceId] ?? null;
  // without the loaded book the reader would show the placeholder text
  const isBookUnavailable = isCollectionSource && !activeCollection;
  const activeLoadStatus = isCollectionSource
    ? (bookStatus[sourceId] ?? 'idle')
    : 'ready';
  const readingUnits = useMemo(
    () => activeCollection?.units ?? [fallbackUnit],
    [activeCollection, fallbackUnit],
  );
  const readingUnitIndex = isCollectionSource
    ? Math.min(unitIndexes[sourceId] ?? 0, readingUnits.length - 1)
    : 0;
  const readingUnit = readingUnits[readingUnitIndex] ?? fallbackUnit;
  const mermaidKey =
    sourceId === 'free'
      ? activeFreeScheme
        ? `free:${activeFreeScheme.id}`
        : 'free:none'
      : isCollectionSource
        ? `${sourceId}:${readingUnit.groupId ?? readingUnit.chapter}`
        : `${sourceId}:default`;
  const mermaidCode =
    mermaidDrafts[mermaidKey] ?? savedMermaidByChapter[mermaidKey] ?? '';
  const savedCode = savedMermaidByChapter[mermaidKey] ?? '';
  const completedUnitKey = isCollectionSource
    ? String(readingUnit.groupId ?? readingUnit.chapter)
    : readingUnit.id;
  const isReadingUnitCompleted = studySourceId
    ? (completedUnits[studySourceId]?.includes(completedUnitKey) ?? false)
    : false;

  const persistServerState = useCallback(async () => {
    if (!serverReadyRef.current) return;
    setSyncStatus('saving');
    try {
      const response = await fetch('/api/study-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          highlights: highlightStoreRef.current,
          progress: progressRef.current,
          completedUnits: completedStoreRef.current,
          freeSchemes: freeSchemesRef.current,
          mermaidByChapter: mermaidStoreRef.current,
          // the server keeps its data for books this page doesn't know
          knownSources: ids,
        }),
      });
      if (response.status === 401) {
        serverReadyRef.current = false;
        setSyncStatus('locked');
        return;
      }
      if (!response.ok) throw new Error('Server save failed');
      setSyncStatus('saved');
    } catch {
      setSyncStatus('error');
    }
  }, [ids]);

  const queueServerSave = useCallback(() => {
    if (!serverReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persistServerState(), 650);
  }, [persistServerState]);

  const loadServerState = useCallback(async () => {
    try {
      const response = await fetch('/api/study-state', { cache: 'no-store' });
      if (response.status === 401) {
        serverReadyRef.current = false;
        setSyncStatus('locked');
        return;
      }
      if (!response.ok) throw new Error('Server load failed');
      const payload = (await response.json()) as StudyStatePayload;
      const mergedHighlights = mergeHighlights(
        ids,
        payload.highlights,
        highlightStoreRef.current,
      );
      const mergedProgress = Object.fromEntries(
        ids.map((id) => [
          id,
          // without the defaults, an id unknown to either side would give NaN,
          // which the server then rejects as non-integer progress
          Math.max(payload.progress[id] ?? 0, progressRef.current[id] ?? 0),
        ]),
      ) as ProgressStore;
      const mergedCompletedUnits = mergeCompletedUnits(
        ids,
        payload.completedUnits ?? emptyCompleted(ids),
        completedStoreRef.current,
      );
      const mergedFreeSchemes = mergeFreeSchemes(
        payload.freeSchemes ?? [],
        freeSchemesRef.current,
      );
      const mergedMermaid = payload.initialized
        ? { ...mermaidStoreRef.current, ...payload.mermaidByChapter }
        : { ...payload.mermaidByChapter, ...mermaidStoreRef.current };
      const needsMigration =
        !payload.initialized ||
        JSON.stringify(mergedHighlights) !==
          JSON.stringify(payload.highlights) ||
        JSON.stringify(mergedProgress) !== JSON.stringify(payload.progress) ||
        JSON.stringify(mergedCompletedUnits) !==
          JSON.stringify(payload.completedUnits ?? emptyCompleted(ids)) ||
        JSON.stringify(mergedFreeSchemes) !==
          JSON.stringify(payload.freeSchemes ?? []) ||
        JSON.stringify(mergedMermaid) !==
          JSON.stringify(payload.mermaidByChapter);

      highlightStoreRef.current = mergedHighlights;
      progressRef.current = mergedProgress;
      completedStoreRef.current = mergedCompletedUnits;
      freeSchemesRef.current = mergedFreeSchemes;
      mermaidStoreRef.current = mergedMermaid;
      setHighlights(
        sourceIdRef.current === 'free'
          ? []
          : mergedHighlights[sourceIdRef.current],
      );
      setProgress(mergedProgress);
      setCompletedUnits(mergedCompletedUnits);
      setFreeSchemes(mergedFreeSchemes);
      setActiveFreeSchemeId((current) =>
        mergedFreeSchemes.some((scheme) => scheme.id === current)
          ? current
          : (mergedFreeSchemes[0]?.id ?? ''),
      );
      setMermaidDrafts(mergedMermaid);
      setSavedMermaidByChapter(mergedMermaid);
      window.localStorage.setItem(
        'studio:mermaid-by-chapter',
        JSON.stringify(mergedMermaid),
      );
      serverReadyRef.current = true;
      setSyncStatus('saved');
      if (needsMigration) await persistServerState();
    } catch {
      serverReadyRef.current = false;
      setSyncStatus('error');
    }
  }, [ids, persistServerState]);

  /* oxlint-disable react/react-compiler -- browser-only persisted state hydrates after mount */
  useEffect(() => {
    const cachedProgress = perSource<number>(
      ids,
      loadJson<unknown>('studio:progress', null),
      () => 0,
    ) as ProgressStore;
    progressRef.current = cachedProgress;
    setProgress(cachedProgress);
    const cachedCompleted = perSource<string[]>(
      ids,
      loadJson<unknown>('studio:completed-units', null),
      () => [],
    ) as CompletedStore;
    completedStoreRef.current = cachedCompleted;
    setCompletedUnits(cachedCompleted);
    const cachedFreeSchemes = loadJson<FreeScheme[]>('studio:free-schemes', []);
    freeSchemesRef.current = cachedFreeSchemes;
    setFreeSchemes(cachedFreeSchemes);
    setActiveFreeSchemeId(cachedFreeSchemes[0]?.id ?? '');
    const cachedHighlights = Object.fromEntries(
      ids.map((id) => [
        id,
        loadJson<Highlight[]>(`studio:highlights:${id}`, []),
      ]),
    ) as HighlightStore;
    highlightStoreRef.current = cachedHighlights;
    // those of the open source: this page is reached from any course
    setHighlights(cachedHighlights[sourceIdRef.current] ?? []);
    const cachedMermaid = loadJson<MermaidStore>(
      'studio:mermaid-by-chapter',
      {},
    );
    const localMermaid = { ...DEFAULT_MERMAID_BY_CHAPTER, ...cachedMermaid };
    mermaidStoreRef.current = localMermaid;
    setMermaidDrafts(localMermaid);
    setSavedMermaidByChapter(localMermaid);
    setTheme(
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );
    setHasLoaded(true);
  }, [ids]);
  /* oxlint-enable react/react-compiler */

  useEffect(() => {
    if (!hasLoaded) return;
    progressRef.current = progress;
    window.localStorage.setItem('studio:progress', JSON.stringify(progress));
    queueServerSave();
  }, [hasLoaded, progress, queueServerSave]);

  useEffect(() => {
    if (!hasLoaded) return;
    completedStoreRef.current = completedUnits;
    window.localStorage.setItem(
      'studio:completed-units',
      JSON.stringify(completedUnits),
    );
    queueServerSave();
  }, [completedUnits, hasLoaded, queueServerSave]);

  useEffect(() => {
    if (!hasLoaded) return;
    freeSchemesRef.current = freeSchemes;
    window.localStorage.setItem(
      'studio:free-schemes',
      JSON.stringify(freeSchemes),
    );
    queueServerSave();
  }, [freeSchemes, hasLoaded, queueServerSave]);

  useEffect(() => {
    if (!hasLoaded || sourceId === 'free') return;
    highlightStoreRef.current = {
      ...highlightStoreRef.current,
      [sourceId]: highlights,
    };
    window.localStorage.setItem(
      `studio:highlights:${sourceId}`,
      JSON.stringify(highlights),
    );
    queueServerSave();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [hasLoaded, highlights, queueServerSave, sourceId]);

  useEffect(() => {
    if (!hasLoaded) return;
    const initializeSync = async () => {
      try {
        const response = await fetch('/api/session', { cache: 'no-store' });
        const session = (await response.json()) as {
          configured: boolean;
          authenticated: boolean;
        };
        if (!session.configured) {
          setSyncStatus('unconfigured');
        } else if (!session.authenticated) {
          setSyncStatus('locked');
        } else {
          await loadServerState();
        }
      } catch {
        setSyncStatus('error');
      }
    };
    void initializeSync();
  }, [hasLoaded, loadServerState]);

  useEffect(() => {
    if (syncStatus !== 'saved' || !isCollectionSource) return;
    if (bookStatus[sourceId] && bookStatus[sourceId] !== 'idle') return;

    const loadBook = async () => {
      setBookStatus((prev) => ({ ...prev, [sourceId]: 'loading' }));
      try {
        const response = await fetch(`/api/books/${sourceId}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Book load failed');
        const payload = (await response.json()) as ReadingCollection;
        setBooks((prev) => ({ ...prev, [sourceId]: payload }));
        setBookStatus((prev) => ({ ...prev, [sourceId]: 'ready' }));
      } catch {
        setBookStatus((prev) => ({ ...prev, [sourceId]: 'error' }));
      }
    };
    void loadBook();
  }, [bookStatus, isCollectionSource, sourceId, syncStatus]);

  useEffect(() => {
    if (!hasLoaded) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('studio:theme', theme);
  }, [hasLoaded, theme]);

  const renderDiagram = useCallback(async () => {
    if (!mermaidCode.trim()) {
      setDiagramSvg('');
      setDiagramError('');
      return;
    }
    setIsRendering(true);
    setDiagramError('');
    try {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        htmlLabels: true,
        fontFamily: 'Open Sans, sans-serif',
        themeVariables: {
          primaryColor: isDark ? '#303230' : '#efefec',
          primaryTextColor: isDark ? '#eeeeec' : '#2b2d2c',
          primaryBorderColor: isDark ? '#858987' : '#8a8d8b',
          lineColor: isDark ? '#a3a7a4' : '#737775',
          secondaryColor: isDark ? '#393b39' : '#dedfdd',
          tertiaryColor: isDark ? '#222322' : '#f5f5f2',
          edgeLabelBackground: isDark ? '#1d1e1d' : '#fafaf8',
          fontSize: '15px',
        },
        flowchart: { curve: 'basis' },
      });
      diagramCounter.current += 1;
      const result = await mermaid.render(
        `study-map-${diagramCounter.current}`,
        mermaidCode,
      );
      setDiagramSvg(result.svg);
    } catch (error) {
      setDiagramSvg('');
      setDiagramError(
        error instanceof Error
          ? error.message.split('\n')[0]
          : 'The Mermaid syntax contains an error.',
      );
    } finally {
      setIsRendering(false);
    }
  }, [isDark, mermaidCode]);

  /* oxlint-disable react/react-compiler -- rendering Mermaid is an external-system synchronization */
  useEffect(() => {
    if (editorMode === 'visual') void renderDiagram();
  }, [editorMode, renderDiagram]);
  /* oxlint-enable react/react-compiler */

  const saveMermaid = useCallback(() => {
    if (sourceId === 'free' && !activeFreeScheme) return;
    const nextStore = {
      ...mermaidStoreRef.current,
      [mermaidKey]: mermaidCode,
    };
    mermaidStoreRef.current = nextStore;
    setMermaidDrafts((current) => ({ ...current, [mermaidKey]: mermaidCode }));
    setSavedMermaidByChapter(nextStore);
    window.localStorage.setItem(
      'studio:mermaid-by-chapter',
      JSON.stringify(nextStore),
    );
    if (sourceId === 'free' && activeFreeScheme) {
      const updatedAt = new Date().toISOString();
      setFreeSchemes((current) =>
        current.map((scheme) =>
          scheme.id === activeFreeScheme.id ? { ...scheme, updatedAt } : scheme,
        ),
      );
    }
    if (serverReadyRef.current) void persistServerState();
  }, [activeFreeScheme, mermaidCode, mermaidKey, persistServerState, sourceId]);

  const toggleEditor = useCallback(() => {
    setEditorMode((current) => (current === 'visual' ? 'code' : 'visual'));
  }, []);

  const updateDiagramZoom = useCallback((delta: number) => {
    setDiagramZoom((current) =>
      Math.min(
        MAX_DIAGRAM_ZOOM,
        Math.max(MIN_DIAGRAM_ZOOM, Number((current + delta).toFixed(1))),
      ),
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key === 'Enter') {
        event.preventDefault();
        toggleEditor();
      }
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveMermaid();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveMermaid, toggleEditor]);

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!selection || !range || selection.isCollapsed || !readerRef.current)
      return;

    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    const startParagraph = startElement?.closest<HTMLElement>(
      '[data-paragraph-id]',
    );
    const endParagraph = endElement?.closest<HTMLElement>(
      '[data-paragraph-id]',
    );

    if (!startParagraph || !endParagraph || startParagraph !== endParagraph) {
      setPendingSelection(null);
      return;
    }

    const prefix = document.createRange();
    prefix.selectNodeContents(startParagraph);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const quote = range.toString();
    const rect = range.getBoundingClientRect();

    setPendingSelection({
      unitId: readingUnit.id,
      paragraph: Number(startParagraph.dataset.paragraphId),
      start,
      end: start + quote.length,
      quote,
      x: Math.min(
        Math.max(rect.left + rect.width / 2, 96),
        window.innerWidth - 96,
      ),
      y: Math.max(rect.top - 12, 64),
    });
  }, [readingUnit.id]);

  const addHighlight = useCallback(
    (color: HighlightColor) => {
      if (!pendingSelection) return;
      const nextHighlight: Highlight = {
        id: `${Date.now()}-${pendingSelection.paragraph}`,
        unitId: pendingSelection.unitId,
        paragraph: pendingSelection.paragraph,
        start: pendingSelection.start,
        end: pendingSelection.end,
        color,
        quote: pendingSelection.quote,
      };
      setHighlights((current) => [
        ...current.filter(
          (item) =>
            item.paragraph !== nextHighlight.paragraph ||
            item.end <= nextHighlight.start ||
            item.start >= nextHighlight.end,
        ),
        nextHighlight,
      ]);
      window.getSelection()?.removeAllRanges();
      setPendingSelection(null);
    },
    [pendingSelection],
  );

  const removeHighlight = useCallback((id: string) => {
    setHighlights((current) => current.filter((item) => item.id !== id));
  }, []);

  const updateProgress = useCallback(
    (delta: number) => {
      if (!studySourceId) return;
      setProgress((current) => ({
        ...current,
        [studySourceId]: Math.min(
          source.total,
          Math.max(0, current[studySourceId] + delta),
        ),
      }));
    },
    [source.total, studySourceId],
  );

  const changeSource = useCallback(
    (nextSource: SourceId) => {
      sourceIdRef.current = nextSource;
      setHighlights(
        nextSource === 'free'
          ? []
          : (highlightStoreRef.current[nextSource] ?? []),
      );
      setPendingSelection(null);
      setSourceId(nextSource);
      router.push(`/${course.slug}/${nextSource}`);
    },
    [course.slug, router],
  );

  const toggleReadingUnitCompleted = useCallback(() => {
    if (!studySourceId) return;
    setCompletedUnits((current) => {
      const isCompleted = (current[studySourceId] ?? []).includes(
        completedUnitKey,
      );
      const next = {
        ...current,
        [studySourceId]: isCompleted
          ? (current[studySourceId] ?? []).filter(
              (key) => key !== completedUnitKey,
            )
          : [...(current[studySourceId] ?? []), completedUnitKey],
      };
      completedStoreRef.current = next;
      // with pages, progress is moved by hand: ticked chapters aren't pages
      if (source.unit !== 'pages') {
        setProgress((progressState) => ({
          ...progressState,
          [studySourceId]: next[studySourceId].length,
        }));
      }
      return next;
    });
  }, [completedUnitKey, source.unit, studySourceId]);

  const openCreateScheme = useCallback(() => {
    setSchemeDialogMode('create');
    setSchemeTitleDraft('');
    setSchemeDialogOpen(true);
  }, []);

  const openRenameScheme = useCallback((scheme: FreeScheme) => {
    setActiveFreeSchemeId(scheme.id);
    setSchemeDialogMode('rename');
    setSchemeTitleDraft(scheme.title);
    setSchemeDialogOpen(true);
  }, []);

  const submitSchemeDialog = useCallback(() => {
    const title = schemeTitleDraft.trim();
    if (!title) return;
    const now = new Date().toISOString();

    if (schemeDialogMode === 'create') {
      const scheme: FreeScheme = {
        id: crypto.randomUUID(),
        title,
        createdAt: now,
        updatedAt: now,
      };
      const nextSchemes = [scheme, ...freeSchemesRef.current];
      const key = `free:${scheme.id}`;
      const nextMermaid = {
        ...mermaidStoreRef.current,
        [key]: FREE_SCHEME_STARTER,
      };
      freeSchemesRef.current = nextSchemes;
      mermaidStoreRef.current = nextMermaid;
      setFreeSchemes(nextSchemes);
      setActiveFreeSchemeId(scheme.id);
      setMermaidDrafts(nextMermaid);
      setSavedMermaidByChapter(nextMermaid);
      window.localStorage.setItem(
        'studio:mermaid-by-chapter',
        JSON.stringify(nextMermaid),
      );
      setEditorMode('code');
    } else if (activeFreeScheme) {
      const nextSchemes = freeSchemesRef.current.map((scheme) =>
        scheme.id === activeFreeScheme.id
          ? { ...scheme, title, updatedAt: now }
          : scheme,
      );
      freeSchemesRef.current = nextSchemes;
      setFreeSchemes(nextSchemes);
    }

    setSchemeDialogOpen(false);
    setSchemeTitleDraft('');
    queueServerSave();
  }, [activeFreeScheme, queueServerSave, schemeDialogMode, schemeTitleDraft]);

  const deleteFreeScheme = useCallback(() => {
    if (!schemeToDelete) return;
    const key = `free:${schemeToDelete.id}`;
    const nextSchemes = freeSchemesRef.current.filter(
      (scheme) => scheme.id !== schemeToDelete.id,
    );
    const nextMermaid = { ...mermaidStoreRef.current };
    delete nextMermaid[key];
    freeSchemesRef.current = nextSchemes;
    mermaidStoreRef.current = nextMermaid;
    setFreeSchemes(nextSchemes);
    setMermaidDrafts(nextMermaid);
    setSavedMermaidByChapter(nextMermaid);
    setActiveFreeSchemeId((current) =>
      current === schemeToDelete.id ? (nextSchemes[0]?.id ?? '') : current,
    );
    window.localStorage.setItem(
      'studio:mermaid-by-chapter',
      JSON.stringify(nextMermaid),
    );
    setSchemeToDelete(null);
    queueServerSave();
  }, [queueServerSave, schemeToDelete]);

  const changeReadingUnit = useCallback(
    (unitId: string) => {
      const nextIndex = readingUnits.findIndex((unit) => unit.id === unitId);
      if (nextIndex < 0 || !isCollectionSource) return;
      setUnitIndexes((prev) => ({ ...prev, [sourceId]: nextIndex }));
      setPendingSelection(null);
    },
    [isCollectionSource, readingUnits, sourceId],
  );

  const navigateReadingUnit = useCallback(
    (delta: number) => {
      if (!isCollectionSource) return;
      setUnitIndexes((prev) => ({
        ...prev,
        [sourceId]: Math.min(
          readingUnits.length - 1,
          Math.max(0, (prev[sourceId] ?? 0) + delta),
        ),
      }));
      setPendingSelection(null);
    },
    [isCollectionSource, readingUnits.length, sourceId],
  );

  const connectServer = useCallback(async () => {
    if (!accessKey.trim()) return;
    setAccessError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setAccessError(payload?.error ?? 'Unable to connect to the server.');
        return;
      }
      setAccessKey('');
      setSyncDialogOpen(false);
      await loadServerState();
    } catch {
      setAccessError('The server is unreachable.');
    }
  }, [accessKey, loadServerState]);

  const renderParagraph = useCallback(
    (text: string, paragraph: number) => {
      const paragraphHighlights = highlights
        .filter((item) => {
          const legacyUnitId = `${sourceId}-default`;
          return (
            item.paragraph === paragraph &&
            (item.unitId ?? legacyUnitId) === readingUnit.id
          );
        })
        .sort((a, b) => a.start - b.start);
      if (!paragraphHighlights.length) return text;

      const parts = [];
      let cursor = 0;
      for (const item of paragraphHighlights) {
        parts.push(
          <Fragment key={`${item.id}-before`}>
            {text.slice(cursor, item.start)}
          </Fragment>,
        );
        parts.push(
          <button
            key={item.id}
            type="button"
            title="Click to remove the highlight"
            className={`inline cursor-pointer rounded-[0.18em] px-[0.08em] font-inherit text-inherit underline decoration-1 underline-offset-4 transition-opacity hover:opacity-75 ${HIGHLIGHT_CLASSES[item.color]}`}
            onClick={() => removeHighlight(item.id)}
          >
            {text.slice(item.start, item.end)}
          </button>,
        );
        cursor = item.end;
      }
      parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
      return parts;
    },
    [highlights, readingUnit.id, removeHighlight, sourceId],
  );

  const readingUnitHighlightCount = useMemo(() => {
    const legacyUnitId = `${sourceId}-default`;
    return highlights.filter(
      (item) => (item.unitId ?? legacyUnitId) === readingUnit.id,
    ).length;
  }, [highlights, readingUnit.id, sourceId]);

  const renderReadingBlock = (block: ReadingBlock, index: number) => {
    if (block.kind === 'video') {
      // nocookie: no cookies until play is pressed
      const embedUrl = block.youtubeId
        ? `https://www.youtube-nocookie.com/embed/${block.youtubeId}?rel=0`
        : null;
      return (
        <figure
          key={`${readingUnit.id}-${index}`}
          className="my-10 overflow-hidden rounded-xl border border-line bg-card/50 p-3"
        >
          {embedUrl ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                src={embedUrl}
                title={block.alt || 'Video from the textbook'}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          ) : block.src ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- teaching material without captions
            <video
              src={block.src}
              controls
              preload="none"
              className="mx-auto max-h-[70vh] w-full rounded-lg"
            />
          ) : (
            <p className="p-4 text-center font-ui text-sm text-muted-ink">
              Video not linked yet.
            </p>
          )}
          {block.alt ? (
            <figcaption className="mt-2 text-center font-ui text-xs text-muted-ink">
              {block.alt}
            </figcaption>
          ) : null}
        </figure>
      );
    }

    if (block.kind === 'image' && block.src) {
      return (
        <figure
          key={`${readingUnit.id}-${index}`}
          className="my-10 overflow-hidden rounded-xl border border-line bg-card/50 p-3"
        >
          {/* oxlint-disable-next-line next/no-img-element -- authenticated media cannot be fetched by the image optimizer */}
          <img
            src={block.src}
            alt={block.alt ?? 'Image from the textbook'}
            className="mx-auto h-auto max-h-[70vh] max-w-full rounded-lg object-contain"
          />
        </figure>
      );
    }

    const text = block.text ?? '';
    const content = renderParagraph(text, index);
    const dataAttributes = {
      'data-paragraph-id': index,
    };
    if (block.kind === 'heading') {
      return (
        <h2
          key={`${readingUnit.id}-${index}`}
          {...dataAttributes}
          className="pt-5 font-heading text-[1.45em] font-medium leading-tight tracking-[-0.02em] text-ink"
        >
          {content}
        </h2>
      );
    }
    if (block.kind === 'quote') {
      return (
        <blockquote
          key={`${readingUnit.id}-${index}`}
          {...dataAttributes}
          className="border-l-2 border-accent-strong pl-5 italic text-muted-ink"
        >
          {content}
        </blockquote>
      );
    }
    if (block.kind === 'list') {
      return (
        <p
          key={`${readingUnit.id}-${index}`}
          {...dataAttributes}
          className="pl-6 before:-ml-5 before:mr-3 before:content-['—']"
        >
          {content}
        </p>
      );
    }
    if (block.kind === 'caption') {
      return (
        <p
          key={`${readingUnit.id}-${index}`}
          {...dataAttributes}
          className="-mt-4 font-ui text-[0.72em] leading-relaxed text-muted-ink"
        >
          {content}
        </p>
      );
    }
    return (
      <p key={`${readingUnit.id}-${index}`} {...dataAttributes}>
        {content}
      </p>
    );
  };

  const readerPanel = (
    <section
      className="flex h-full min-h-0 flex-col bg-paper"
      aria-label="Text to study"
    >
      <div className="flex min-h-[68px] items-center justify-between gap-4 border-b border-line/80 px-5 py-3 md:px-7">
        <div className="min-w-0">
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-ink">
            {isBookUnavailable ? (
              'Book not loaded'
            ) : (
              <>
                {readingUnit.chapterLabel} · {readingUnit.location}
              </>
            )}
          </p>
          <p className="mt-1 truncate font-heading text-[17px] font-medium text-ink">
            {source.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={isReadingUnitCompleted ? 'secondary' : 'outline'}
            size="sm"
            onClick={toggleReadingUnitCompleted}
            disabled={isBookUnavailable}
            aria-pressed={isReadingUnitCompleted}
            className={
              isReadingUnitCompleted
                ? 'border border-line text-ink'
                : 'text-muted-ink'
            }
          >
            <CircleCheck />
            <span className="hidden lg:inline">
              {isReadingUnitCompleted ? 'Done' : 'Mark done'}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous section"
            onClick={() => navigateReadingUnit(-1)}
            disabled={!isCollectionSource || readingUnitIndex === 0}
          >
            <ChevronLeft />
          </Button>
          {isCollectionSource && activeCollection ? (
            <Select
              value={readingUnit.id}
              onValueChange={(value) => value && changeReadingUnit(value)}
            >
              <SelectTrigger className="h-8 w-[min(38vw,250px)] border-line bg-card/60 px-2 text-xs">
                <SelectValue>
                  {`${readingUnit.location} · ${readingUnit.heading}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {readingUnits.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {`${unit.location} · ${unit.heading}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="min-w-14 text-center font-ui text-xs tabular-nums text-muted-ink">
              {activeLoadStatus === 'loading' && isCollectionSource
                ? 'Loading…'
                : readingUnit.location}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next section"
            onClick={() => navigateReadingUnit(1)}
            disabled={
              !isCollectionSource || readingUnitIndex >= readingUnits.length - 1
            }
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <article
        ref={readerRef}
        onPointerUp={captureSelection}
        className="reader-scroll min-h-0 flex-1 overflow-y-auto px-6 py-9 md:px-[clamp(2rem,5vw,5.5rem)] md:py-12"
      >
        {isBookUnavailable ? (
          <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center px-6 text-center">
            <span className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl border border-line bg-card/70 text-muted-ink shadow-sm">
              {syncStatus === 'locked' ? (
                <LockKeyhole className="size-5" />
              ) : syncStatus === 'unconfigured' ||
                syncStatus === 'error' ||
                activeLoadStatus === 'error' ? (
                <CloudOff className="size-5" />
              ) : (
                <LoaderCircle className="size-5 animate-spin" />
              )}
            </span>
            <h2 className="font-heading text-xl font-medium text-ink">
              {syncStatus === 'locked'
                ? 'Book locked'
                : syncStatus === 'unconfigured'
                  ? 'Server needs setup'
                  : syncStatus === 'error' || activeLoadStatus === 'error'
                    ? 'Book unavailable'
                    : 'Loading the book…'}
            </h2>
            <p className="mt-2 font-ui text-sm leading-6 text-muted-ink">
              {syncStatus === 'locked'
                ? `The chapters of “${source.title}” are on the server. Enter the sync key to open them on this device.`
                : syncStatus === 'unconfigured'
                  ? 'The server is not set up to store books yet.'
                  : syncStatus === 'error' || activeLoadStatus === 'error'
                    ? `Can’t load “${source.title}”. Check your connection and reload the page to try again.`
                    : `Fetching “${source.title}” from the server.`}
            </p>
            {syncStatus === 'locked' && (
              <Button className="mt-5" onClick={() => setSyncDialogOpen(true)}>
                <LockKeyhole /> Enter the key
              </Button>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-[680px]">
            <div className="mb-10 flex items-center gap-3 font-ui text-xs text-muted-ink">
              <span className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-card/60">
                <BookOpen className="size-4" />
              </span>
              <span>{readingUnit.author ?? source.author}</span>
            </div>
            <h1 className="text-balance font-heading text-[clamp(2rem,3.4vw,3.65rem)] font-medium leading-[1.02] tracking-[-0.035em] text-ink">
              {readingUnit.heading}
            </h1>
            <div className="mt-8 h-px w-16 bg-accent-strong" />
            <div className="mt-9 space-y-7 font-reading text-[clamp(1.12rem,1.4vw,1.34rem)] leading-[1.82] text-reading-ink">
              {readingUnit.blocks.map(renderReadingBlock)}
            </div>
            <div className="mt-14 flex items-center justify-between border-t border-line/80 pt-6 font-ui text-xs text-muted-ink">
              <span>Select a sentence to highlight it</span>
              <span>
                {readingUnitHighlightCount}{' '}
                {readingUnitHighlightCount === 1 ? 'highlight' : 'highlights'}{' '}
                in this section
              </span>
            </div>
          </div>
        )}
      </article>
    </section>
  );

  const freeSchemesPanel = (
    <section
      className="flex h-full min-h-0 flex-col bg-paper"
      aria-label="Free diagram library"
    >
      <div className="flex min-h-[68px] items-center justify-between gap-4 border-b border-line/80 px-5 py-3 md:px-7">
        <div className="min-w-0">
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-ink">
            Personal library
          </p>
          <p className="mt-1 truncate font-heading text-[17px] font-medium text-ink">
            Free diagrams
          </p>
        </div>
        <Button size="sm" onClick={openCreateScheme}>
          <FilePlus2 /> New diagram
        </Button>
      </div>

      <div className="reader-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-7 md:py-8">
        {freeSchemes.length === 0 ? (
          <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center px-6 text-center">
            <span className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl border border-line bg-card/70 text-muted-ink shadow-sm">
              <Workflow className="size-5" />
            </span>
            <h2 className="font-heading text-xl font-medium text-ink">
              A space for your ideas
            </h2>
            <p className="mt-2 font-ui text-sm leading-6 text-muted-ink">
              Create Mermaid maps that aren’t tied to a book. Every diagram is
              saved to the server.
            </p>
            <Button className="mt-5" onClick={openCreateScheme}>
              <FilePlus2 /> Create the first diagram
            </Button>
          </div>
        ) : (
          <div className="mx-auto grid max-w-2xl gap-3">
            {freeSchemes.map((scheme) => {
              const isActive = scheme.id === activeFreeScheme?.id;
              return (
                <div
                  key={scheme.id}
                  className={`group flex items-center gap-2 rounded-xl border p-2 transition-colors ${
                    isActive
                      ? 'border-accent-strong bg-secondary/75'
                      : 'border-line bg-card/55 hover:bg-card'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFreeSchemeId(scheme.id)}
                    className="min-w-0 flex-1 rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className="block truncate font-heading text-base font-medium text-ink">
                      {scheme.title}
                    </span>
                    <span className="mt-1 block font-ui text-[11px] text-muted-ink">
                      Edited{' '}
                      {new Intl.DateTimeFormat('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      }).format(new Date(scheme.updatedAt))}
                    </span>
                  </button>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Rename ${scheme.title}`}
                          onClick={() => openRenameScheme(scheme)}
                        />
                      }
                    >
                      <Pencil />
                    </TooltipTrigger>
                    <TooltipContent>Rename</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${scheme.title}`}
                          onClick={() => setSchemeToDelete(scheme)}
                        />
                      }
                    >
                      <Trash2 />
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex min-h-11 items-center justify-between border-t border-line/80 px-5 font-ui text-[11px] text-muted-ink md:px-7">
        <span>
          {freeSchemes.length}{' '}
          {freeSchemes.length === 1 ? 'diagram' : 'diagrams'}
        </span>
        <span>Private sync</span>
      </div>
    </section>
  );

  const editorPanel = (
    <section
      className="flex h-full min-h-0 flex-col bg-workspace"
      aria-label="Mermaid map editor"
    >
      <div className="flex min-h-[68px] items-center justify-between gap-3 border-b border-workspace-line px-4 py-3 md:px-5">
        <div className="min-w-0">
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-workspace-muted">
            {sourceId === 'free' ? 'Free diagram' : 'Linked diagram'}
          </p>
          <p className="mt-1 truncate font-heading text-[17px] font-medium text-workspace-ink">
            {sourceId === 'free'
              ? (activeFreeScheme?.title ?? 'No diagram')
              : readingUnit.chapterLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-lg border border-workspace-line bg-card/55 p-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditorMode('visual')}
              className={
                editorMode === 'visual'
                  ? 'bg-card shadow-xs'
                  : 'text-workspace-muted'
              }
              aria-pressed={editorMode === 'visual'}
            >
              <Eye />
              <span className="hidden sm:inline">Map</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditorMode('code')}
              className={
                editorMode === 'code'
                  ? 'bg-card shadow-xs'
                  : 'text-workspace-muted'
              }
              aria-pressed={editorMode === 'code'}
            >
              <Code2 />
              <span className="hidden sm:inline">Code</span>
            </Button>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Open the Mermaid quick guide"
                  onClick={() => setMermaidHelpOpen(true)}
                />
              }
            >
              <CircleHelp />
            </TooltipTrigger>
            <TooltipContent>Mermaid quick guide</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Save the map"
                  onClick={saveMermaid}
                  disabled={sourceId === 'free' && !activeFreeScheme}
                />
              }
            >
              {mermaidCode === savedCode ? <Check /> : <Save />}
            </TooltipTrigger>
            <TooltipContent>
              Save map <span className="ml-1 opacity-70">⌘/Ctrl S</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {editorMode === 'code' ? (
          <div className="flex h-full min-h-0 flex-col p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between font-ui text-xs text-workspace-muted">
              <span>Mermaid</span>
              <span>
                {mermaidCode === savedCode ? 'Saved' : 'Unsaved changes'}
              </span>
            </div>
            <Textarea
              value={mermaidCode}
              onChange={(event) =>
                setMermaidDrafts((current) => ({
                  ...current,
                  [mermaidKey]: event.target.value,
                }))
              }
              spellCheck={false}
              aria-label="Mermaid code"
              className="min-h-0 flex-1 resize-none rounded-xl border-workspace-line bg-[#292b2a] px-5 py-5 font-mono text-[14px] leading-7 text-[#eceeec] caret-[#f3d76d] shadow-inner focus-visible:border-accent-strong focus-visible:ring-accent-strong/20"
            />
          </div>
        ) : (
          <div className="relative h-full min-h-[390px] overflow-hidden">
            <div
              className="absolute inset-0 map-grid opacity-45"
              aria-hidden="true"
            />
            <div className="absolute right-4 top-4 z-10 flex items-center gap-0.5 rounded-lg border border-workspace-line bg-card/85 p-1 shadow-sm backdrop-blur">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Zoom out of the map"
                      onClick={() => updateDiagramZoom(-DIAGRAM_ZOOM_STEP)}
                      disabled={diagramZoom <= MIN_DIAGRAM_ZOOM}
                    />
                  }
                >
                  <ZoomOut />
                </TooltipTrigger>
                <TooltipContent>Zoom out</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                className="min-w-14 px-1.5 text-[11px] tabular-nums"
                aria-label="Reset zoom to 100%"
                onClick={() => setDiagramZoom(1)}
              >
                {Math.round(diagramZoom * 100)}%
              </Button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Zoom into the map"
                      onClick={() => updateDiagramZoom(DIAGRAM_ZOOM_STEP)}
                      disabled={diagramZoom >= MAX_DIAGRAM_ZOOM}
                    />
                  }
                >
                  <ZoomIn />
                </TooltipTrigger>
                <TooltipContent>Zoom in</TooltipContent>
              </Tooltip>
            </div>
            <div
              className={`relative flex h-full overflow-auto p-7 md:p-10 ${
                diagramZoom > 1
                  ? 'items-start justify-start'
                  : 'items-center justify-center'
              }`}
            >
              {isRendering ? (
                <div className="relative flex flex-col items-center gap-3 font-ui text-sm text-workspace-muted">
                  <Sparkles className="size-5 animate-pulse" />
                  Drawing the map…
                </div>
              ) : !mermaidCode.trim() ? (
                <div className="relative flex max-w-sm flex-col items-center text-center font-ui text-sm text-workspace-muted">
                  <Code2 className="mb-3 size-6" />
                  <p className="font-semibold text-workspace-ink">
                    {sourceId === 'free'
                      ? 'This diagram is still empty.'
                      : readingUnit.chapterLabel
                        ? `No diagram for ${readingUnit.chapterLabel}.`
                        : 'No diagram for this chapter yet.'}
                  </p>
                  <p className="mt-1 leading-6">
                    {sourceId === 'free'
                      ? 'Write Mermaid code to start building the map.'
                      : 'Create a Mermaid map: it stays linked to this chapter.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setEditorMode('code')}
                    disabled={sourceId === 'free' && !activeFreeScheme}
                  >
                    <Code2 /> Create the diagram
                  </Button>
                </div>
              ) : diagramError ? (
                <div className="relative max-w-md rounded-xl border border-[#bb735f]/30 bg-[#fff5f1] p-5 font-ui text-sm leading-6 text-[#8b3c28] dark:bg-[#3b2924] dark:text-[#f2b7a7]">
                  <p className="font-semibold">The map can’t be rendered.</p>
                  <p className="mt-1 opacity-80">{diagramError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setEditorMode('code')}
                  >
                    <Code2 /> Fix the code
                  </Button>
                </div>
              ) : (
                <div
                  className="mermaid-output relative shrink-0 rounded-2xl border border-workspace-line bg-card/72 p-5 shadow-[0_24px_70px_rgba(34,54,48,0.08)] backdrop-blur md:p-8 dark:shadow-[0_24px_70px_rgba(0,0,0,0.22)]"
                  style={
                    {
                      width: `${diagramZoom * 100}%`,
                      maxWidth: `${720 * diagramZoom}px`,
                      '--diagram-max-height': `min(${62 * diagramZoom}vh, ${700 * diagramZoom}px)`,
                      '--diagram-mobile-max-height': `${34 * diagramZoom}vh`,
                    } as CSSProperties
                  }
                  dangerouslySetInnerHTML={{ __html: diagramSvg }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-workspace-line px-4 font-ui text-[11px] text-workspace-muted md:px-5">
        <span className="truncate">
          <kbd className="kbd">⌘/Ctrl</kbd> + <kbd className="kbd">Enter</kbd>{' '}
          switches view
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {syncStatus === 'saving' || syncStatus === 'checking' ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : syncStatus === 'saved' ? (
            <Cloud className="size-3" />
          ) : (
            <CloudOff className="size-3" />
          )}
          {SYNC_LABELS[syncStatus]}
        </span>
      </div>
    </section>
  );

  return (
    <TooltipProvider>
      <main className="flex h-dvh min-h-[640px] flex-col overflow-hidden bg-background font-ui text-ink">
        <header className="flex min-h-[76px] items-center gap-4 border-b border-line bg-paper px-4 md:px-6">
          {/* the way out of the reader: the logo goes back to the courses,
              the line below to this course's index. Without them, the only
              way out of a book is the browser's Back button. */}
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/"
              aria-label="All courses"
              className="flex size-9 shrink-0 overflow-hidden rounded-[22%] shadow-sm transition-opacity hover:opacity-80"
            >
              <Image src="/icon.svg" alt="" width={36} height={36} priority />
            </Link>
            <div className="hidden sm:block">
              <Link
                href="/"
                className="font-heading text-[18px] font-semibold leading-none tracking-[-0.025em] transition-colors hover:text-accent-strong"
              >
                InkBeacon
              </Link>
              <Link
                href={`/${course.slug}`}
                className="mt-1 block max-w-[200px] truncate text-[10px] uppercase tracking-[0.16em] text-muted-ink transition-colors hover:text-ink"
              >
                {course.name}
              </Link>
            </div>
          </div>

          <div className="mx-auto flex min-w-0 max-w-[760px] flex-1 items-center gap-3 md:gap-5">
            <Select
              value={sourceId}
              onValueChange={(value) =>
                value && changeSource(value as SourceId)
              }
            >
              <SelectTrigger className="h-10 min-w-0 flex-1 border-line bg-card/70 px-3 md:max-w-[310px]">
                <SelectValue>{source.shortTitle}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                {sources.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.shortTitle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {studySourceId ? (
              <div className="hidden min-w-0 flex-1 md:block">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-ink">
                  <span>Source progress</span>
                  <span className="tabular-nums">
                    {progress[studySourceId]} / {source.total} {source.unit}
                  </span>
                </div>
                <Progress
                  value={(progress[studySourceId] / source.total) * 100}
                  className="[&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-secondary [&_[data-slot=progress-indicator]]:bg-accent-strong"
                />
              </div>
            ) : (
              <div className="hidden min-w-0 flex-1 md:block">
                <p className="truncate text-[11px] text-muted-ink">
                  {freeSchemes.length}{' '}
                  {freeSchemes.length === 1
                    ? 'personal diagram'
                    : 'personal diagrams'}
                </p>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={
                      isDark ? 'Switch to light mode' : 'Switch to dark mode'
                    }
                    onClick={() =>
                      setTheme((current) =>
                        current === 'dark' ? 'light' : 'dark',
                      )
                    }
                  />
                }
              >
                {isDark ? <Sun /> : <Moon />}
              </TooltipTrigger>
              <TooltipContent>
                {isDark ? 'Light mode' : 'Dark mode'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={SYNC_LABELS[syncStatus]}
                    onClick={() => setSyncDialogOpen(true)}
                  />
                }
              >
                {syncStatus === 'checking' || syncStatus === 'saving' ? (
                  <LoaderCircle className="animate-spin" />
                ) : syncStatus === 'saved' ? (
                  <Cloud />
                ) : syncStatus === 'locked' ? (
                  <LockKeyhole />
                ) : (
                  <CloudOff />
                )}
              </TooltipTrigger>
              <TooltipContent>{SYNC_LABELS[syncStatus]}</TooltipContent>
            </Tooltip>

            {studySourceId && (
              <div className="flex items-center gap-1 rounded-lg border border-line bg-card/70 p-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => updateProgress(-1)}
                  disabled={progress[studySourceId] === 0}
                  aria-label="Decrease progress"
                >
                  <Minus />
                </Button>
                <span className="min-w-9 text-center text-xs font-semibold tabular-nums md:min-w-12">
                  {Math.round((progress[studySourceId] / source.total) * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => updateProgress(1)}
                  disabled={progress[studySourceId] === source.total}
                  aria-label="Increase progress"
                >
                  <Plus />
                </Button>
              </div>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <ResizablePanelGroup
            orientation={isMobile ? 'vertical' : 'horizontal'}
          >
            <ResizablePanel defaultSize={isMobile ? 56 : 54} minSize={30}>
              {sourceId === 'free' ? freeSchemesPanel : readerPanel}
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-line" />
            <ResizablePanel defaultSize={isMobile ? 44 : 46} minSize={28}>
              {editorPanel}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {pendingSelection && (
          <div
            className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-xl border border-black/15 bg-[#292b2a] p-1.5 shadow-xl"
            style={{ left: pendingSelection.x, top: pendingSelection.y }}
            role="toolbar"
            aria-label="Choose the highlight colour"
          >
            {COLOR_BUTTONS.map((item) => (
              <button
                key={item.color}
                type="button"
                onClick={() => addHighlight(item.color)}
                className={`size-6 rounded-md border-2 border-white/80 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${item.className}`}
                aria-label={`Highlight in ${item.label.toLowerCase()}`}
              />
            ))}
          </div>
        )}
      </main>

      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {syncStatus === 'unconfigured'
                ? 'Sync not set up yet'
                : 'Study data on the server'}
            </DialogTitle>
            <DialogDescription>
              {syncStatus === 'unconfigured'
                ? 'The app is ready. All that’s missing is a connection to a private Vercel Blob store and the project’s personal key.'
                : syncStatus === 'saved' || syncStatus === 'saving'
                  ? 'Highlights, completed chapters, progress and Mermaid diagrams are synced to a private space on Vercel. The local copy is only an offline cache.'
                  : 'Enter the personal key once on this device. It will be kept in a secure cookie, not in the site’s code.'}
            </DialogDescription>
          </DialogHeader>

          {syncStatus !== 'unconfigured' &&
            syncStatus !== 'saved' &&
            syncStatus !== 'saving' && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void connectServer();
                }}
              >
                <Input
                  type="password"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  placeholder="Sync key"
                  autoComplete="current-password"
                  aria-label="Sync key"
                />
                {accessError && (
                  <p className="text-xs text-destructive">{accessError}</p>
                )}
                <DialogFooter className="mx-0 -mb-4">
                  <Button type="submit" disabled={!accessKey.trim()}>
                    <Cloud /> Connect
                  </Button>
                </DialogFooter>
              </form>
            )}
        </DialogContent>
      </Dialog>

      <Dialog open={mermaidHelpOpen} onOpenChange={setMermaidHelpOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mermaid quick guide</DialogTitle>
            <DialogDescription>
              The most useful shapes and links for building a concept map with
              flowcharts.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 font-ui text-sm sm:grid-cols-2">
            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Structure and direction
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`flowchart LR
    A[Concept] --> B[Consequence]`}</code>
              </pre>
              <p className="mt-2 text-xs leading-5 text-muted-ink">
                Directions: <code>LR</code> left to right, <code>TB</code> top
                to bottom, <code>BT</code> bottom to top, <code>RL</code> right
                to left.
              </p>
            </section>

            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Node shapes
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`A[Rectangle]
B(Rounded)
C((Circle))
D{Question}
E[[Process]]`}</code>
              </pre>
            </section>

            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Links
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`A --> B
A --- B
A -.-> B
A ==> B
A -->|label| B`}</code>
              </pre>
              <p className="mt-2 text-xs leading-5 text-muted-ink">
                In order: arrow, line, dotted, thick line and arrow with a
                label.
              </p>
            </section>

            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Grouping concepts
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`subgraph group [Title]
    direction TB
    A --> B
end`}</code>
              </pre>
              <p className="mt-2 text-xs leading-5 text-muted-ink">
                Comments start with <code>%%</code>. Avoid an all-lowercase{' '}
                <code>end</code> as node text: use <code>End</code> or capitals.
              </p>
            </section>
          </div>

          <div className="border-t border-line pt-4 text-xs text-muted-ink">
            For the full syntax, see the{' '}
            <a
              href="https://mermaid.js.org/syntax/flowchart.html"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-ink underline underline-offset-4"
            >
              official Mermaid documentation
            </a>
            .
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={schemeDialogOpen} onOpenChange={setSchemeDialogOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitSchemeDialog();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {schemeDialogMode === 'create'
                  ? 'New free diagram'
                  : 'Rename the diagram'}
              </DialogTitle>
              <DialogDescription>
                Pick a short, recognisable title. You can change it at any time.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={schemeTitleDraft}
              onChange={(event) => setSchemeTitleDraft(event.target.value)}
              placeholder="E.g. German Expressionism"
              aria-label="Diagram title"
              maxLength={160}
            />
            <DialogFooter className="mx-0 -mb-4 mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSchemeDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!schemeTitleDraft.trim()}>
                {schemeDialogMode === 'create' ? <FilePlus2 /> : <Check />}
                {schemeDialogMode === 'create' ? 'Create diagram' : 'Save name'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(schemeToDelete)}
        onOpenChange={(open) => {
          if (!open) setSchemeToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this diagram?</DialogTitle>
            <DialogDescription>
              “{schemeToDelete?.title}” and its Mermaid code will also be
              removed from the server. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mx-0 -mb-4">
            <Button variant="outline" onClick={() => setSchemeToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteFreeScheme}>
              <Trash2 /> Delete diagram
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
