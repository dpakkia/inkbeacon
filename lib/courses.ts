/**
 * Courses and their sources: types, validation and the seed.
 *
 * The live list is the registry document in Blob (`lib/registry.ts`), edited
 * from the library page. `SEED_COURSES` only fills it the first time, when no
 * registry exists yet: editing it afterwards changes nothing. This file has
 * no server imports, so the browser can use the same validation.
 */

export type SourceKind = 'book' | 'diagrams';
export type SourceUnit = 'chapters' | 'pages';

export type Source = {
  id: string;
  kind: SourceKind;
  shortTitle: string;
  title: string;
  author: string;
  /** Progress unit. With pages, progress is moved by hand. */
  unit: SourceUnit | 'diagrams';
  total: number;
  /** true when the full text exists and can be read in the app. */
  readable: boolean;
};

export type Course = {
  slug: string;
  name: string;
  description: string;
  sources: Source[];
};

export type Registry = {
  version: 1;
  courses: Course[];
  /**
   * Ids of deleted books. A tab opened before the deletion could otherwise
   * save their study data back.
   */
  deleted: string[];
  updatedAt: string;
};

export const SEED_COURSES: Course[] = [
  {
    slug: 'example-course',
    name: 'Example course',
    description: 'A demo course: replace it with your own.',
    sources: [
      {
        id: 'example',
        kind: 'book',
        shortTitle: 'Example',
        title: 'How to study a text',
        author: 'Example author',
        unit: 'chapters',
        total: 3,
        readable: true,
      },
      {
        id: 'study-notes',
        kind: 'book',
        shortTitle: 'Study notes',
        title: 'Notes on remembering what you read',
        author: 'Example author',
        unit: 'chapters',
        total: 3,
        readable: true,
      },
    ],
  },
  {
    slug: 'reading-slowly',
    name: 'Reading slowly',
    description:
      'A second demo course, with progress counted in pages and moved by hand.',
    sources: [
      {
        id: 'slow-reading',
        kind: 'book',
        shortTitle: 'Slow reading',
        title: 'The slow reader’s handbook',
        author: 'Example author',
        unit: 'pages',
        total: 40,
        readable: true,
      },
    ],
  },
];

export function seedRegistry(): Registry {
  return {
    version: 1,
    courses: structuredClone(SEED_COURSES),
    deleted: [],
    updatedAt: new Date(0).toISOString(),
  };
}

/** Book ids end up in URLs, Blob paths and media file names. */
export const SOURCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const COURSE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/** Ids the app uses for itself: a book can't take them. */
const RESERVED_IDS = new Set(['free', 'library', 'api']);

export function isValidSourceId(id: string) {
  return SOURCE_ID_PATTERN.test(id) && !RESERVED_IDS.has(id);
}

export function isValidCourseSlug(slug: string) {
  return COURSE_SLUG_PATTERN.test(slug) && !RESERVED_IDS.has(slug);
}

/** A lowercase, dash-separated id from a title: "Dune (1965)" -> "dune-1965". */
export function slugify(text: string, maxLength = 40) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
}

function text(value: unknown, max: number, allowEmpty = false) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > max || (!allowEmpty && !trimmed)) return null;
  return trimmed;
}

function parseSource(value: unknown): Source | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  const title = text(item.title, 200);
  const shortTitle = text(item.shortTitle, 60);
  const author = text(item.author, 200, true);
  const unit = item.unit;
  const total = item.total;
  if (
    !isValidSourceId(id) ||
    item.kind !== 'book' ||
    title === null ||
    shortTitle === null ||
    author === null ||
    (unit !== 'chapters' && unit !== 'pages') ||
    !Number.isInteger(total) ||
    (total as number) < 0 ||
    (total as number) > 100_000 ||
    typeof item.readable !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    kind: 'book',
    title,
    shortTitle,
    author,
    unit,
    total: total as number,
    readable: item.readable,
  };
}

function parseCourse(value: unknown): Course | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const slug = typeof item.slug === 'string' ? item.slug : '';
  const name = text(item.name, 120);
  const description = text(item.description, 400, true);
  if (
    !isValidCourseSlug(slug) ||
    name === null ||
    description === null ||
    !Array.isArray(item.sources) ||
    item.sources.length > 500
  ) {
    return null;
  }
  const sources: Source[] = [];
  for (const raw of item.sources) {
    const source = parseSource(raw);
    if (!source) return null;
    sources.push(source);
  }
  return { slug, name, description, sources };
}

/** Validates a registry document; null if anything in it is malformed. */
export function parseRegistry(value: unknown): Registry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || !Array.isArray(item.courses)) return null;
  if (item.courses.length > 200) return null;

  const courses: Course[] = [];
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const raw of item.courses) {
    const course = parseCourse(raw);
    if (!course || slugs.has(course.slug)) return null;
    slugs.add(course.slug);
    for (const source of course.sources) {
      if (ids.has(source.id)) return null;
      ids.add(source.id);
    }
    courses.push(course);
  }

  const deleted = Array.isArray(item.deleted)
    ? [
        ...new Set(
          item.deleted.filter(
            (id): id is string =>
              typeof id === 'string' && isValidSourceId(id) && !ids.has(id),
          ),
        ),
      ].slice(-2_000)
    : [];

  return {
    version: 1,
    courses,
    deleted,
    updatedAt:
      typeof item.updatedAt === 'string' && item.updatedAt.length <= 40
        ? item.updatedAt
        : new Date(0).toISOString(),
  };
}

export function allSources(registry: Registry): Source[] {
  return registry.courses.flatMap((course) => course.sources);
}

export function sourceIds(registry: Registry): string[] {
  return allSources(registry).map((source) => source.id);
}

export function findCourse(registry: Registry, slug: string) {
  return registry.courses.find((course) => course.slug === slug);
}

export function findSource(registry: Registry, id: string) {
  return allSources(registry).find((source) => source.id === id);
}
