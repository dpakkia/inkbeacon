/**
 * Registry of courses and their sources.
 *
 * Single source of truth: the ids used to be repeated in the page, in the
 * study-state route and in one route per book. Adding a course now means
 * touching this file only.
 */

export type SourceKind = 'book' | 'diagrams';

export type Source = {
  id: string;
  kind: SourceKind;
  shortTitle: string;
  title: string;
  author: string;
  /** Name of the progress unit: chapters or pages. */
  unit: string;
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

export const COURSES: Course[] = [
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

export const ALL_SOURCES: Source[] = COURSES.flatMap(
  (course) => course.sources,
);

export const SOURCE_IDS: string[] = ALL_SOURCES.map((source) => source.id);

export const SOURCE_TOTALS: Record<string, number> = Object.fromEntries(
  ALL_SOURCES.map((source) => [source.id, source.total]),
);

export function findCourse(slug: string): Course | undefined {
  return COURSES.find((course) => course.slug === slug);
}

export function findSource(id: string): Source | undefined {
  return ALL_SOURCES.find((source) => source.id === id);
}

/** Course a source belongs to, for building links and breadcrumbs. */
export function courseOfSource(sourceId: string): Course | undefined {
  return COURSES.find((course) =>
    course.sources.some((s) => s.id === sourceId),
  );
}
