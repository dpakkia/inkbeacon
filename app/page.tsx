import Link from 'next/link';

import { COURSES } from '@/lib/courses';

export default function Home() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-16 font-ui text-ink md:py-24">
      <h1 className="font-heading text-[clamp(2rem,4vw,3rem)] font-medium leading-tight tracking-[-0.03em]">
        Study platform
      </h1>
      <p className="mt-3 text-muted-ink">
        Your courses, their texts and the diagrams.
      </p>

      <ul className="mt-12 space-y-3">
        {COURSES.map((course) => {
          const books = course.sources.filter((s) => s.kind === 'book').length;
          return (
            <li key={course.slug}>
              <Link
                href={`/${course.slug}`}
                className="block rounded-xl border border-line bg-card/60 p-5 transition-colors hover:border-accent-strong hover:bg-card"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-heading text-xl font-medium">
                    {course.name}
                  </h2>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-ink">
                    {books} {books === 1 ? 'text' : 'texts'}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-ink">
                  {course.description}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
