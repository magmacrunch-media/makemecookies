# makemecookies!x4 — iOS

**Step 1 of an App Store port, and only step 1.** What exists is the bundle
build. There is no Xcode project, no Capacitor, no icon, no shims and no store
metadata yet.

```
node ios/package.mjs      # web/ -> ios/www/
```

`ios/www/` is generated and gitignored. Never edit it; edit `web/` and rebuild.

## What works today

Ten transforms, all guarded, and the output is verified self-contained: 13 of 13
referenced assets serve 200 from a static server, the mp3 serves as `audio/mpeg`,
and the `.ogg` is correctly absent. Checked 2026-09-18.

To look at it without a Mac, serve `www/` and open `/`:

```
npx serve ios/www
```

Open `/`, not `/index.html`: `serve` does clean URLs and the full filename 301s
to `/index`, which reads like a misconfiguration and is not one.

## Why a derivation and not a second copy of the game

The root `AGENTS.md` rule is that a gameplay change is not done until every
version has it, and there are two here: `web/js/` and `wii/source/`. A
hand-maintained iOS copy of `web/` would be a third, and the worst of them, since
it would differ from the browser version in a handful of lines nobody can list
from memory. Deriving means the app inherits `web/` for free.

**So `ios/` never edits `web/` and never holds a copy of it.** A gameplay fix
belongs in `web/js/`; the app picks it up at the next build.

## What is deliberately not here yet

| | Why |
|---|---|
| the Xcode project | step 2 |
| haptics | needs an event seam in `web/js/`; this game dispatches no `CustomEvent`s at all, unlike george-boole's `boole:*` |
| a scoreboard shim | there is no `#scoreboardModal` here, so george-boole's 237-line rebuild has nothing to attach to |
| Game Center leaderboards and achievements | ids are permanent once created in App Store Connect, and this game has no difficulty ladder to key them on. See issue #1, which works out the shift's ceiling so thresholds can be derived rather than guessed |
| an app icon and launch image | step 2 |
| `store/metadata.md` | needs `engines/hypnopompia/tools/check-metadata.mjs`, which is ready and takes a path |

## Two known divergences from the web version

**Share Tech Mono is not self-hosted, so it falls back in the bundle.**
`web/index.html` asks Google for two families and the website repo's `fonts/`
carries only PressStart2P and CourierPrime. A bundle may not fetch a font at
runtime, so the four `css/` rules using Share Tech Mono fall through to the
fallbacks they already declare (`'Courier New', monospace` in `base.css`, bare
`monospace` in `layout.css` and `modals.css`). That is a visible difference, not a
broken bundle. The real fix is adding `ShareTechMono-Regular.woff2` to the website
repo, which would benefit the site too, since it currently depends on Google's CDN
for it.

**The song is the clock, and iOS will interrupt it.** `js/main.js` drives the
shift from a plain `<audio>` element's `ended` event and `currentTime`, chosen
deliberately because AdAudio hardcodes `loop = true` and exposes neither. On iOS
the system takes the audio session for calls, backgrounding and Control Center, so
a shift can be paused or cut off from outside the game. **This is the port's one
real design question** and it wants answering before anything cosmetic. The shift
is only about 51 seconds, so "the shift is void, tap to restart" is a defensible
cheap answer; george-boole never faced this because its music was ambient and its
clock was moves.

## What this folder is for, beyond this game

It is the **second** `package.mjs` in the tree. `engines/hypnopompia` holds the
shared iOS shell but deliberately not the bundle pipeline, because with one
example there was no way to tell which of george-boole's fourteen transforms were
arcade-wide and which were its own. Now there are two, and the diff answers it.
The comparison is tabulated at the top of `package.mjs` rather than left implicit:
six of seven shared-file classifications match, nine transforms carry over
unchanged, three of george-boole's do not apply here at all, and two needed a
different mechanism for the same reason.

That table is the input to moving the pipeline into hypnopompia. Keep it current
if you change a transform.

## AI Attribution

**No AI attribution.** Do not append `Co-Authored-By: Claude ...`, "Generated
with ...", or any similar trailer to commit messages, PR bodies, or release
notes. If your tooling adds such a line by default, remove it before committing.
