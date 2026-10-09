import { notFound } from 'next/navigation';

import Studio from '@/components/studio';
import { COURSES, findCourse, type Source } from '@/lib/courses';

export function generateStaticParams() {
  return COURSES.flatMap((course) =>
    [...course.sources.map((s) => s.id), 'free'].map((source) => ({
      course: course.slug,
      source,
    })),
  );
}

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
  const course = findCourse(slug);
  if (!course) notFound();

  const source =
    sourceId === 'free'
      ? FREE_DIAGRAMS
      : course.sources.find((s) => s.id === sourceId);
  if (!source) notFound();

  return <Studio course={course} source={source} />;
}
