/**
 * The reading format: one JSON document per book, split into units (a
 * section of a chapter). Produced by the importers, read by the reader.
 * `examples/books/*.json` are small complete examples.
 */

export type ReadingBlock = {
  kind:
    | 'paragraph'
    | 'heading'
    | 'list'
    | 'quote'
    | 'caption'
    | 'image'
    | 'video';
  text?: string;
  /** Heading level (1–4), set by the importers. */
  level?: number;
  src?: string;
  alt?: string;
  /** YouTube id, when the video isn't hosted with the book. */
  youtubeId?: string;
};

export type ReadingUnit = {
  id: string;
  chapter: number;
  section: number;
  groupId?: string;
  location: string;
  chapterLabel: string;
  heading: string;
  author?: string;
  blocks: ReadingBlock[];
};

export type ReadingCollection = {
  version: 1;
  title: string;
  author: string;
  chapterCount: number;
  unitCount: number;
  units: ReadingUnit[];
};
