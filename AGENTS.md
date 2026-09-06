# makemecookies!x4 — agent brief

One game, one repo, versions beside each other:

- `web/` — browser version (vanilla JS over the Canvas API, plus adenosine's
  `AdRPG` for the loop and input, and its score and chat clients at deploy
  time). **Source of truth for rules and tuning**, in `js/config.js`. Deployed
  by the website repo, which copies `web/` into `arcade/makemecookies/`. Never
  edit the website's copy directly — it gets overwritten.

There is no second version yet, and none is planned in particular. The repo
exists so that when one arrives it has somewhere to go, and so the rules have a
home that is not inside a website.

## AI Attribution

**No AI attribution.** Do not append `Co-Authored-By: Claude …`, "Generated
with …", or any similar trailer to commit messages, PR bodies, or release
notes. If your tooling adds such a line by default, remove it before
committing.

## The song is the clock

A shift is one play of the track, and everything is derived from that:

- `js/main.js` reads `music.currentTime` for the shift clock rather than
  counting frames, so the difficulty ramp and the four RUSH windows stay on the
  music even when the tab drops frames.
- `RUSH_AT` in `js/config.js` holds **fractions** of the measured duration, not
  absolute times, so re-encoding the track moves the windows with it.
- `st.shiftMs` comes from `music.duration`, read on both `loadedmetadata` **and
  `durationchange`**. Ogg carries no duration header, so the browser estimates
  one from bitrate while the file is still streaming: this track first reports
  41.7s and settles at 51.2s. Reading it once ends every shift nine seconds
  early with all four RUSH windows misplaced.

Shortening or replacing the track needs nothing else changed. Hardcoding a
length would.

## Audio needs both `.ogg` and `.mp3`

`js/main.js` chooses at load time from `canPlayType`:

```js
const MUSIC_SOURCES = [
  { url: 'audio/makemecookies-x4.ogg', type: 'audio/ogg; codecs="vorbis"' },
  { url: 'audio/makemecookies-x4.mp3', type: 'audio/mpeg' },
];
```

iOS has no Ogg Vorbis decoder, and every browser on iOS is WebKit, so Chrome
and Firefox there fail exactly as Safari does. Ogg-only audio is not quieter on
an iPhone, it is **silent** — and silent without an error unless something says
so, which is why a failed load, a blocked `play()` and an undecodable format
each surface a line on the page here rather than being swallowed. This game
shipped ogg-only and nobody reported it until somebody's brother mentioned it.

Replacing the track means producing both:

```
ffmpeg -i web/audio/new.ogg -c:a libmp3lame -q:a 0 web/audio/new.mp3
```

Check the result against the source size rather than reaching for a setting by
reflex. This track's ogg is ~157kbps, so V0 matches it at within 6KB; a
93kbps source would inflate by half at the same setting.

Ogg stays first in the list: it is the original encode and the mp3 is a
second-generation transcode of it.

## The rules are DOM-free on purpose

`js/stations.js` is the whole simulation and touches no DOM, no audio and no
canvas. `js/render.js` reads state and draws; it never decides anything. That
split is what lets `web/tests/test-simulation.js` load the real shipped modules
into a `vm` context instead of reimplementing them.

Keep it. A `document.getElementById` in `stations.js` costs the entire suite.

Note that `const` in a vm script lands in the global *lexical* scope rather than
on the context object, so the test harness bridges the constants across
explicitly. Without that they read as `undefined` and every comparison against
them passes quietly.

## Tuning is bot-measured, not hand-measured

The `RAMP` pairs in `js/config.js` were set by simulating full shifts at
different reaction times, not by playing. The first pass had **no skill
gradient at all** — a simulated player reacting in 700ms scored the same as one
reacting in 140ms, because the line is strictly serial and the oven capped
throughput at ~13 cookies with the player idle in between. Halving the cycle
times and tripling belt speed gave 29 cookies at 140ms against 12 at 700ms.

`readyMs` and `goldenMs` are the two that decide how much the mixer and the
oven forgive. If the health inspector never appears in real play, `goldenMs` is
too generous; if it appears constantly, `readyMs` is too tight.

A bot is a perfect prioritiser and never burns anything, so it cannot tell you
whether the inspector fires often enough. Only hands can.

## Cache-buster stamps in `web/index.html`

Every `?v=` is the first eight hex of SHA-256 over the file it stamps, with
newlines normalised to LF. Get one wrong and visitors keep serving the cached
old bytes, so the change reaches nobody and the page still loads.

`../shared/*` names files that do not exist in this repo at all — they resolve
only once `web/` has been copied into the website's `arcade/`, and they go
stale when *that* repo updates the shared bundles, which nothing here can
notice.

The website's pre-commit hook repairs stale stamps in its copy, but that repair
never travels back here, and `make sync-makemecookies` copies `web/` over
`arcade/makemecookies/` verbatim — so a stamp corrected there is reverted by
the next sync, silently. **The fix belongs in this repo.** Recompute from a
website checkout:

```
node scripts/check-cache-busters.mjs --digest arcade/shared/adenosine-rpg.js
npm run check:cachebust
```
