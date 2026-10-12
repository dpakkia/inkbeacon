'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Radio as RadioIcon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CHANNELS, youtubeEmbedUrl, type Channel } from '@/lib/radio';

const CHANNEL_KEY = 'studio:radio-channel';
/** YouTube's minimum embedded player viewport. */
const PLAYER_SIZE = 200;

const randomStart = (channel: Channel) =>
  channel.kind === 'youtube'
    ? Math.floor(Math.random() * channel.videos.length)
    : 0;

/**
 * The radio: a launcher in the corner of every page. Opened, it shows the
 * channel's player (YouTube at its minimum allowed size, or your own music)
 * with three buttons under it: previous channel, close, next channel.
 * Nothing is drawn over the YouTube player. It lives in the root layout, so
 * it keeps playing across pages.
 */
export default function Radio() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // which video a playlist channel starts from, picked when tuning in
  const [start, setStart] = useState(0);

  /* oxlint-disable react/react-compiler -- browser-only remembered channel restores after mount */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CHANNEL_KEY);
      const found = CHANNELS.findIndex((c) => c.id === saved);
      if (found >= 0) setIndex(found);
    } catch {
      // storage unavailable: start from the first channel
    }
  }, []);
  /* oxlint-enable react/react-compiler */

  const tune = (next: number) => {
    const channel = CHANNELS[next];
    setIndex(next);
    setStart(randomStart(channel));
    try {
      window.localStorage.setItem(CHANNEL_KEY, channel.id);
    } catch {
      // not remembered, still switched
    }
  };

  if (!CHANNELS.length) return null;
  const channel = CHANNELS[index];
  const previous = (index - 1 + CHANNELS.length) % CHANNELS.length;
  const following = (index + 1) % CHANNELS.length;

  if (!open) {
    return (
      <Button
        variant="outline"
        size="icon-lg"
        className="fixed bottom-4 left-4 z-40 rounded-full bg-card shadow-md"
        aria-label="Open the radio"
        title="Radio"
        onClick={() => {
          setStart(randomStart(channel));
          setOpen(true);
        }}
      >
        <RadioIcon />
      </Button>
    );
  }

  return (
    <aside
      aria-label="Radio"
      className="fixed bottom-4 left-4 z-40 w-[216px] rounded-xl border border-line bg-card p-2 shadow-lg"
    >
      {channel.kind === 'youtube' ? (
        <iframe
          // a new channel or start is a new player: it starts on the user's click
          key={`${channel.id}-${start}`}
          src={youtubeEmbedUrl(channel, start)}
          title={`Radio: ${channel.name}`}
          width={PLAYER_SIZE}
          height={PLAYER_SIZE}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="block rounded-lg border-0 bg-black"
        />
      ) : (
        <AudioChannelPlayer key={channel.id} folder={channel.folder} />
      )}
      <p className="mt-1.5 truncate text-center font-ui text-xs font-medium text-ink">
        {channel.name}
      </p>
      <div className="mt-1 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Previous channel: ${CHANNELS[previous].name}`}
          title={CHANNELS[previous].name}
          onClick={() => tune(previous)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close the radio"
          title="Close"
          onClick={() => setOpen(false)}
        >
          <X />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Next channel: ${CHANNELS[following].name}`}
          title={CHANNELS[following].name}
          onClick={() => tune(following)}
        >
          <ChevronRight />
        </Button>
      </div>
    </aside>
  );
}

/** Your own music: the files of studio/music/<folder>/, in order from a random one. */
function AudioChannelPlayer({ folder }: { folder: string }) {
  const [tracks, setTracks] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [message, setMessage] = useState('Loading…');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/radio/${folder}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (response.status === 401) {
          setMessage('Unlock InkBeacon (Library page) to play your music.');
          return;
        }
        const body = (await response.json()) as { tracks?: string[] };
        const list = body.tracks ?? [];
        if (!list.length) {
          setMessage(`No music yet in studio/music/${folder}/.`);
          return;
        }
        setTracks(list);
        setCurrent(Math.floor(Math.random() * list.length));
        setMessage('');
      } catch {
        if (!cancelled) setMessage('The music could not be loaded.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folder]);

  const track = tracks[current];
  return (
    <div className="flex h-[200px] w-[200px] flex-col justify-center gap-3 rounded-lg bg-secondary/60 p-3 font-ui text-xs">
      {track ? (
        <>
          <p
            className="line-clamp-3 break-words text-center text-ink"
            title={track}
          >
            {track.replace(/\.[^.]+$/, '')}
          </p>
          <audio
            key={track}
            src={`/api/radio/${folder}/${encodeURIComponent(track)}`}
            controls
            autoPlay
            onEnded={() => setCurrent((i) => (i + 1) % tracks.length)}
            className="w-full"
          >
            <track kind="captions" />
          </audio>
          <p className="text-center text-muted-ink">
            {current + 1} / {tracks.length}
          </p>
        </>
      ) : (
        <p className="text-center text-muted-ink">{message}</p>
      )}
    </div>
  );
}
