/**
 * OPDS 1.2 (Atom) feeds for KOReader's catalogue browser: navigation by
 * course, acquisition entries for books whose original EPUB is stored.
 */

import type { Course, Registry, Source } from '@/lib/courses';

const NAVIGATION = 'application/atom+xml;profile=opds-catalog;kind=navigation';
const ACQUISITION =
  'application/atom+xml;profile=opds-catalog;kind=acquisition';

function xml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function feed(options: {
  origin: string;
  id: string;
  title: string;
  self: string;
  kind: 'navigation' | 'acquisition';
  updated: string;
  entries: string[];
}) {
  const { origin } = options;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${xml(options.id)}</id>
  <title>${xml(options.title)}</title>
  <updated>${options.updated}</updated>
  <author><name>InkBeacon</name></author>
  <link rel="self" href="${xml(origin + options.self)}" type="${options.kind === 'navigation' ? NAVIGATION : ACQUISITION}"/>
  <link rel="start" href="${xml(origin)}/opds" type="${NAVIGATION}"/>
${options.entries.join('\n')}
</feed>
`;
}

export function hasOriginal(source: Source) {
  return Boolean(source.originalName);
}

function bookEntry(origin: string, source: Source, updated: string) {
  return `  <entry>
    <id>urn:inkbeacon:book:${xml(source.id)}</id>
    <title>${xml(source.title)}</title>
    ${source.author ? `<author><name>${xml(source.author)}</name></author>` : ''}
    <updated>${updated}</updated>
    <dc:language>und</dc:language>
    <link rel="http://opds-spec.org/acquisition" href="${xml(origin)}/opds/books/${xml(source.id)}" type="application/epub+zip"/>
  </entry>`;
}

function navEntry(
  origin: string,
  id: string,
  title: string,
  href: string,
  content: string,
  updated: string,
) {
  return `  <entry>
    <id>${xml(id)}</id>
    <title>${xml(title)}</title>
    <updated>${updated}</updated>
    <content type="text">${xml(content)}</content>
    <link rel="subsection" href="${xml(origin + href)}" type="${ACQUISITION}"/>
  </entry>`;
}

export function rootFeed(origin: string, registry: Registry) {
  const updated = registry.updatedAt;
  const count = (sources: Source[]) => sources.filter(hasOriginal).length;
  const all = registry.courses.flatMap((c) => c.sources);
  return feed({
    origin,
    id: 'urn:inkbeacon:root',
    title: 'InkBeacon',
    self: '/opds',
    kind: 'navigation',
    updated,
    entries: [
      navEntry(
        origin,
        'urn:inkbeacon:all',
        'All books',
        '/opds/all',
        `${count(all)} books`,
        updated,
      ),
      ...registry.courses
        .filter((c) => count(c.sources) > 0)
        .map((c) =>
          navEntry(
            origin,
            `urn:inkbeacon:course:${c.slug}`,
            c.name,
            `/opds/courses/${c.slug}`,
            `${count(c.sources)} books`,
            updated,
          ),
        ),
    ],
  });
}

export function booksFeed(
  origin: string,
  registry: Registry,
  scope: { id: string; title: string; self: string; sources: Source[] },
) {
  return feed({
    origin,
    id: scope.id,
    title: scope.title,
    self: scope.self,
    kind: 'acquisition',
    updated: registry.updatedAt,
    entries: scope.sources
      .filter(hasOriginal)
      .map((s) => bookEntry(origin, s, registry.updatedAt)),
  });
}

export function courseScope(course: Course) {
  return {
    id: `urn:inkbeacon:course:${course.slug}`,
    title: course.name,
    self: `/opds/courses/${course.slug}`,
    sources: course.sources,
  };
}

export const ATOM_HEADERS = {
  'Content-Type': 'application/atom+xml;profile=opds-catalog;charset=utf-8',
  'Cache-Control': 'private, no-store',
};
