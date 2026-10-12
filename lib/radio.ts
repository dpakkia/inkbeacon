/**
 * Radio channels, switched with ‹ › in the radio panel.
 *
 * - `youtube`: a live stream (`live: true`, one id) or videos played one after
 *   another by YouTube's own embedded player, starting from a random one and
 *   looping. YouTube's terms require the player to stay visible (at least
 *   200×200 px, nothing drawn over it), so the panel shows it at that size.
 * - `audio`: your own music files, kept privately in storage under
 *   `studio/music/<folder>/` (like books) and played in order from a random
 *   track. Served only to a logged-in session.
 *
 * Add your own: see "Radio channels" in README.md. Live-stream ids change
 * when a channel restarts a stream: `node scripts/check-radio.mjs` tells you.
 */

export type YoutubeChannel = {
  id: string;
  name: string;
  kind: 'youtube';
  /** YouTube video ids; a live stream has exactly one. */
  videos: string[];
  live?: boolean;
};

export type AudioChannel = {
  id: string;
  name: string;
  kind: 'audio';
  /** Files in storage under studio/music/<folder>/ (letters, digits, - _). */
  folder: string;
};

export type Channel = YoutubeChannel | AudioChannel;

export const CHANNELS: Channel[] = [
  {
    id: 'lofi-girl',
    name: 'Lofi Girl',
    kind: 'youtube',
    live: true,
    // "lofi hip hop radio 📚 beats to relax/study to" (checked 2026-10-12)
    videos: ['rFZHOHl-L8A'],
  },
  {
    id: 'jazz',
    name: 'Jazz',
    kind: 'youtube',
    videos: ['CHRWua94l8g', 'oh-CctaoYhQ'],
  },
  {
    id: 'gt',
    name: 'GT',
    kind: 'youtube',
    videos: [
      'Rm8Isn0jP6E',
      'FxH313Z-Zoc',
      '9VRpctQTtoE',
      'GGyzvunZNKY',
      '3mzjgzo-LP4',
    ],
  },
  // Your own music (see README.md), for example:
  // { id: 'my-music', name: 'My music', kind: 'audio', folder: 'my-music' },
];

export const AUDIO_FOLDER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,59}$/;

/**
 * The embed URL for a YouTube channel, starting at video `start`: YouTube
 * plays the first video, then the `playlist` ones, and `loop` starts over.
 */
export function youtubeEmbedUrl(channel: YoutubeChannel, start: number) {
  const first = channel.videos[start % channel.videos.length];
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    playsinline: '1',
  });
  if (!channel.live) {
    const rotated = [
      ...channel.videos.slice(start + 1),
      ...channel.videos.slice(0, start + 1),
    ];
    params.set('playlist', rotated.join(','));
    params.set('loop', '1');
  }
  return `https://www.youtube-nocookie.com/embed/${first}?${params}`;
}
