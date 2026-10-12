/**
 * Checks the YouTube radio channels in lib/radio.ts: live channels must be
 * live now, playlist videos must still exist and allow embedding. Live-stream
 * ids change when a channel restarts a stream; this tells you which to
 * replace (new ids are on the channel's Streams tab). Audio channels (your
 * own music) are skipped.
 *
 *   node scripts/check-radio.mjs
 *
 * Exits with 1 if anything is down. Needs Node 22.18+ (reads lib/radio.ts).
 */
const { CHANNELS } = await import('../lib/radio.ts');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  'Accept-Language': 'en',
  // skips YouTube's cookie-consent page, shown to EU visitors
  Cookie: 'SOCS=CAI',
};

async function check(id) {
  const page = await (
    await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS })
  ).text();
  const flag = (name) => new RegExp(`"${name}":(true|false)`).exec(page)?.[1];
  const oembed = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
  );
  const title = oembed.ok ? (await oembed.json()).title : '';
  return {
    live: flag('isLiveNow') === 'true',
    embeddable: flag('playableInEmbed') === 'true' && oembed.ok,
    title,
  };
}

let problems = 0;
let checked = 0;
for (const channel of CHANNELS) {
  if (channel.kind !== 'youtube') {
    console.log(
      `- ${channel.name}: your own music (studio/music/${channel.folder}/), not checked`,
    );
    continue;
  }
  console.log(`${channel.name}${channel.live ? ' (live)' : ''}`);
  for (const id of channel.videos) {
    checked += 1;
    let result;
    try {
      result = await check(id);
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const ok = result.embeddable && (!channel.live || result.live);
    if (!ok) problems += 1;
    const status = result.error
      ? `error: ${result.error}`
      : ok
        ? channel.live
          ? 'live'
          : 'ok'
        : [
            !result.embeddable && 'not embeddable or gone',
            channel.live && !result.live && 'not live',
          ]
            .filter(Boolean)
            .join(', ');
    console.log(
      `  ${ok ? '✓' : '✗'} ${id}  ${result.title ?? ''}  (${status})`,
    );
  }
}

console.log(
  problems
    ? `\n${problems} of ${checked} videos need replacing in lib/radio.ts.`
    : `\nAll ${checked} videos are fine.`,
);
process.exit(problems ? 1 : 0);
