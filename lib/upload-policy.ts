/**
 * What may be uploaded where, for every storage backend alike.
 *
 * Allowed paths: `studio/books/<id>/book.json`, `.../media/<id>-0000.<ext>`,
 * `.../original.epub` (KOReader support only), and radio music under
 * `studio/music/<folder>/`. A book already in the
 * library can't be overwritten, unless `replace` is asked for explicitly (the
 * CLI's --replace, to re-import a book's text); its original EPUB can always
 * be attached or replaced.
 */

import { findSource, isValidSourceId } from '@/lib/courses';
import { isKosyncConfigured } from '@/lib/kosync-auth';
import { readRegistry } from '@/lib/registry';

const MEDIA = /^[a-z0-9-]+-\d{4}\.(gif|jpe?g|png|svg|webp|mp4|m4v|webm)$/;
const MB = 1024 * 1024;

export type UploadPolicy = {
  /** Patterns such as `image/*` or exact types. */
  contentTypes: string[];
  maxBytes: number;
};

export class UploadRefusedError extends Error {}

export async function uploadPolicy(
  pathname: string,
  options: { replace?: boolean } = {},
): Promise<UploadPolicy> {
  // your own music for an audio radio channel (scripts/upload-music.mjs)
  const music =
    /^studio\/music\/([a-z0-9][a-z0-9_-]{0,59})\/([A-Za-z0-9._ -]{1,200})$/.exec(
      pathname,
    );
  if (music) {
    if (music[2].startsWith('.') || music[2] !== music[2].trim())
      throw new UploadRefusedError('This file name is not allowed.');
    return { contentTypes: ['audio/*'], maxBytes: 500 * MB };
  }

  const match =
    /^studio\/books\/([^/]+)\/(book\.json|original\.epub|media\/([^/]+))$/.exec(
      pathname,
    );
  const id = match?.[1] ?? '';
  const mediaName = match?.[3];
  if (
    !match ||
    !isValidSourceId(id) ||
    (mediaName !== undefined &&
      (!MEDIA.test(mediaName) || !mediaName.startsWith(`${id}-`)))
  ) {
    throw new UploadRefusedError('This upload path is not allowed.');
  }
  if (match[2] === 'original.epub') {
    if (!isKosyncConfigured())
      throw new UploadRefusedError('KOReader support is not enabled.');
    return { contentTypes: ['application/epub+zip'], maxBytes: 500 * MB };
  }
  if (!options.replace && findSource(await readRegistry(), id)) {
    throw new UploadRefusedError(`A book with the id "${id}" already exists.`);
  }
  return mediaName
    ? { contentTypes: ['image/*', 'video/*'], maxBytes: 500 * MB }
    : { contentTypes: ['application/json'], maxBytes: 100 * MB };
}

export function allowsContentType(policy: UploadPolicy, contentType: string) {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return policy.contentTypes.some((allowed) =>
    allowed.endsWith('/*')
      ? type.startsWith(allowed.slice(0, -1))
      : type === allowed,
  );
}
