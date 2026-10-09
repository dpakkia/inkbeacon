/**
 * Progress percentages per course.
 *
 * Study state is stored per source, but a course can have several. Here the
 * sources are summed in units, not averaged: a chapter and a page don't weigh
 * the same, and an average of percentages would give the shortest source the
 * same weight as a textbook hundreds of pages long.
 */

import type { Registry } from '@/lib/courses';
import { readRegistry } from '@/lib/registry';
import { readState, scopeOf } from '@/lib/study-state';
import {
  hasStudioAccess,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Share = { done: number; total: number; percent: number };

function share(done: number, total: number): Share {
  return {
    done,
    total,
    // one decimal: two are noise on a 336-page textbook
    percent: total > 0 ? Math.round((done / total) * 1000) / 10 : 0,
  };
}

function sum(shares: Share[]): Share {
  return share(
    shares.reduce((acc, s) => acc + s.done, 0),
    shares.reduce((acc, s) => acc + s.total, 0),
  );
}

export async function GET(request: Request) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Server sync is not configured.' },
      { status: 503 },
    );
  }
  if (!(await hasStudioAccess(request))) {
    return Response.json({ error: 'Access required.' }, { status: 401 });
  }

  let registry: Registry;
  let state: Awaited<ReturnType<typeof readState>>;
  try {
    registry = await readRegistry();
    state = await readState(scopeOf(registry));
  } catch (error) {
    console.error('Unable to read study state from Vercel Blob', error);
    return Response.json(
      { error: 'Unable to read the study data.' },
      { status: 502 },
    );
  }

  const courses = registry.courses.map((course) => {
    const sources = course.sources.map((source) => {
      const reading = share(state.progress[source.id] ?? 0, source.total);
      // ticked units survive a re-import that shortens the book: without the
      // clamp you could read more than 100%
      const completed = share(
        Math.min(state.completedUnits[source.id]?.length ?? 0, source.total),
        source.total,
      );
      return {
        id: source.id,
        title: source.title,
        author: source.author,
        unit: source.unit,
        reading,
        completed,
      };
    });

    return {
      slug: course.slug,
      name: course.name,
      reading: sum(sources.map((s) => s.reading)),
      completed: sum(sources.map((s) => s.completed)),
      sources,
    };
  });

  return Response.json(
    {
      updatedAt: state.updatedAt,
      initialized: state.initialized,
      courses,
      total: {
        reading: sum(courses.map((c) => c.reading)),
        completed: sum(courses.map((c) => c.completed)),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
