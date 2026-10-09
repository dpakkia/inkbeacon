import Image from 'next/image';
import Link from 'next/link';

import { readRegistry } from '@/lib/registry';

// the course list lives in Blob and changes from the library page
export const dynamic = 'force-dynamic';

export default async function Home() {
  const { courses } = await readRegistry();
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-16 font-ui text-ink md:py-24">
      <div className="flex items-center gap-4 md:gap-5">
        <Image
          src="/icon-512.png"
          alt=""
          width={72}
          height={72}
          priority
          className="size-[clamp(3rem,6vw,4.5rem)] shrink-0 drop-shadow-sm"
        />
        <h1 className="font-heading text-[clamp(2rem,4vw,3rem)] font-medium leading-tight tracking-[-0.03em]">
          InkBeacon
        </h1>
      </div>
      <p className="mt-3 text-muted-ink">
        A beacon of light in a “content” world where reading is
        hard-to-navigate.
      </p>

      <ul className="mt-12 space-y-3">
        {courses.map((course) => {
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

      <Link
        href="/library"
        className="mt-8 inline-block text-sm text-muted-ink underline-offset-4 transition-colors hover:text-ink hover:underline"
      >
        Manage the library: add, edit or delete books →
      </Link>
    </main>
  );
}
