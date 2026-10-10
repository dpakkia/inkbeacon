/**
 * Checks that every radio station in lib/radio.ts is still live and
 * embeddable. Live-stream ids change when a channel restarts a stream; this
 * tells you which ones to replace (new ids are on the channel's Streams tab).
 *
 *   node scripts/check-radio.mjs
 *
 * Exits with 1 if any station is down.
 */
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../lib/radio.ts', import.meta.url),
  'utf8',
);
const stations = [
  ...source.matchAll(
    /id: '([\w-]{11})',\s*name: '([^']*)',\s*channel: '([^']*)'/g,
  ),
].map(([, id, name, channel]) => ({ id, name, channel }));
if (!stations.length) {
  console.error('No stations found in lib/radio.ts.');
  process.exit(1);
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  'Accept-Language': 'en',
  // skips YouTube's cookie-consent page, shown to EU visitors
  Cookie: 'SOCS=CAI',
};

async function check({ id }) {
  const page = await (
    await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS })
  ).text();
  const flag = (name) => new RegExp(`"${name}":(true|false)`).exec(page)?.[1];
  const oembed = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
  );
  return {
    live: flag('isLiveNow') === 'true',
    embeddable: flag('playableInEmbed') === 'true' && oembed.ok,
  };
}

let down = 0;
for (const station of stations) {
  let result;
  try {
    result = await check(station);
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  const ok = result.live && result.embeddable;
  if (!ok) down += 1;
  const status = result.error
    ? `error: ${result.error}`
    : ok
      ? 'live'
      : [!result.live && 'not live', !result.embeddable && 'not embeddable']
          .filter(Boolean)
          .join(', ');
  console.log(
    `${ok ? '✓' : '✗'} ${station.id}  ${station.channel}: ${station.name}  (${status})`,
  );
}

console.log(
  down
    ? `\n${down} of ${stations.length} stations need a new id in lib/radio.ts.`
    : `\nAll ${stations.length} stations are live.`,
);
process.exit(down ? 1 : 0);
