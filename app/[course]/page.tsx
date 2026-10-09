import Link from 'next/link';
import { notFound } from 'next/navigation';

import { COURSES, findCourse } from '@/lib/courses';

export function generateStaticParams() {
  return COURSES.map((course) => ({ course: course.slug }));
}

const KIND_LABEL = {
  book: 'Text',
  diagrams: 'Diagrams',
} as const;

export default async function CoursePage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const course = findCourse(slug);
  if (!course) notFound();

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-16 font-ui text-ink md:py-24">
      <Link
        href="/"
        className="text-[11px] text-muted-ink transition-colors hover:text-ink"
      >
        ← All courses
      </Link>

      <h1 className="mt-6 font-heading text-[clamp(1.8rem,3.4vw,2.6rem)] font-medium leading-tight tracking-[-0.03em]">
        {course.name}
      </h1>
      <p className="mt-3 text-muted-ink">{course.description}</p>

      <ul className="mt-12 space-y-3">
        {course.sources.map((source) => (
          <li key={source.id}>
            <Link
              href={`/${course.slug}/${source.id}`}
              className="block rounded-xl border border-line bg-card/60 p-5 transition-colors hover:border-accent-strong hover:bg-card"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-heading text-lg font-medium">
                  {source.title}
                </h2>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-ink">
                  {KIND_LABEL[source.kind]}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-ink">
                {source.author}
                {source.author && ' · '}
                {source.total} {source.unit}
                {!source.readable && ' · text not available yet'}
              </p>
            </Link>
          </li>
        ))}

        <li>
          <Link
            href={`/${course.slug}/free`}
            className="block rounded-xl border border-dashed border-line p-5 text-sm text-muted-ink transition-colors hover:border-accent-strong hover:text-ink"
          >
            Free diagrams — maps not tied to a chapter
          </Link>
        </li>
      </ul>
    </main>
  );
}
