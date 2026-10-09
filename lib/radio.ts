/**
 * Radio stations: YouTube live streams, played in the radio panel.
 *
 * YouTube's terms require the embedded player to stay visible (at least
 * 200×200 px, nothing drawn over it) and forbid background or audio-only
 * playback, so the panel shows the player itself at that minimum size.
 *
 * Live-stream ids change when a channel restarts a stream: when a station
 * shows "video unavailable", take the new id from the channel's Streams tab
 * (youtube.com/@channel/streams). Checked on 2026-10-10.
 */

export type Station = {
  /** YouTube video id of the live stream. */
  id: string;
  name: string;
  channel: string;
};

export const STATIONS: Station[] = [
  {
    id: 'rFZHOHl-L8A',
    name: 'lofi hip hop radio: beats to relax/study to',
    channel: 'Lofi Girl',
  },
  {
    id: 'E2vONfzoyRI',
    name: 'jazz lofi radio: beats to chill/study to',
    channel: 'Lofi Girl',
  },
  {
    id: 'jXAEIWcGXwE',
    name: 'classical music radio: relaxing songs to read/study to',
    channel: 'Lofi Girl',
  },
  {
    id: 'N0snMcR6aaA',
    name: 'relaxing piano radio: calm music to focus to',
    channel: 'Lofi Girl',
  },
  {
    id: 'GSfT7H87zq4',
    name: 'synth ambient radio: deep space music',
    channel: 'Lofi Girl',
  },
  {
    id: '5yx6BWlEVcY',
    name: 'Chillhop Radio: jazzy & lofi hip hop beats',
    channel: 'Chillhop Music',
  },
  {
    id: '7NOSDKb0HlU',
    name: 'lofi hip hop radio: beats to study/relax to',
    channel: 'Chillhop Music',
  },
];
