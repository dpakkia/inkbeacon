'use client';

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
  Highlighter,
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
import { ID_FONTI, type Corso, type Fonte } from '@/lib/corsi';
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

type Anteprima = {
  location: string;
  chapter: string;
  heading: string;
  paragraphs: string[];
};

type Source = Fonte & Anteprima;

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

type ReadingBlock = {
  kind: 'paragraph' | 'heading' | 'list' | 'quote' | 'caption' | 'image' | 'video';
  text?: string;
  src?: string;
  alt?: string;
  /** Id YouTube, quando il filmato non e' ospitato con il libro. */
  youtubeId?: string;
};

type ReadingUnit = {
  id: string;
  chapter: number;
  section: number;
  groupId?: string;
  location: string;
  chapterLabel: string;
  heading: string;
  author?: string;
  blocks: ReadingBlock[];
};

type ReadingCollection = {
  version: 1;
  title: string;
  author: string;
  chapterCount: number;
  unitCount: number;
  units: ReadingUnit[];
};

type StudyStatePayload = {
  highlights: HighlightStore;
  progress: ProgressStore;
  completedUnits: CompletedStore;
  freeSchemes: FreeScheme[];
  mermaidByChapter: MermaidStore;
  initialized: boolean;
};

/** Testi segnaposto per le fonti di cui non esiste ancora il testo integrale. */
const ANTEPRIME: Record<string, Anteprima> = {};

const ANTEPRIMA_VUOTA: Anteprima = {
  location: '',
  chapter: '',
  heading: '',
  paragraphs: [],
};

/** La voce 'schemi liberi' non e' un libro: compare in ogni corso. */
const SCHEMI_LIBERI: Source = {
  id: 'free',
  tipo: 'schemi',
  shortTitle: 'Schemi liberi',
  title: 'Schemi liberi',
  author: '',
  unit: 'schemi',
  total: 0,
  leggibile: false,
  ...ANTEPRIMA_VUOTA,
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
  { color: 'yellow', label: 'Giallo', className: 'bg-[#f3d76d]' },
  { color: 'mint', label: 'Grigio', className: 'bg-[#b9bcba]' },
  { color: 'coral', label: 'Corallo', className: 'bg-[#e9a18a]' },
];

const EMPTY_HIGHLIGHTS: HighlightStore = Object.fromEntries(
  ID_FONTI.map((id) => [id, [] as Highlight[]]),
);

const EMPTY_PROGRESS: ProgressStore = Object.fromEntries(
  ID_FONTI.map((id) => [id, 0]),
);

const EMPTY_COMPLETED: CompletedStore = Object.fromEntries(
  ID_FONTI.map((id) => [id, [] as string[]]),
);

// Il browser puo' avere un localStorage scritto quando le fonti erano tre:
// quell'archivio non ha le chiavi dei libri aggiunti dopo, e usarlo cosi'
// com'e' fa esplodere il primo `completedUnits[fonte].includes(...)`.
// Le chiavi le decide il registro, il salvataggio riempie quelle che conosce.
function perFonte<T>(salvato: unknown, vuoto: () => T): Record<string, T> {
  const record =
    salvato && typeof salvato === 'object' && !Array.isArray(salvato)
      ? (salvato as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    ID_FONTI.map((id) => [id, (record[id] as T | undefined) ?? vuoto()]),
  );
}

const FREE_SCHEME_STARTER = `flowchart LR
    A[Idea principale] --> B[Primo collegamento]`;
const MIN_DIAGRAM_ZOOM = 0.5;
const MAX_DIAGRAM_ZOOM = 2;
const DIAGRAM_ZOOM_STEP = 0.1;

const SYNC_LABELS: Record<SyncStatus, string> = {
  checking: 'Controllo sincronizzazione…',
  unconfigured: 'Server da configurare',
  locked: 'Sincronizzazione bloccata',
  saving: 'Salvataggio sul server…',
  saved: 'Salvato sul server',
  error: 'Server non raggiungibile',
};

function mergeHighlights(
  server: HighlightStore,
  cached: HighlightStore,
): HighlightStore {
  return Object.fromEntries(
    ID_FONTI.map((sourceId) => {
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
  server: CompletedStore,
  cached: CompletedStore,
): CompletedStore {
  return Object.fromEntries(
    ID_FONTI.map((sourceId) => [
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
  corso,
  fonte,
}: {
  corso: Corso;
  fonte: Fonte;
}) {
  const router = useRouter();

  // Le fonti selezionabili sono quelle del corso, piu' gli schemi liberi.
  const sources = useMemo<Source[]>(
    () => [
      ...corso.fonti.map((f) => ({
        ...f,
        ...(ANTEPRIME[f.id] ?? ANTEPRIMA_VUOTA),
      })),
      SCHEMI_LIBERI,
    ],
    [corso],
  );

  const isMobile = useIsMobile();
  const readerRef = useRef<HTMLElement>(null);
  const diagramCounter = useRef(0);
  const highlightStoreRef = useRef<HighlightStore>(EMPTY_HIGHLIGHTS);
  const progressRef = useRef<ProgressStore>(EMPTY_PROGRESS);
  const completedStoreRef = useRef<CompletedStore>(EMPTY_COMPLETED);
  const freeSchemesRef = useRef<FreeScheme[]>([]);
  const mermaidStoreRef = useRef<MermaidStore>(DEFAULT_MERMAID_BY_CHAPTER);
  const sourceIdRef = useRef<SourceId>(fonte.id);
  const serverReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceId, setSourceId] = useState<SourceId>(fonte.id);
  const [progress, setProgress] = useState<ProgressStore>(EMPTY_PROGRESS);
  const [completedUnits, setCompletedUnits] =
    useState<CompletedStore>(EMPTY_COMPLETED);
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
  const isCollectionSource = source.leggibile;
  const activeCollection = books[sourceId] ?? null;
  // senza il libro caricato il lettore mostrerebbe il testo dimostrativo
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
  }, []);

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
        payload.highlights,
        highlightStoreRef.current,
      );
      const mergedProgress = Object.fromEntries(
        ID_FONTI.map((id) => [
          id,
          // senza i default un id ignoto a una delle due parti darebbe NaN,
          // che poi il server rifiuta come progresso non intero
          Math.max(payload.progress[id] ?? 0, progressRef.current[id] ?? 0),
        ]),
      ) as ProgressStore;
      const mergedCompletedUnits = mergeCompletedUnits(
        payload.completedUnits ?? EMPTY_COMPLETED,
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
          JSON.stringify(payload.completedUnits ?? EMPTY_COMPLETED) ||
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
  }, [persistServerState]);

  /* oxlint-disable react/react-compiler -- browser-only persisted state hydrates after mount */
  useEffect(() => {
    const cachedProgress = perFonte<number>(
      loadJson<unknown>('studio:progress', null),
      () => 0,
    ) as ProgressStore;
    progressRef.current = cachedProgress;
    setProgress(cachedProgress);
    const cachedCompleted = perFonte<string[]>(
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
      ID_FONTI.map((id) => [
        id,
        loadJson<Highlight[]>(`studio:highlights:${id}`, []),
      ]),
    ) as HighlightStore;
    highlightStoreRef.current = cachedHighlights;
    // quelle della fonte aperta: qui ci si arriva da qualunque corso
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
  }, []);
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

    const caricaLibro = async () => {
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
    void caricaLibro();
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
          : 'La sintassi Mermaid contiene un errore.',
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
      router.push(`/${corso.slug}/${nextSource}`);
    },
    [corso.slug, router],
  );

  const toggleReadingUnitCompleted = useCallback(() => {
    if (!studySourceId) return;
    setCompletedUnits((current) => {
      const isCompleted = (current[studySourceId] ?? []).includes(completedUnitKey);
      const next = {
        ...current,
        [studySourceId]: isCompleted
          ? (current[studySourceId] ?? []).filter(
              (key) => key !== completedUnitKey,
            )
          : [...(current[studySourceId] ?? []), completedUnitKey],
      };
      completedStoreRef.current = next;
      // a pagine il progresso si muove a mano: i capitoli spuntati non sono pagine
      if (source.unit !== 'pagine') {
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
        setAccessError(payload?.error ?? 'Impossibile collegarsi al server.');
        return;
      }
      setAccessKey('');
      setSyncDialogOpen(false);
      await loadServerState();
    } catch {
      setAccessError('Il server non è raggiungibile.');
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
            title="Clicca per rimuovere l’evidenziazione"
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
      // nocookie: nessun cookie finche' non si premi play
      const sorgente = block.youtubeId
        ? `https://www.youtube-nocookie.com/embed/${block.youtubeId}?rel=0`
        : null;
      return (
        <figure
          key={`${readingUnit.id}-${index}`}
          className="my-10 overflow-hidden rounded-xl border border-line bg-card/50 p-3"
        >
          {sorgente ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                src={sorgente}
                title={block.alt || 'Video del manuale'}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          ) : block.src ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- materiale didattico senza sottotitoli
            <video
              src={block.src}
              controls
              preload="none"
              className="mx-auto max-h-[70vh] w-full rounded-lg"
            />
          ) : (
            <p className="p-4 text-center font-ui text-sm text-muted-ink">
              Video non ancora collegato.
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
            alt={block.alt ?? 'Immagine dal manuale'}
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
      aria-label="Testo da studiare"
    >
      <div className="flex min-h-[68px] items-center justify-between gap-4 border-b border-line/80 px-5 py-3 md:px-7">
        <div className="min-w-0">
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-ink">
            {isBookUnavailable ? (
              'Libro non caricato'
            ) : (
              <>
                {readingUnit.chapterLabel}
                {source.tipo === 'analisi' ? ' - ' : ' · '}
                {readingUnit.location}
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
              {isReadingUnitCompleted ? 'Fatto' : 'Segna fatto'}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sezione precedente"
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
                  {source.tipo === 'analisi'
                    ? `${readingUnit.chapterLabel} - ${readingUnit.location}`
                    : `${readingUnit.location} · ${readingUnit.heading}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {readingUnits.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {source.tipo === 'analisi'
                      ? `${unit.chapterLabel} - ${unit.location}`
                      : `${unit.location} · ${unit.heading}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="min-w-14 text-center font-ui text-xs tabular-nums text-muted-ink">
              {activeLoadStatus === 'loading' && isCollectionSource
                ? 'Carico…'
                : readingUnit.location}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sezione successiva"
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
                ? 'Libro bloccato'
                : syncStatus === 'unconfigured'
                  ? 'Server da configurare'
                  : syncStatus === 'error' || activeLoadStatus === 'error'
                    ? 'Libro non disponibile'
                    : 'Carico il libro…'}
            </h2>
            <p className="mt-2 font-ui text-sm leading-6 text-muted-ink">
              {syncStatus === 'locked'
                ? `I capitoli di «${source.title}» sono sul server. Inserisci la chiave di sincronizzazione per aprirli su questo dispositivo.`
                : syncStatus === 'unconfigured'
                  ? 'Il server non ha ancora la configurazione per conservare i libri.'
                  : syncStatus === 'error' || activeLoadStatus === 'error'
                    ? `Non riesco a caricare «${source.title}». Verifica la connessione e riprova aggiornando la pagina.`
                    : `Sto recuperando «${source.title}» dal server.`}
            </p>
            {syncStatus === 'locked' && (
              <Button className="mt-5" onClick={() => setSyncDialogOpen(true)}>
                <LockKeyhole /> Inserisci la chiave
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
              <span>Seleziona una frase per evidenziarla</span>
              <span>
                {readingUnitHighlightCount} evidenziazioni in questa sezione
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
      aria-label="Libreria degli schemi liberi"
    >
      <div className="flex min-h-[68px] items-center justify-between gap-4 border-b border-line/80 px-5 py-3 md:px-7">
        <div className="min-w-0">
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-ink">
            Libreria personale
          </p>
          <p className="mt-1 truncate font-heading text-[17px] font-medium text-ink">
            Schemi liberi
          </p>
        </div>
        <Button size="sm" onClick={openCreateScheme}>
          <FilePlus2 /> Nuovo schema
        </Button>
      </div>

      <div className="reader-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-7 md:py-8">
        {freeSchemes.length === 0 ? (
          <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center px-6 text-center">
            <span className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl border border-line bg-card/70 text-muted-ink shadow-sm">
              <Workflow className="size-5" />
            </span>
            <h2 className="font-heading text-xl font-medium text-ink">
              Uno spazio per le tue idee
            </h2>
            <p className="mt-2 font-ui text-sm leading-6 text-muted-ink">
              Crea mappe Mermaid indipendenti dai libri e dai film. Ogni schema
              viene salvato sul server.
            </p>
            <Button className="mt-5" onClick={openCreateScheme}>
              <FilePlus2 /> Crea il primo schema
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
                      Modificato il{' '}
                      {new Intl.DateTimeFormat('it-IT', {
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
                          aria-label={`Rinomina ${scheme.title}`}
                          onClick={() => openRenameScheme(scheme)}
                        />
                      }
                    >
                      <Pencil />
                    </TooltipTrigger>
                    <TooltipContent>Rinomina</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Elimina ${scheme.title}`}
                          onClick={() => setSchemeToDelete(scheme)}
                        />
                      }
                    >
                      <Trash2 />
                    </TooltipTrigger>
                    <TooltipContent>Elimina</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex min-h-11 items-center justify-between border-t border-line/80 px-5 font-ui text-[11px] text-muted-ink md:px-7">
        <span>
          {freeSchemes.length} {freeSchemes.length === 1 ? 'schema' : 'schemi'}
        </span>
        <span>Sincronizzazione privata</span>
      </div>
    </section>
  );

  const editorPanel = (
    <section
      className="flex h-full min-h-0 flex-col bg-workspace"
      aria-label="Editor della mappa Mermaid"
    >
      <div className="flex min-h-[68px] items-center justify-between gap-3 border-b border-workspace-line px-4 py-3 md:px-5">
        <div className="min-w-0">
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-workspace-muted">
            {sourceId === 'free' ? 'Schema libero' : 'Schema collegato'}
          </p>
          <p className="mt-1 truncate font-heading text-[17px] font-medium text-workspace-ink">
            {sourceId === 'free'
              ? (activeFreeScheme?.title ?? 'Nessuno schema')
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
              <span className="hidden sm:inline">Mappa</span>
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
              <span className="hidden sm:inline">Codice</span>
            </Button>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Apri la guida rapida Mermaid"
                  onClick={() => setMermaidHelpOpen(true)}
                />
              }
            >
              <CircleHelp />
            </TooltipTrigger>
            <TooltipContent>Guida rapida Mermaid</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Salva la mappa"
                  onClick={saveMermaid}
                  disabled={sourceId === 'free' && !activeFreeScheme}
                />
              }
            >
              {mermaidCode === savedCode ? <Check /> : <Save />}
            </TooltipTrigger>
            <TooltipContent>
              Salva mappa <span className="ml-1 opacity-70">⌘/Ctrl S</span>
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
                {mermaidCode === savedCode
                  ? 'Salvato'
                  : 'Modifiche non salvate'}
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
              aria-label="Codice Mermaid"
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
                      aria-label="Riduci lo zoom della mappa"
                      onClick={() => updateDiagramZoom(-DIAGRAM_ZOOM_STEP)}
                      disabled={diagramZoom <= MIN_DIAGRAM_ZOOM}
                    />
                  }
                >
                  <ZoomOut />
                </TooltipTrigger>
                <TooltipContent>Riduci zoom</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                className="min-w-14 px-1.5 text-[11px] tabular-nums"
                aria-label="Ripristina lo zoom al 100%"
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
                      aria-label="Aumenta lo zoom della mappa"
                      onClick={() => updateDiagramZoom(DIAGRAM_ZOOM_STEP)}
                      disabled={diagramZoom >= MAX_DIAGRAM_ZOOM}
                    />
                  }
                >
                  <ZoomIn />
                </TooltipTrigger>
                <TooltipContent>Aumenta zoom</TooltipContent>
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
                  Compongo la mappa…
                </div>
              ) : !mermaidCode.trim() ? (
                <div className="relative flex max-w-sm flex-col items-center text-center font-ui text-sm text-workspace-muted">
                  <Code2 className="mb-3 size-6" />
                  <p className="font-semibold text-workspace-ink">
                    {sourceId === 'free'
                      ? 'Questo schema è ancora vuoto.'
                      : `Nessuno schema per ${readingUnit.chapterLabel.toLowerCase()}.`}
                  </p>
                  <p className="mt-1 leading-6">
                    {sourceId === 'free'
                      ? 'Scrivi il codice Mermaid per iniziare a comporre la mappa.'
                      : 'Crea una mappa Mermaid: resterà associata a questo capitolo.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setEditorMode('code')}
                    disabled={sourceId === 'free' && !activeFreeScheme}
                  >
                    <Code2 /> Crea lo schema
                  </Button>
                </div>
              ) : diagramError ? (
                <div className="relative max-w-md rounded-xl border border-[#bb735f]/30 bg-[#fff5f1] p-5 font-ui text-sm leading-6 text-[#8b3c28] dark:bg-[#3b2924] dark:text-[#f2b7a7]">
                  <p className="font-semibold">
                    La mappa non può essere renderizzata.
                  </p>
                  <p className="mt-1 opacity-80">{diagramError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setEditorMode('code')}
                  >
                    <Code2 /> Correggi il codice
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
          <kbd className="kbd">⌘/Ctrl</kbd> + <kbd className="kbd">Invio</kbd>{' '}
          cambia vista
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
          {/* la via d'uscita dal lettore: il logo torna ai corsi, la riga
              sotto all'indice di questo. Senza, da un libro si esce solo
              con il tasto Indietro del browser. */}
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Tutti i corsi"
              className="flex size-9 items-center justify-center rounded-xl bg-[#292b2a] text-[#f6e7a8] shadow-sm transition-opacity hover:opacity-80 dark:bg-[#0f100f]"
            >
              <Highlighter className="size-[17px]" />
            </Link>
            <div className="hidden sm:block">
              <Link
                href="/"
                className="font-heading text-[18px] font-semibold leading-none tracking-[-0.025em] transition-colors hover:text-accent-strong"
              >
                Studio
              </Link>
              <Link
                href={`/${corso.slug}`}
                className="mt-1 block max-w-[200px] truncate text-[10px] uppercase tracking-[0.16em] text-muted-ink transition-colors hover:text-ink"
              >
                {corso.nome}
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
                  <span>Progresso della fonte</span>
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
                    ? 'schema personale'
                    : 'schemi personali'}
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
                      isDark
                        ? 'Passa alla modalità chiara'
                        : 'Passa alla modalità scura'
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
                {isDark ? 'Modalità chiara' : 'Modalità scura'}
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
                  aria-label="Riduci il progresso"
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
                  aria-label="Aumenta il progresso"
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
            aria-label="Scegli il colore dell’evidenziazione"
          >
            {COLOR_BUTTONS.map((item) => (
              <button
                key={item.color}
                type="button"
                onClick={() => addHighlight(item.color)}
                className={`size-6 rounded-md border-2 border-white/80 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${item.className}`}
                aria-label={`Evidenzia in ${item.label.toLowerCase()}`}
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
                ? 'Sincronizzazione da attivare'
                : 'Dati di studio sul server'}
            </DialogTitle>
            <DialogDescription>
              {syncStatus === 'unconfigured'
                ? 'L’app è pronta. Manca soltanto il collegamento a uno storage Vercel Blob privato e la chiave personale del progetto.'
                : syncStatus === 'saved' || syncStatus === 'saving'
                  ? 'Evidenziazioni, capitoli completati, progressi e schemi Mermaid sono sincronizzati in uno spazio privato su Vercel. La copia locale serve solo come cache offline.'
                  : 'Inserisci la chiave personale una sola volta su questo dispositivo. Verrà conservata in un cookie sicuro e non nel codice del sito.'}
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
                  placeholder="Chiave di sincronizzazione"
                  autoComplete="current-password"
                  aria-label="Chiave di sincronizzazione"
                />
                {accessError && (
                  <p className="text-xs text-destructive">{accessError}</p>
                )}
                <DialogFooter className="mx-0 -mb-4">
                  <Button type="submit" disabled={!accessKey.trim()}>
                    <Cloud /> Collega
                  </Button>
                </DialogFooter>
              </form>
            )}
        </DialogContent>
      </Dialog>

      <Dialog open={mermaidHelpOpen} onOpenChange={setMermaidHelpOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Guida rapida Mermaid</DialogTitle>
            <DialogDescription>
              Le forme e i collegamenti più utili per costruire una mappa
              concettuale con i flowchart.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 font-ui text-sm sm:grid-cols-2">
            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Struttura e direzione
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`flowchart LR
    A[Concetto] --> B[Conseguenza]`}</code>
              </pre>
              <p className="mt-2 text-xs leading-5 text-muted-ink">
                Direzioni: <code>LR</code> sinistra-destra, <code>TB</code>{' '}
                alto-basso, <code>BT</code> basso-alto, <code>RL</code>{' '}
                destra-sinistra.
              </p>
            </section>

            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Forme dei nodi
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`A[Rettangolo]
B(Arrotondato)
C((Cerchio))
D{Domanda}
E[[Processo]]`}</code>
              </pre>
            </section>

            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Collegamenti
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`A --> B
A --- B
A -.-> B
A ==> B
A -->|etichetta| B`}</code>
              </pre>
              <p className="mt-2 text-xs leading-5 text-muted-ink">
                Nell’ordine: freccia, linea, tratteggio, linea marcata e freccia
                con etichetta.
              </p>
            </section>

            <section>
              <h3 className="mb-2 font-heading text-base font-medium text-ink">
                Raggruppare concetti
              </h3>
              <pre className="overflow-x-auto rounded-lg bg-[#292b2a] p-3 font-mono text-xs leading-6 text-[#eceeec]">
                <code>{`subgraph gruppo [Titolo]
    direction TB
    A --> B
end`}</code>
              </pre>
              <p className="mt-2 text-xs leading-5 text-muted-ink">
                I commenti iniziano con <code>%%</code>. Evita <code>end</code>{' '}
                tutto minuscolo come testo di un nodo: usa <code>End</code> o le
                maiuscole.
              </p>
            </section>
          </div>

          <div className="border-t border-line pt-4 text-xs text-muted-ink">
            Per la sintassi completa consulta la{' '}
            <a
              href="https://mermaid.js.org/syntax/flowchart.html"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-ink underline underline-offset-4"
            >
              documentazione ufficiale Mermaid
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
                  ? 'Nuovo schema libero'
                  : 'Rinomina lo schema'}
              </DialogTitle>
              <DialogDescription>
                Scegli un titolo breve e riconoscibile. Potrai modificarlo in
                qualsiasi momento.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={schemeTitleDraft}
              onChange={(event) => setSchemeTitleDraft(event.target.value)}
              placeholder="Es. Espressionismo tedesco"
              aria-label="Titolo dello schema"
              maxLength={160}
            />
            <DialogFooter className="mx-0 -mb-4 mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSchemeDialogOpen(false)}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={!schemeTitleDraft.trim()}>
                {schemeDialogMode === 'create' ? <FilePlus2 /> : <Check />}
                {schemeDialogMode === 'create' ? 'Crea schema' : 'Salva nome'}
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
            <DialogTitle>Eliminare questo schema?</DialogTitle>
            <DialogDescription>
              “{schemeToDelete?.title}” e il relativo codice Mermaid verranno
              rimossi anche dal server. Questa azione non può essere annullata.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mx-0 -mb-4">
            <Button variant="outline" onClick={() => setSchemeToDelete(null)}>
              Annulla
            </Button>
            <Button variant="destructive" onClick={deleteFreeScheme}>
              <Trash2 /> Elimina schema
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
