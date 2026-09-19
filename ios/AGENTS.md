# makemecookies!x4, iOS

**Steps 1 and 2 of an App Store port.** The bundle build and the Xcode project
exist. There is no icon, no shims, no entitlement and no store metadata yet.

```
node ios/package.mjs      # web/ -> ios/www/
npx cap sync ios          # the same, then into App/
```

`npx cap sync ios` is the one to use before opening Xcode. `cap copy` alone pushes
a stale `www/`, which looks like the build not taking effect.

| | |
|---|---|
| Bundle id | `com.magmacrunch.makemecookies` |
| Display name | makemecookies!x4 |
| `webDir` | `www` |
| Platform path | `App` (set in `capacitor.config.json`; the default would make `ios/ios/`) |

**The bundle id is trivial to change now and permanent after the first
submission.** It is the app's identity on the App Store and in Game Center and
cannot be reused or renamed. Change it before submitting or not at all.

## The project was assembled on Windows, so CI is the only thing that has built it

There is no Xcode on the dev box. `cap add ios` runs there, but the two vendored
Swift files and `PrivacyInfo.xcprivacy` were wired into `project.pbxproj` by
script, and **a file the project fails to list is not a warning**:
`GameViewController` would simply not exist while `Main.storyboard` names it, so
the app would fail at launch after building perfectly. The `ios-build` job on
`macos-latest` is the check, and it asserts two things a successful compile does
not prove on its own: that `GameCenterPlugin` is in the binary, and that the
privacy manifest reached the bundle rather than only the repo.

Four edits to what `cap add` generated, each asserted to have matched once:

| | |
|---|---|
| `SceneDelegate.swift` | root view controller is `GameViewController` |
| `Main.storyboard` | names `GameViewController` too. `Info.plist` sets `UISceneStoryboardFile`, so UIKit instantiates the storyboard's controller *before* `SceneDelegate` replaces it; leaving the stock class builds a second bridge and a second `WKWebView` on every launch, one of them with no plugin registered |
| `Info.plist` | `arm64`, not the template's `armv7` |
| `Info.plist` | `ITSAppUsesNonExemptEncryption` false. True for an offline bundle, and without it App Store Connect asks the export-compliance question on every upload |

**Orientations are deliberately left as all four, which is the opposite of
george-boole.** There, `responsive.css` broke at 600px so a landscape phone fell
into the desktop layout and portrait-only was the honest answer. Here
`css/layout.css` has worked blocks for both: a narrow-portrait letterbox that
spends reclaimed height on the touchpad, and a short-viewport block that sizes the
960x420 field by height and calls landscape "the right shape for it". Locking
would discard that work.

**`Package.resolved` is not committed**, because only SPM on a Mac can generate
it. CI resolves `capacitor-swift-pm` fresh each run and may pick a version nobody
has tried. Commit what it produces once the app has run on a real device.

## The Game Center plugin is vendored, and the entitlement is not

`App/App/App/GameCenterPlugin.swift` and `GameViewController.swift` come from
`engines/hypnopompia` and **must not be edited here**. Bring a change back
upstream and re-vendor:

```
cd ../../engines/hypnopompia
node tools/sync.mjs ../../games/makemecookies      # vendor down
node tools/sync.mjs --check                        # both games, hash compare
```

Editing them here is the drift that arrangement exists to catch, and it is caught
from the shell's end: `sync.mjs --check` lists this repo in its `consumers.json`,
and the `ios-shared` job runs it on every push to either side.

**There is no `App.entitlements` yet, on purpose.** The Game Center capability
makes a device build or archive fail by name until it is enabled for this bundle
id on the paid account, and there is nothing to enable it for: leaderboard and
achievement ids are undecided, and permanent once created. The plugin compiles and
registers without it, which is what CI checks. Add the entitlement when issue #1
settles the thresholds.

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
| the App Store Connect entries | `shim/gamekit.js` reports to one leaderboard and eight achievements that **do not exist yet**. Creating them, and the Game Center capability itself, needs the paid membership. The ids are below and are permanent once created |
| a scoreboard rebuild | george-boole rebuilds its scoreboard modal inside the app; this game's is four columns and a close button, so the shim injects one GAME CENTER button into it instead |
| `store/metadata.md` | needs `engines/hypnopompia/tools/check-metadata.mjs`, which is ready and takes a path. The two URLs App Store Connect requires now exist: `magmacrunch.com/privacy/makemecookies/` and `magmacrunch.com/support/makemecookies/`, written 2026-09-19 |
| `App.entitlements` | see the Game Center section above |

## The art is drawn by script, and was Capacitor's until 2026-09-19

`cap add` supplied its own 1024px logo and three byte-identical 2732px
splashes, and nothing in the pipeline objects to them: the project builds,
archives and would have uploaded wearing Capacitor's branding under this game's
name. That is the shape of gap worth naming, because it announces itself
nowhere.

| | |
|---|---|
| `tools/make-cookie-pixel.py` | the app icon, light and dark, plus the `Contents.json` entry pairing them |
| `tools/make-splash.py` | the launch image, written to all three filenames Capacitor registers |

Neither retypes anything. The icon parses the `PAL` table out of
`web/js/pixels.js`, so a cookie recoloured in the game cannot leave the icon
painting the old one, and the splash imports the icon's backdrop rather than
copying it. The font and the publisher's mark come from the website checkout,
found the way `package.mjs` finds it.

Three things they know that are easy to learn the hard way:

- **Judge an icon at 60px.** George Boole's was fine at 1024 and a murky blob
  on a home screen, and the redraw is what put `--sheet` in both files. It
  renders 180, 120 and 60 against a light and a dark wallpaper, masked.
- **`scaleAspectFill` crops the launch image.** A portrait phone fills the
  height from a square and shows a band 46% of the width; a landscape iPad
  shows about the middle 75% of the height. Both scripts assert their art fits
  inside those bands and refuse to write anything wider, because the asset
  catalog previews the full square and would show you a wordmark that is
  cropped in half on every phone.
- **The same colours read differently at different coverage.** The icon is
  mostly cookie so its ground shows only where the gradient has fallen away;
  the splash is all ground, and the icon's stops came out as hot pink across a
  whole screen. The splash carries its own, darker.

## The two shims, and the only npm plugin in the app

`shim/gamekit.js` and `shim/haptics.js`, injected by `package.mjs` after the
ScoreClient bootstrap
and therefore before `js/moments.js` and `js/main.js`. Script order is the only
thing guaranteeing a listener is registered before anything can dispatch, which
is why the anchor is the bootstrap line rather than the game's own scripts.

It listens to the `cookies:*` events and reaches into nothing. That is worth
more here than the general argument for a seam suggests: wrapping the stations
directly would buzz on presses that did nothing, since a locked hopper and a
full tray both answer a press by ignoring it, and a game played by mashing
would buzz constantly for no information.

| Moment | Feedback | Why |
|---|---|---|
| `perfect` | impact LIGHT | the most frequent thing worth feeling, so it stays under the threshold where it becomes something you notice |
| `box` | impact MEDIUM, or notification SUCCESS inside a RUSH | a doubled box is the one the player braced for, and a notification pattern is categorically unlike an impact |
| `burnt`, `spill` | impact HEAVY | the same class of mistake by feel, deliberately not told apart: by the time you feel it you are already looking at the station |
| `jam` | impact MEDIUM | stops the belt rather than costing anything, so a nudge, not a thud |
| `fire` | notification WARNING | recoverable, by mashing 4, and filling the mess meter while it burns |
| `fire-out` | notification SUCCESS | the one emergency the player can actually fix, so the fix is audible in the hand: WARNING started it, SUCCESS ends it |
| `inspection` | notification ERROR | the only failure state, and the only moment where nothing the player does helps |
| `shift-end` | SUCCESS with a clean-up bonus, impact HEAVY without | the bonus is the difference between a good shift and a shipped one |
| `rush` | three MEDIUM impacts, 90ms apart | the only warning the player gets, arriving while both hands are busy; reads as a fanfare rather than one more thing going wrong |

`@capacitor/haptics` 8.0.2 is the only npm plugin the app bundles. Two things
about it are worth knowing before reading its calls:

- **`HEAVY` and `SUCCESS` are not typos.** The plugin string-matches `MEDIUM`
  and `LIGHT` for style and `WARNING` and `ERROR` for type, and anything else
  falls through to the initial values, which are `.heavy` and `.success`. So
  both are the documented API arriving by default rather than by comparison,
  and passing `''` would behave identically. Spelled out for that reason.
- **It ships no privacy manifest and needs none.** It touches no required-reason
  API and no `UserDefaults`, checked against its Swift sources. Confirm the
  aggregate with Product, Archive, Generate Privacy Report before an upload
  regardless.

Nothing here has a browser counterpart: `window.Capacitor.Plugins` is injected
natively at document start, so in any static server pointed at `ios/www` the
shim finds no plugin and returns before binding a single listener. Verified
that way, and then verified again by re-running the real file against a stubbed
plugin, which is the only way to see the mapping without a device.

### `shim/gamekit.js`

One file where george-boole has two. That game splits scores from achievements
because its scores half is mostly a 237-line rebuild of a scoreboard modal that
Game Center has to sit inside; this game's scoreboard is four columns and a
close button, so the split would be two files of preamble around thirty lines
of work. Split it if a third iOS game arrives and this one grows a UI.

It signs in once at load, submits **every** finished shift to the leaderboard,
and awards the eight achievements from `cookies:*` events. Submitting every
shift rather than only good ones is deliberate: Game Center keeps each player's
best itself, so a worse shift is harmless, and the alternative makes the board a
record of the days somebody remembered to care.

The GAME CENTER button is injected into `#modal-scores` and only after sign-in
actually succeeds, so a player who declined never sees a button that opens
nothing. That is also the reason it is injected rather than written into
`web/index.html`, which has no Game Center at all.

One thing is read from the game rather than from an event: `TRAY_CAP`, for the
`fullhouse` achievement. That is reading the config, not re-deriving a rule. It
is a `const`, so it is a global lexical binding rather than a property of
`window`, reachable by bare name only after `config.js` has run, which is why
the read is inside the handler rather than at the top of the file.

## Game Center: the ids, and what has to exist before they can be earned

**Nothing here is created yet, and an id cannot be changed or reused once it
is.** Read this against `web/js/config.js` before typing anything into App
Store Connect.

The thresholds come from `web/tests/bench-shift.js`, which plays a whole shift
with a simulated player on a fixed reaction budget. `STARS = [8, 15, 22]`
cookies, which that bench measures as roughly a 1100ms, a 650ms and a 380ms
hand. CI fails if a tuning change makes three stars unreachable or one star
free, so these numbers cannot quietly stop meaning what they say.

### One leaderboard

| | |
|---|---|
| id | `com.magmacrunch.makemecookies.shift` |
| type | Integer, Best Score, **High to Low**, no score range |
| name | SHIFT SCORE |

Score rather than cookies, deliberately, and the split is the point: the stars
rate the shift on cookies because that is the legible number, and the board
ranks on score because it already folds in the greed decision that `BOX_MULT`
rewards and the clean-up bonus. A score range would silently reject real
scores, the same trap george-boole's eight boards avoid.

### Achievements

Points total 610 of App Store Connect's 1000, which leaves room for a ninth
without re-pointing the others. That headroom is the lesson from george-boole,
where 8 at 100 plus 300 came to exactly the cap.

| id suffix | points | earned by | from |
|---|---|---|---|
| `shipped` | 10 | ship a box | `cookies:box` |
| `star1` | 50 | 8 cookies in a shift | `cookies:shift-end`, `stars >= 1` |
| `star2` | 100 | 15 cookies | `stars >= 2` |
| `star3` | 200 | 22 cookies | `stars >= 3` |
| `rushbox` | 50 | ship a box inside a RUSH window | `cookies:box`, `detail.rush` |
| `fullhouse` | 50 | ship a box of four | `cookies:box`, `detail.cookies` |
| `spotless` | 100 | finish with the SPOTLESS bonus | `cookies:shift-end`, `detail.bonusLabel` |
| `fireout` | 50 | put out an oven fire | `cookies:fire-out` |

### The two gaps are closed, and how

Writing the table above turned up two achievements that could not be earned
without a shim re-deriving a rule, which is the thing the seam exists to
prevent. Both were fixed in the seam rather than worked around:

- **`cookies:fire-out` now exists.** The rules counted `fires` but nothing
  counted putting one out, so there was no counter to diff. `tally.firesOut`
  is that counter, added to `stations.js` and to `stations.c` in the same
  place, since the two are a line-for-line pair and a counter in one and not
  the other is exactly the drift the pairing catches. Both host suites assert
  it at the point they already prove the third tap works.
- **`cookies:shift-end` carries `bonusLabel`.** It carried `bonus` as points
  and `mess` as a number, so a listener wanting SPOTLESS would have had to
  compare against 500 or against `CLEAN_BONUS.threshold`, both of which a
  tuning change moves without warning.

The haptics shim reads the first of these already: WARNING when the oven
catches, SUCCESS when the mash works, which is legible without looking.

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
