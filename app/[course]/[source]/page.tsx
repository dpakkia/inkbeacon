import { notFound } from 'next/navigation';

import Studio from '@/components/studio';
import { findCourse, sourceIds, type Source } from '@/lib/courses';
import { isKosyncConfigured } from '@/lib/kosync-auth';
import { readRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';

/** Not a book: free diagrams exist in every course. */
const FREE_DIAGRAMS: Source = {
  id: 'free',
  kind: 'diagrams',
  shortTitle: 'Free diagrams',
  title: 'Free diagrams',
  author: '',
  unit: 'diagrams',
  total: 0,
  readable: false,
};

export default async function SourcePage({
  params,
}: {
  params: Promise<{ course: string; source: string }>;
}) {
  const { course: slug, source: sourceId } = await params;
  const registry = await readRegistry();
  const course = findCourse(registry, slug);
  if (!course) notFound();

  const source =
    sourceId === 'free'
      ? FREE_DIAGRAMS
      : course.sources.find((s) => s.id === sourceId);
  if (!source) notFound();

  return (
    <Studio
      course={course}
      source={source}
      sourceIds={sourceIds(registry)}
      koreader={isKosyncConfigured()}
    />
  );
}
