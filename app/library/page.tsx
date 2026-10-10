import type { Metadata } from 'next';
import Link from 'next/link';

import Library from '@/components/library';
import { isKosyncConfigured } from '@/lib/kosync-auth';
import { readRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Library — InkBeacon' };

export default async function LibraryPage() {
  const registry = await readRegistry();
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-16 font-ui text-ink md:py-24">
      <Link
        href="/"
        className="text-[11px] text-muted-ink transition-colors hover:text-ink"
      >
        ← All courses
      </Link>
      <h1 className="mt-6 mb-10 font-heading text-[clamp(1.8rem,3.4vw,2.6rem)] font-medium leading-tight tracking-[-0.03em]">
        Library
      </h1>
      <Library initial={registry} koreader={isKosyncConfigured()} />
    </main>
  );
}
