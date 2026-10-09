'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Radio as RadioIcon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { STATIONS } from '@/lib/radio';

const STATION_KEY = 'studio:radio-station';
/** YouTube's minimum embedded player viewport. */
const PLAYER_SIZE = 200;

/**
 * The radio: a launcher in the corner of every page. Opened, it shows the
 * YouTube player at its minimum allowed size with three buttons under it
 * (previous station, close, next station). Nothing is drawn over the player.
 * It lives in the root layout, so it keeps playing across pages.
 */
export default function Radio() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  /* oxlint-disable react/react-compiler -- browser-only remembered station restores after mount */
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STATION_KEY));
      if (Number.isInteger(saved) && saved >= 0 && saved < STATIONS.length)
        setIndex(saved);
    } catch {
      // storage unavailable: start from the first station
    }
  }, []);
  /* oxlint-enable react/react-compiler */

  const tune = (delta: number) =>
    setIndex((current) => {
      const next = (current + delta + STATIONS.length) % STATIONS.length;
      try {
        window.localStorage.setItem(STATION_KEY, String(next));
      } catch {
        // not remembered, still switched
      }
      return next;
    });

  if (!STATIONS.length) return null;
  const station = STATIONS[index];
  const previous = STATIONS[(index - 1 + STATIONS.length) % STATIONS.length];
  const next = STATIONS[(index + 1) % STATIONS.length];

  if (!open) {
    return (
      <Button
        variant="outline"
        size="icon-lg"
        className="fixed bottom-4 left-4 z-40 rounded-full bg-card shadow-md"
        aria-label="Open the radio"
        title="Radio"
        onClick={() => setOpen(true)}
      >
        <RadioIcon />
      </Button>
    );
  }

  return (
    <aside
      aria-label="Radio"
      className="fixed bottom-4 left-4 z-40 rounded-xl border border-line bg-card p-2 shadow-lg"
    >
      <iframe
        // a new station is a new player: it starts on the user's click
        key={station.id}
        src={`https://www.youtube-nocookie.com/embed/${station.id}?autoplay=1&rel=0&playsinline=1`}
        title={`${station.name}: ${station.channel}`}
        width={PLAYER_SIZE}
        height={PLAYER_SIZE}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        className="block rounded-lg border-0 bg-black"
      />
      <div className="mt-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Previous station: ${previous.name}`}
          title={previous.name}
          onClick={() => tune(-1)}
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
          aria-label={`Next station: ${next.name}`}
          title={next.name}
          onClick={() => tune(1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </aside>
  );
}
