# makemecookies!x4, iOS

**A complete App Store port, unsubmitted.** The bundle build, the Xcode project,
the two shims, the app icon and launch image, `App.entitlements`, and every App
Store Connect field all exist, and CI checks each of them on every push. What is
outstanding is an Apple account rather than code: the paid membership, the Game
Center capability that needs it, and the leaderboard and achievements that
cannot be created until then.

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

**"The binary" is two files since Xcode 16, and the check reads both.** A Debug
build is split: this project's code compiles into `App.debug.dylib` and `App`
itself is a ~70KB launcher stub carrying none of these classes, `AppDelegate`
and `SceneDelegate` included. The step looked only at `App` and so reported
`GameCenterPlugin not in the binary` on every run from 2026-09-19 to
2026-09-23, with the project wired correctly throughout. A guard that accuses
the thing it guards is worse than no guard, because the obvious next move is to
go rewiring `project.pbxproj`, which is exactly what must not be done by hand.

Diagnosed by cloning the CI layout onto the Mac and reading both files:
`_OBJC_CLASS_$_GameCenterPlugin` was in `App.debug.dylib` all along, 186
symbols of it. If this fails again, build it there before believing it:

```
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # Xcode is
                                    # installed but xcode-select points at CLT
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/derived \
  CODE_SIGNING_ALLOWED=NO build
nm -a ~/derived/Build/Products/Debug-iphonesimulator/App.app/App.debug.dylib \
  | grep '_OBJC_CLASS_\$_GameCenterPlugin'
```

**george-boole asserts the same two things as of 2026-09-23.** Until then its
`ios-build` compiled the app and stopped, so its green said the project builds
and said nothing about whether the plugin survived into it. The step was ported
across, checked against a real build on the Mac first: the plugin is in
`App.debug.dylib` there too, so the two games agree and neither is asserting
something it cannot meet.

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

**`Package.resolved` is committed as of 2026-09-23**, pinning
`capacitor-swift-pm` **8.5.2**. Before that CI resolved it fresh on every run
and could pick a version nobody had tried, which is a poor foundation for a job
that now asserts what is in the built binary.

It was generated on the Mac host, from a clean clone in the layout CI uses, by
the same `xcodebuild` invocation the job runs. So the pin is what compiled and
what CI went green against, which is short of the bar the earlier note here set
("once the app has run on a real device") and well above the bar it replaced
(whatever resolved that morning). Re-cut it after the first device run if the
resolution moves.

george-boole pins **8.5.1**, frozen at its 2026-09-17 verification. The two
games disagreeing is the arrangement working: each holds what it was actually
built against, and neither moves because the other did.

## The Simulator build is kept now, so a tester needs no checkout and no account

`ios-build` compiled the app and threw it away. It still compiles it the same
way, and now keeps it. **The archiving is not done here**:
`hypnopompia/tools/package-sim.mjs` does it, because four projects need the
identical treatment and all four already check the shell out beside themselves.
It writes `makemecookies-sim-<date>-<game sha>-<shell sha>.zip` and a
`build.json` beside it, and both go into the one `makemecookies-sim` artifact,
kept 14 days. The id mirrors block-island-simulator's
`bis-<date>-<game>-<engine>`, and the shell's sha is in it because the vendored
plugin and the whole bundle pipeline come from hypnopompia, so two zips from one
game commit are not necessarily the same app.

**An Actions artifact needs a signed-in GitHub account to download, even from a
public repository**, so the artifact alone is not something to hand a tester.
Two things take it further, and they are not redundant with each other:

| | |
|---|---|
| The Pi | `hypnopompia/tools/deploy-sim.mjs` pulls the artifact, renders a download page from `build.json`, and puts it on magmacrunch-server at an unlisted path. `--announce` posts the link to #app-development. This is the route that works for all four projects, including the two private ones, where a release asset would need repository access |
| A prerelease | dispatch this workflow with **publish** checked and it cuts a dated prerelease with the zip attached, which is an anonymous URL because this repo is public. george-boole can do the same; crunchscope and gratinglab cannot |

The overlap is deliberate for now and may not be worth keeping. If the Pi page
becomes the only route anybody actually uses, the publish step and its
`contents: write` are the thing to delete, not the artifact, which `deploy-sim`
needs either way.

**`build.json` is the reason the page cannot lie.** The architectures, the
minimum iOS, the bundle id and the display name are read out of the built bundle
with `lipo` and `plutil` at package time, never from `project.pbxproj` or
`capacitor.config.json`. A deployment target raised without a rebuild, or a name
changed and never synced, would otherwise reach a tester as a page describing an
app that does not exist.

What a tester needs is Xcode and nothing else: no clone, no Node, no Capacitor,
no signing, no Apple ID, no UDID, no paid membership. They unzip and drag
`App.app` onto a booted simulator, or `xcrun simctl install booted App.app`. The
release notes are written by the job and say all of this, because whoever
follows the link has not read this file.

**It cannot test Game Center**, which is the one thing worth saying twice. The
build is unsigned with `CODE_SIGNING_ALLOWED=NO` and carries no entitlements, so
the leaderboard and the achievements do nothing in it, and the shim's failure
path is what runs. Haptics are equally absent, the Simulator having no taptic
engine. So this zip covers the game, the layout, the title card at a real device
shape and the ten transforms `package.mjs` applies, and stops exactly where the
paid membership starts. **Do not read a clean report from one of these as the
native seam working.**

Publishing writes a tag, which does not retrigger the workflow: the `push`
trigger is filtered to branches. The job carries `permissions: contents: write`
for the same reason the step needs saying at all, the repository default being
read.

## The Game Center plugin is vendored, and the entitlement is declared

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

**`App.entitlements` declares Game Center, and it is committed even though the
capability cannot be enabled yet.** A device build or an archive fails by name
on this entitlement until Game Center is switched on for `com.magmacrunch.makemecookies`
on the paid account. That failure is the reason the file is here rather than an
argument against it: shipping no entitlements file archives cleanly and then
fails at Game Center sign-in, at runtime, with nothing naming the cause. Loud
and early beats quiet and late, and george-boole made the same call.

CI is unaffected. A simulator build signs ad hoc and never consults the file, the
`ios-build` job passes `CODE_SIGNING_ALLOWED=NO`, and what it asserts is still
only that the plugin compiles and registers.

**That claim was checked rather than reasoned, on 2026-09-25.** The app was
built on the Mac with the entitlement in place, installed to an iPhone 17 Pro
simulator and launched: it runs, the title card draws, the orientation lock
holds and the content clears the Dynamic Island. So the entitlement costs the
simulator path nothing, which is what makes it free to commit ahead of the
account.

What that run cannot say anything about is the half the entitlement exists for.
The simulator has no Taptic Engine and no Game Center sign-in, and the shims
return `null` for a missing plugin rather than failing, so both are silently
inert there exactly as they are in a browser. **A green simulator launch is not
evidence that Game Center or haptics work**, and it never will be. That needs a
device.

Added 2026-09-24. This section said the opposite until then, and both games
answering one question two ways is what settled it.

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
| the App Store Connect entries | `shim/gamekit.js` reports to one leaderboard and eight achievements that **do not exist yet**. Creating them, and the Game Center capability itself, needs the paid membership. The ids are below and are permanent once created. The art they require is drawn and committed, by `tools/make-boards.py` into `store/game-center/`, so only the account is missing |
| a scoreboard rebuild | george-boole rebuilds its scoreboard modal inside the app; this game's is four columns and a close button, so the shim injects one GAME CENTER button into it instead |

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
| `tools/make-boards.py` | the Game Center art, one square per achievement and one for the leaderboard, into `store/game-center/` |
| `tools/make-logo.py` | the publisher's mark, `web/img/mc-logo.png`, derived from the website's logo |

Neither retypes anything. The icon parses **both** the `PAL` table and the
`SPR_COOKIE_BIG` sprite out of `web/js/pixels.js`, so a cookie recoloured *or
redrawn* in the game cannot leave the icon painting the old one, and the splash
imports the icon's backdrop rather than copying it. The font and the
publisher's mark come from the website checkout, found the way `package.mjs`
finds it.

`make-boards.py` is the same argument one step further, because its cards carry
**numbers**. The ids, points and descriptions come from `ios/shim/gamekit.js` --
from its `IDS` array and the table in its header, which it requires to agree
with each other -- and the numbers on the cards from `web/js/config.js`: the
thresholds from `STARS`, the box size from `TRAY_CAP`, the bonus name from
`CLEAN_BONUS`, and the three star titles from `STAR_LABELS`, so a tier renamed
in the game is renamed on the art. Tuning `STARS` without updating the shim's
table now fails the build by name rather than shipping a card that promises a
threshold the game does not use. Its `TITLES` map is the one editorial part and
is asserted to cover exactly the shim's ids, so a ninth achievement cannot be
added by accident.

Drawing it needs the website for the font; `--check` draws nothing and needs
only the game.

**All four generators have a `--check` and `ios-art` runs every one**, as of
2026-09-24. Until then only the icon did, and a PNG is not compiled, so a stale
launch image or mark would have gone unremarked indefinitely. They check
different things because the art is different in kind:

| | What `--check` does |
|---|---|
| `make-cookie-pixel.py` | compares **pixels** against a fresh draw |
| `make-splash.py` | redraws the launch image for its crop assertions and discards it, then checks the three files exist, are 2732x2732, and are one image |
| `make-boards.py` | every cross-check against the shim and `web/js/config.js`, then that each id has a 1024x1024 image with no alpha |
| `make-logo.py` | compares **RGBA** pixels against what the website's logo derives to |

The asymmetry is the font. The icon and the mark are pixel work, identical on
any machine. The launch image and the Game Center cards are Press Start 2P
through FreeType, which does not rasterise identically across versions or
platforms, so a pixel comparison of either is true only on whichever machine
drew it last. `make-boards.py` established that in CI at the cost of a red run,
and its header has the detail.

`make-splash.py` and `make-logo.py` both read the website, which is why
`ios-art` takes the flat layout rather than a bare checkout. `make-logo.py`'s
is the only check here that crosses a repository boundary, and the reason it
compares RGBA is that the mark is uniform white with the drawing carried
entirely in its alpha channel: an RGB comparison would be white against white
and could never fail.

The shape moved into `pixels.js` on 2026-09-22, when the title card grew a hero
cookie and would otherwise have been a third one. It had been computed in
Python, a disc with two low harmonics on the rim, which is to say it lived in
the one file the game cannot read. The palette was already parsed to prevent
exactly that class of drift; the shape was the half that got away. The port was
verified by regenerating both icons and both splashes and finding the bytes
unchanged, so this bought the guarantee and changed no art.

`make-cookie-pixel.py --check` is the drift detector for that, and the `ios-art`
job runs it on every push. The PNGs are committed artifacts, so the sprite
moving and the icon being regenerated are two acts where they used to be one,
and this is what notices the second being skipped. It compares **pixels, not
bytes**, the way moonlight-drift's `make_atlas.py --check` does: regenerating
and asking git whether anything moved fails the moment a runner's Pillow
encodes the same image with different compression.

`COOKIE_AT` is the one thing the icon still owns about the cookie: where the
25-cell sprite sits in the 32-cell grid. It is deliberately not centred: that
is where the computed disc's bounding box fell, and the margin around it is
what keeps the art inside the rounded mask iOS draws. `build_icon` asserts
that, so a fattened sprite fails there rather than shipping with a corner
shaved off.

Three things they know that are easy to learn the hard way:

- **Judge an icon at 60px.** George Boole's was fine at 1024 and a murky blob
  on a home screen, and the redraw is what put `--sheet` in both files. It
  renders 180, 120 and 60 against a light and a dark wallpaper, masked.
- **`scaleAspectFill` crops the launch image, and here it crops the HEIGHT.**
  A square covers the view, so the axis the view is shorter on is the one that
  survives only in part. `Info.plist` locks this game's iPhone to landscape, so
  a 2868x1320 phone shows the full width and the middle **46% of the height**.
  The width is cropped only by a portrait iPad, at about 75%. The script
  asserts both before writing, because the asset catalog previews the full
  square and would happily show you a wordmark that is cut in half on the
  device.

  **Those two limits were on the wrong axes until 2026-09-24.** This file was
  written from george-boole's, whose phone is portrait, so it guarded the width
  at 46% on a device that never crops the width and allowed 70% of the height
  on one that shows 46%. The art passed the whole time, at 38% and 21%, which
  is why nothing surfaced it: a guard can be pointed at the wrong axis and stay
  green for as long as the art is small. HOUSE.md now states the rule by
  orientation rather than by example.
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

## The title card is measured, not eyeballed

`ios/tools/title-card/check.mjs` renders the built bundle in headless chromium
and measures the card at seven shapes, three of them with safe-area insets. The
`ios bundle` job runs it. `--verbose` prints the table on a pass too, which is
the point as much as the pass is: a margin shrinking from 29px to 14px is worth
seeing before it reaches zero.

```
node ios/package.mjs && node ios/tools/title-card/check.mjs --verbose
```

**It exists because this failure has no other symptom.** `.title-publisher` is
absolutely positioned, so the flex column above it centres against a container
that looks empty at the bottom, and a card that grew simply runs underneath.
No error, no console warning, nothing to notice unless you open the app at the
one size where it happens. Adding the cookie to the card on 2026-09-23 cost
32px of vertical budget where there had been 29, and put the buttons 3px over
the mark on an 812x375 phone with the home-indicator inset.

It measures `ios/www/` rather than `web/`, for two reasons and the second is
the one that matters: `web/index.html` names `../shared/` files this repo does
not contain, so the page cannot be rendered from a checkout at all, and the
insets only exist in the app. The no-inset cases cover the browser version,
which is the same CSS with the insets at zero.

**Playwright cannot fake `env(safe-area-inset-*)`.** `ios.css` reads those into
`--safe-*` properties on `:root` and everything downstream uses the properties,
so the check sets them inline on the documentElement and the body padding
follows. That is what a notch does, one level down.

Its own `package.json`, so `npm ci` for a bundle build does not pull a browser.
Verified by removing the `position: static` rule and watching it fail at two
shapes by 13px and 8px, then restoring it.

## Screenshots

`tools/screenshots/` is the pair george-boole has: `shots.js` stages the app
and `capture.sh` drives the simulator. Both run on the Mac; `shots.js` is
injected into a copy of the built `.app`, never into the checkout and never
into what ships.

**Landscape, and that is a decision rather than a default.** The board is
960x420. In portrait on a phone it sits in a band across the top third with
two thirds of the screen empty, checked in a browser at 375x812 before any of
this was written. So `capture.sh` rotates the simulator before launching, and
that step is the one that can silently do nothing: there is no `simctl` verb
for rotation, so it goes through the Simulator's own menu command. The script
prints the pixel dimensions at the end for exactly that reason. Width greater
than height, or the shots are of the wrong layout.

`Info.plist` locks iPhone to landscape as of 2026-09-19, both ways up, so the
app opens correctly rather than relying on the player turning the phone. iPad
keeps all four, and that was tested rather than assumed: it was locked the same
day and reverted within the hour, because under the iOS 26 SDK
`UIRequiresFullScreen` is deprecated and a landscape-only app on a portrait
iPad is **not rotated** -- it is shown in a landscape box with black bands
above and below. The simulator capture is what showed it. Locking bought
letterboxing rather than the layout it was meant to guarantee.

So iPad screenshots are portrait, 2064x2752, full bleed and needing no
rotation at all. The phone's are landscape and do need it, which is what the
rest of this section is about.

The five frames, and why each: the title card, the line mid-shift inside a
RUSH window, the oven alight, the end-of-shift card at three stars, and the
best-shifts table. The second is the one that has to sell the game.

**`shots.js` freezes the render loop for each frame.** Staging values and then
waiting means the loop advances them before the shutter: dough moves, the tray
burns, the RUSH window closes. Each stage sets its values, stops the loop and
calls `render()` once.

It was verified before it ever reached the Mac, by serving the built bundle
and running the real file against it with its waits shortened. That found the
one thing worth finding: `st` is a top-level `let`, a global lexical binding
rather than a property of `window`, the same trap that cost george-boole five
screenshots of an empty board.

## The store text

`store/metadata.md` is every App Store Connect field written out, so the
submission is a paste rather than a writing session. Check it before pasting:

```
node ../../engines/hypnopompia/tools/check-metadata.mjs ios
```

It counts characters against Apple's limits, which the form enforces by
truncating or refusing at the moment of paste. The keyword line came back at
103 of 100 the first time, which is exactly the sort of thing nobody wants to
discover with the browser open.

`overcooked` and `diner dash` are declared forbidden in that file rather than
in the checker, which lives in another repo and cannot know one game's facts.
This game owes the genre, which is not the same as owing an app, and a keyword
bid on another app's name reads differently from a nod in the credits.

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

## Two divergences from the web version, both now closed

**Share Tech Mono is self-hosted as of 2026-09-23, and the bundle matches the
browser.** It had fallen back: `web/index.html` asks Google for two families,
the website repo's `fonts/` carried only PressStart2P and CourierPrime, and a
bundle may not fetch a font at runtime. So the four `css/` rules using it fell
through to the fallbacks they already declare, which on a phone meant the body
default and the five touchpad labels rendered in Menlo, with the credits screen
naming a font the app had never loaded.

`ShareTechMono-Regular.woff2` is in the website repo now (OFL 1.1, latin
subset, 13.5KB), `FONTS` copies it, and the CDN transform emits a second
`@font-face` beside Press Start 2P's. Verified in the built bundle rather than
assumed: both files serve 200, `document.fonts` reports both loaded, and the
family measures 129.6px against Courier New's 144.0 and a deliberately bogus
control's 133.4, so it is the real face and not a silent substitution.

**`web/index.html` self-hosts them too as of 2026-09-23, so there is no CDN
left on either side.** The page declares both `@font-face` blocks itself,
against `../../fonts/`, which names files this repo does not contain: they
resolve once `web/` has been copied into the website's `arcade/makemecookies/`,
exactly the arrangement `../shared/` has always had.

That changed what this script does about fonts. It used to strip the Google
tags and inject the `@font-face`; now the blocks are already in the page and it
only repoints the paths at the bundle's own `fonts/`, the same shape as
`pointSharedAssets`. The one thing it still rewrites is `font-display`: the
page says `swap`, which is right on the web where a fallback is readable while
a fetch is in flight, and the bundle says `block`, because the files are on the
device and the whole look arriving at once beats Menlo appearing and being
replaced.

**The sweep cannot see this, and `edit()` is what does.** `sweepSelfContained`
reads `src=` and `href=` attributes, and an `@font-face` reaches outside the
bundle through `url()`, which it does not look at. What stops a silently broken
path is the no-op-is-fatal rule: `split`/`join` moves every occurrence at once,
and a step that changes nothing kills the build. Worth knowing before adding
another CSS asset that points outside the bundle.

`arcade/tetris/` was moved off the CDN in the website repo the same day, in
`14a6c391`. **The deployed `arcade/makemecookies/` is not**, and will keep its
CDN links until somebody runs `make sync-makemecookies`; that copy is a long
way behind this repo, missing `js/moments.js` and `img/` among other things, so
the sync is a real deployment rather than a font change.

**The song is the clock, and iOS will interrupt it.** `js/main.js` drives the
shift from a plain `<audio>` element's `ended` event and `currentTime`, chosen
deliberately because AdAudio hardcodes `loop = true` and exposes neither. On iOS
the system takes the audio session for calls, backgrounding and Control Center, so
a shift can be paused or cut off from outside the game. This was the port's one
real design question. **Answered 2026-09-23: an interruption is a BREAK.**

A `pause` listener on the audio element raises the pause card, worded for the
occasion, and the shift waits. "The shift is void, tap to restart" was the other
candidate and was rejected: a 51-second shift is cheap to throw away, but the
player did nothing wrong, and somebody else's phone call is a poor reason to
lose a good run.

Pausing turns out to be the technically cleaner answer as well, not just the
kinder one. `AdRPG`'s loop skips `update()` entirely while paused, so the frame
accumulator cannot advance behind the card, and the song resumes exactly where
it stopped with the shift clock still standing where it left it. The two clocks
cannot drift apart, and no stretch of a shift is ever played in silence. It also
grants the player nothing, which is why it needs no safeguard: the PAUSE button
already stops the clock for as long as you like.

Backgrounding was already covered by the `visibilitychange` handler. The case
this closes is the one that was going unnoticed: Control Center, or another app
taking the session, which leaves the game on screen and running.

**The listener's condition is load-bearing and so is `toTitle`'s ordering.** It
fires on `running && !paused && !finished`, which is the whole of "we did not do
this ourselves", and it works only because every other place in `main.js` that
pauses the music sets those flags first. `toTitle` had to be reordered for it;
the reason is commented there. Verified against all four paths in the built
bundle: an interruption raises the card and freezes the clock, RESUME rejoins
the song within 9ms, CLOCK OUT mid-shift raises nothing, and a shift running its
full length ends on the SHIFT OVER card with no BREAK card behind it.

The monotonic guard in the clock is the backstop for anything this does not
catch, and is documented in `56126fe`.

george-boole never faced any of this: its music was ambient and its clock was
moves.

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
