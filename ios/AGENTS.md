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
| haptics | needs an event seam in `web/js/`; this game dispatches no `CustomEvent`s at all, unlike george-boole's `boole:*`. `@capacitor/haptics` is deliberately not installed either, so the app currently bundles no plugin from npm at all |
| a scoreboard shim | there is no `#scoreboardModal` here, so george-boole's 237-line rebuild has nothing to attach to |
| Game Center leaderboards and achievements | ids are permanent once created in App Store Connect, and this game has no difficulty ladder to key them on. See issue #1, which works out the shift's ceiling so thresholds can be derived rather than guessed |
| an app icon and launch image | **worse than missing: `cap add` supplied Capacitor's own defaults**, a 1024px logo and three 2732px splashes. So this builds and archives without complaint while shipping stock Capacitor branding, which is the kind of gap that does not announce itself. Replace both before submission; george-boole's `tools/make-boole-pixel.py` is the pattern, and its lesson was to judge an icon at 60, 120 and 180px rather than at 1024 |
| `store/metadata.md` | needs `engines/hypnopompia/tools/check-metadata.mjs`, which is ready and takes a path. Note the privacy and support URLs App Store Connect requires do not exist for this app yet |
| `App.entitlements` | see the Game Center section above |

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
