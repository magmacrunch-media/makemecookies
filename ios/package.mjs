#!/usr/bin/env node
/**
 * Build the App Store bundle from `web/`.
 *
 * `web/` is the browser version and the source of truth for rules, balance and
 * presentation. It is *not* the app: it is written to be served from the arcade
 * at magmacrunch.com, so it reaches out of its own folder for shared scripts,
 * pulls two fonts off Google's CDN, and carries a chat widget. All three are
 * correct there and wrong in a bundle. This script is the difference between the
 * two, written down once instead of remembered.
 *
 *     node ios/package.mjs
 *
 * Output is `ios/www/`, which is generated and gitignored, Capacitor's webDir.
 * Never edit it; edit `web/` and rebuild.
 *
 * ## Adapted from george-boole, and the differences are the point
 *
 * george-boole's `ios/package.mjs` is the original. This is the second one, which
 * means the two together finally show which of its transforms were arcade-wide
 * and which were george-boole's own. That comparison is what `engines/hypnopompia`
 * is waiting on before the pipeline moves there, so the divergences are listed
 * rather than quietly smoothed over:
 *
 * | Transform | Here |
 * |---|---|
 * | drop chat, drop score-server, unconnect ScoreClient | identical |
 * | `../shared/` rewrite, `?v=` strip, viewport-fit, Safari metas, ios.css | identical |
 * | back-link removal | **two** links, not one (`../` and `../action/`) |
 * | self-host the font | **two families**, not one, so two `@font-face` blocks |
 * | drop `.ogg` | different mechanism: a `MUSIC_SOURCES` array, not an `AUDIO_EXT` ternary |
 * | arcade cross-promo, credits `last updated`, scoreboard rebuild | **absent here**, so not transforms at all |
 * | the four shims | **three here**: one `gamekit.js` covers scores and achievements, and `bests.js` keeps the local board the disconnected ScoreClient cannot |
 *
 * ## The guard is the point
 *
 * Every transform below asserts that it actually changed something, and the final
 * sweep fails on any surviving `../` path or off-device asset. So the failure mode
 * this script exists to prevent, the site gaining a widget one day and it quietly
 * shipping to the App Store, is a build error rather than a discovery made during
 * review. A transform that silently matches nothing is the same bug wearing a
 * different hat, which is why a no-op is also fatal.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IOS = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(IOS, '..');

// The shared half of this script lives in engines/hypnopompia, resolved by path
// the way the Wii Makefiles resolve magnolia: $HYPNOPOMPIA, then ../hypnopompia,
// then ../../engines/hypnopompia. There is no npm package and no junction for
// games/, so this is the lookup, and it fails by name rather than by a module
// error three frames deep.
const SHELL = [
  process.env.HYPNOPOMPIA && resolve(process.env.HYPNOPOMPIA),
  resolve(REPO, '..', 'hypnopompia'),
  resolve(REPO, '..', '..', 'engines', 'hypnopompia'),
].filter(Boolean).find((r) => existsSync(join(r, 'pipeline', 'index.mjs')));

if (!SHELL) {
  console.error('\npackage.mjs: no hypnopompia checkout found.');
  console.error(
    'The shared bundle pipeline lives there. Looked for pipeline/index.mjs under\n'
    + '  $HYPNOPOMPIA, ../hypnopompia, ../../engines/hypnopompia\n'
    + 'Set HYPNOPOMPIA=<path to the hypnopompia checkout> to look elsewhere.'
  );
  process.exit(1);
}

const { createBuild, transforms } = await import(
  pathToFileURL(join(SHELL, 'pipeline', 'index.mjs')).href
);

/**
 * Files in `web/` that exist for developing the browser version and have no
 * business in a shipped bundle.
 *
 * Empty, and deliberately so rather than by oversight: this game's `web/` is
 * index.html, css/, js/ and audio/ with no test pages, guides or second entry
 * point. george-boole's list exists because it has all four. Kept as an empty set
 * so the next game has somewhere obvious to put its own.
 */
const EXCLUDE = new Set([]);

/**
 * Every `../shared/` file `web/index.html` is allowed to name, and what to do
 * with it. An unlisted one stops the build.
 *
 * This allowlist is the whole safety mechanism. The arcade's shared folder is
 * maintained in the website repo by people who are not thinking about the App
 * Store, and a page that gains a script there gains it here on the next sync.
 * Defaulting to "vendor whatever we find" would carry that into the bundle
 * unread; defaulting to "drop what we don't know" would silently break the game.
 * Refusing to guess is the only option that cannot ship a surprise.
 *
 * Six of these seven classify exactly as george-boole's do. Only the engine
 * differs, `adenosine-rpg` for `adenosine-puzzle`, and this game vendors no
 * `adenosine-audio` because the song is a plain `<audio>` element rather than a
 * decoded buffer (see js/main.js on why AdAudio cannot own it). So the drop list
 * is arcade policy and the vendor list is arcade infrastructure plus one line
 * per game, which is the shape the shared version of this file should take.
 */
const SHARED = {
  'arcade-base.css': 'vendor',
  'adenosine-score-client.js': 'vendor',
  'adenosine-rpg.js': 'vendor',

  // Resolves a WebSocket host for the leaderboard, defaulting to a port on the
  // Raspberry Pi behind magmacrunch.duckdns.org. In a bundle the hostname is
  // Capacitor's own, so `auto()` would dial localhost and retry forever. See the
  // bootstrap rewrite below, which drops this and leaves ScoreClient unconnected.
  'score-server.js': 'drop',

  // User-generated content. Shipping it means App Store Review Guideline 1.2: a
  // EULA, content filtering, a report mechanism, a block mechanism and published
  // contact details, plus the age rating that follows. The website keeps all
  // three of these; the app does not.
  'chat-widget.css': 'drop',
  'adenosine-chat.js': 'drop',
  'chat-server.js': 'drop',
};

/**
 * Self-hostable font files, copied from the website repo.
 *
 * **Both families `web/index.html` asks Google for are available as of
 * 2026-09-23.** Until then the website's `fonts/` carried only PressStart2P and
 * CourierPrime, and since a bundle may not fetch a font at runtime, the four
 * `css/` rules using Share Tech Mono fell through to the fallbacks they already
 * declare: `'Courier New', monospace` in `base.css` and bare `monospace` in
 * `layout.css` and `modals.css`. That was most of the game's non-pixel text on
 * a phone -- the body default and the five touchpad labels among it -- rendered
 * in Menlo, with the credits screen naming a font the app had never loaded.
 *
 * `ShareTechMono-Regular.woff2` is in the website repo now, so both are
 * self-hosted here and the bundle matches the browser. The website itself still
 * takes both families off Google's CDN; moving it off touches tetris as well
 * and is a change of its own.
 *
 * A family added to `web/index.html` without its file being added here is the
 * case this list exists to make visible: `copyFonts` fails by name on a missing
 * file rather than shipping a bundle that quietly falls back.
 */
const FONTS = [
  'PressStart2P-Regular.woff2',
  'PressStart2P-Regular.ttf',
  'ShareTechMono-Regular.woff2',
];

/**
 * Scripts that exist only in the app.
 *
 * Injected after the ScoreClient bootstrap and before js/moments.js, so a
 * listener registered at load time is in place before anything can dispatch.
 * They listen to the `cookies:*` events main.js announces and never reach into
 * the game, which is what keeps them out of web/ and keeps the site free of a
 * Capacitor dependency.
 */
const SHIMS = ['gamekit.js', 'haptics.js', 'bests.js'];

// `adenosine-rpg.js` is this game's engine, and probing for it rather than for
// any shared file is what stops a website checkout that cannot build this game
// from being accepted as one that can.
const build = createBuild({ ios: IOS, probe: 'adenosine-rpg.js' });
const { OUT, die, edit, editFile } = build;
const website = build.website;

// ── copy web/ ────────────────────────────────────────────────────────────────

const oggDropped = build.copyWeb({ exclude: EXCLUDE, drop: (rel) => rel.endsWith('.ogg') });

if (!oggDropped) {
  die(
    'no .ogg files were dropped from the bundle.',
    'web/audio/ is supposed to carry both .ogg and .mp3 for the song, and the iOS\nbundle only ever plays the .mp3. Finding none means the audio layout changed --\ncheck that the .mp3 is still there before assuming this step is obsolete.'
  );
}

// Removing the file is only half of it: main.js still ASKS for it. MUSIC_SOURCES
// lists the ogg first and picks the first entry canPlayType does not reject, so
// on WebKit it correctly falls to the mp3 -- and in Chrome or Firefox it picks an
// ogg that is no longer there and 404s. That breaks the one way this bundle can
// be tested without a Mac, and it breaks it in the direction that looks like the
// audio work being wrong.
//
// Note this is a different shape from george-boole's, which pins a single
// AUDIO_EXT ternary. Same lesson, different code, which is worth knowing when
// this moves into the shared pipeline: the transform cannot be one regex.
editFile('js/main.js', 'reduce MUSIC_SOURCES to the mp3', (js) =>
  js.replace(
    /const MUSIC_SOURCES = \[[\s\S]*?\];/,
    [
      '// ios/package.mjs: this bundle ships no .ogg, so the probe has one candidate.',
      'const MUSIC_SOURCES = [',
      "  { url: 'audio/makemecookies-x4.mp3', type: 'audio/mpeg' },",
      '];',
    ].join('\n')
  )
);

const state = build.openPage();

// ── what the page asks for, checked against the allowlist ────────────────

build.checkAllowlist(state, SHARED);

// ── transforms ───────────────────────────────────────────────────────────────

const dropped = Object.keys(SHARED).filter((f) => SHARED[f] === 'drop');

// Two inline scripts here, not one: `const { ChatWidget } = AdChat;` and
// `ChatWidget.connect(MC_CHAT_OPTS);`. Matching on either identifier catches
// both, and leaving one behind would throw on a missing AdChat and take the
// page down with it.
edit(state, 'drop chat and score-server tags', (html) =>
  html
    .split('\n')
    .filter((line) => !dropped.some((f) => line.includes(`../shared/${f}`)))
    .filter((line) => !/<script>[^<]*(ChatWidget|AdChat)[^<]*<\/script>/.test(line))
    .join('\n')
);

edit(state, 'unconnect ScoreClient', (html) =>
  html.replace(
    /new AdScore\.ScoreClient\(\)\.auto\(MC_SCORE_OPTS\)/,
    'new AdScore.ScoreClient() /* never connected: no arcade board in the app */'
  )
);

// After the transform above, so it matches the unconnected form. The anchor is
// the ScoreClient bootstrap rather than js/main.js, because a shim has to be
// listening before main.js can dispatch anything and script order is the only
// thing guaranteeing that.
transforms.loadShims(build, state, SHIMS);

// Both of them: the arcade root and the category crumb. Neither exists in a
// bundle, and a dead link on the title screen is the kind of thing a reviewer
// taps first.
edit(state, 'remove the arcade back-links', (html) =>
  html
    .replace(/[ \t]*<a href="\.\.\/" class="mc-back"[^>]*>.*?<\/a>\r?\n/, '')
    .replace(/[ \t]*<a href="\.\.\/action\/" class="mc-crumb"[^>]*>.*?<\/a>\r?\n/, '')
);

// The page self-hosts both faces itself now, so there is no CDN here to strip
// and no @font-face to inject: the two blocks live in web/index.html and this
// only has to point them at the copies copyFonts puts beside the page. Same
// shape as pointSharedAssets, and for the same reason -- `../../fonts/`
// resolves in the website's arcade/, not in a bundle.
//
// split/join rather than a regex so every occurrence moves together, and edit()
// is fatal when a step changes nothing, so a path that stops matching stops the
// build rather than shipping a page whose fonts silently 404. That guard is
// worth naming because the self-contained sweep cannot stand in for it here:
// it reads src= and href= attributes, and an @font-face reaches outside the
// bundle through url(), which it does not look at.
edit(state, 'point the fonts at the bundle', (html) =>
  html.split('../../fonts/').join('fonts/')
);

// The bundle overrides the page's `swap` to `block`. On the web a swap is the
// right trade, because the text is readable in a fallback while a network
// fetch is in flight. In the app the files are on the device and the wait is
// a few frames, so the whole look arriving at once beats Menlo appearing and
// being replaced.
edit(state, 'font-display: block, not swap', (html) =>
  html.split('font-display: swap;').join('font-display: block;')
);

transforms.pointSharedAssets(build, state);

transforms.stripStamps(build, state);

transforms.viewportNotch(build, state);

// ── the double tap ───────────────────────────────────────────────────────────
//
// It zoomed the page, and CSS could not stop it. `touch-action: manipulation`
// is the web's answer and is in base.css, where it also serves the site -- but
// in WKWebView the double-tap-to-zoom gesture is the web view's own recogniser
// and does not consult it. Reported from the Simulator after the CSS shipped
// and was verified to be in the installed bundle, which is what sent this
// looking one layer down.
//
// Capacitor looks like it has this covered and does not. `zoomEnabled` defaults
// to false, which sounds decisive, and all it does is
// `scrollViewWillBeginZooming` -> `pinchGestureRecognizer.isEnabled = false`
// (WebViewDelegationHandler.swift). That is the PINCH, and it is switched off
// only once a zoom has begun. Nothing there touches the double tap.
//
// The viewport meta does reach it, and it works here because Capacitor never
// sets `ignoresViewportScaleLimits` -- so WKWebView still honours scale limits,
// unlike Mobile Safari, which has ignored `user-scalable=no` since iOS 10.
//
// It takes nothing away that the app had: pinch is already gone, by
// Capacitor's own default. Deliberately not in hypnopompia's shared
// viewportNotch, which four apps use -- this is a game played by mashing five
// buttons, and a page that is read rather than tapped can want the opposite.
edit(state, 'no double-tap zoom', (html) =>
  html.replace(
    /(<meta name="viewport" content="[^"]*?)(">)/,
    (_, head, tail) =>
      (head.includes('user-scalable') ? _ : `${head}, maximum-scale=1.0, user-scalable=no${tail}`)
  )
);

// ── what the app is built on, which is not what the page is ──────────────────
//
// The site runs adenosine over a canvas and nothing else. The app is that page
// inside a WKWebView that Capacitor provides, with hypnopompia's Swift in the
// binary: GameCenterPlugin and GameViewController, vendored byte-identical and
// listed in that repo's consumers.json. So the app's line credits three layers
// and the site's credits one, because they are different things, and a shared
// credits panel that named all three would be wrong in a browser.
//
// Capacitor is the one with an obligation attached rather than a courtesy: it
// is MIT, and somebody else's. hypnopompia and adenosine are ours, and are
// here because a public repo in a credits panel is a door rather than a boast.
//
// The typefaces come out of this line and belong on the acknowledgements page
// at magmacrunch.com, with the licences in full. Four short entries is what
// keeps this panel on one landscape screen, and BUILT WITH is the line with
// the least room left.
//
// Before the outbound-links transform below, so these two get target="_blank"
// from that rule rather than carrying their own copy of it.
edit(state, 'credits: the layers the app actually runs on', (html) =>
  html.replace(
    /<a href="https:\/\/magmacrunch\.com\/ware\/adenosine\/">adenosine<\/a>\s*\n?\s*&middot; Press Start 2P &middot; Share Tech Mono/,
    '<a href="https://magmacrunch.com/ware/adenosine/">adenosine</a>\n'
      + '          &middot; <a href="https://magmacrunch.com/ware/hypnopompia/">hypnopompia</a>\n'
      + '          &middot; <a href="https://capacitorjs.com">Capacitor</a>'
  )
);

// Before the transform below, deliberately: that one turns every outbound
// link into one that opens Safari, and this mark is the one link that must not
// be tappable at all. A player who has not clocked in yet should not be one
// mis-tap away from a website.
edit(state, 'unlink the title screen publisher mark', (html) =>
  html.replace(
    /<a class="title-publisher-link" href="https:\/\/magmacrunch\.com">([\s\S]*?)<\/a>/,
    '<span class="title-publisher-link">$1</span>'
  )
);

transforms.outboundLinks(build, state);

edit(state, 'let Safari run it like an app', (html) =>
  html.replace(
    /(<meta name="viewport"[^>]*>)/,
    `$1\n<meta name="apple-mobile-web-app-capable" content="yes">\n` +
      `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
  )
);

edit(state, 'add the iOS stylesheet', (html) =>
  html.replace(/(\r?\n)<\/head>/, '$1<link rel="stylesheet" href="css/ios.css">$1</head>')
);

build.writePage(state);

// ── vendor what the page still needs ─────────────────────────────────────────

const vendored = build.vendorShared(SHARED);
build.copyShims(SHIMS);
build.copyFonts(FONTS);

writeFileSync(
  join(OUT, 'css', 'ios.css'),
  `/* Generated by ios/package.mjs -- edit the script, not this file.
 *
 * Everything the browser version has no reason to carry. Kept out of web/css/ so
 * the site is never asked to reason about a home indicator.
 */

:root {
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-right: env(safe-area-inset-right, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-left: env(safe-area-inset-left, 0px);
}

body {
    padding:
        var(--safe-top) var(--safe-right)
        var(--safe-bottom) var(--safe-left);
    /* A bundle has nowhere to scroll to, and rubber-banding the whole page under
       a fixed canvas reads as a bug rather than as elasticity. */
    overscroll-behavior: none;
}

/* The body padding above is right for the game screen, which is in normal
   flow, and reaches none of the overlays: #title-overlay and .modal-overlay are
   position: fixed against the viewport, so they are laid out as though the
   notch and the home indicator were not there. Left alone, CLOCK IN and the
   end-of-shift buttons sit under the home indicator on every modern iPhone.

   Both are over-constrained absolutely positioned boxes -- inset: 0 with width
   auto -- so padding shrinks the content box rather than overflowing it, which
   is why the title card's existing 24px works and why these can simply add. */
.modal-overlay {
    padding:
        var(--safe-top) var(--safe-right)
        var(--safe-bottom) var(--safe-left);

    /* An iPhone held in landscape is about as tall as the end-of-shift card,
       and once the insets are taken out it can be shorter. A flex container
       centring an over-tall child clips it at BOTH ends, with no way to scroll
       back to the top, so the buttons go under the home indicator and the
       heading goes off the top. align-items:flex-start plus margin:auto on the
       card is the pair that centres when there is room and degrades to
       scrolling when there is not. */
    align-items: flex-start;
    overflow-y: auto;
}

.modal-overlay > .modal {
    margin: auto;
}

#title-overlay {
    padding:
        calc(24px + var(--safe-top)) calc(24px + var(--safe-right))
        calc(24px + var(--safe-bottom)) calc(24px + var(--safe-left));
}

/* The board already sets these; everything else in the app wants them too, or a
   long press offers to copy a tile.

   The zoom half of the old comment here was wrong twice over, which is worth
   leaving recorded. It claimed these two rules stop "a mistimed second tap"
   zooming: they do not, and neither -webkit-touch-callout nor the tap highlight
   has anything to do with zoom. touch-action: manipulation was added next and
   did not stop it either, because in WKWebView the double tap is the web view's
   own gesture recogniser and never consults CSS. That rule now lives in
   base.css, where it is right for the site, and the app's answer is the
   viewport meta -- see the transform named "no double-tap zoom" above. */
* {
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
}

/* No initials in the app.
   Every finished shift is already reported to Game Center by shim/gamekit.js,
   without being asked for anything, and the arcade board SUBMIT posts to is
   the one 'unconnect ScoreClient' disconnects a few transforms up -- so the
   field asked a player to name a score that was going nowhere. shim/bests.js
   keeps BEST SHIFTS on the device instead, filed by date.

   It was also 80px of the end-of-shift card, which is why that card did not
   fit a landscape phone: see the measurements in modals.css. Hidden rather
   than removed because endShift() clears the field by id on every shift and
   would throw on a missing element, taking the card down with it. */
#initials-input,
#btn-submit {
    display: none;
}

button,
[role="button"],
.modal,
.overlay {
    -webkit-user-select: none;
    user-select: none;
}
`
);

// ── the sweep ────────────────────────────────────────────────────────────────

build.sweepSelfContained();

// ── report ───────────────────────────────────────────────────────────────────

console.log(`ios/www/ built from web/`);
console.log(`  website checkout   ${website}`);
console.log(`  transforms         ${state.applied.length}`);
for (const t of state.applied) console.log(`      - ${t}`);
console.log(`  vendored           ${vendored.join(', ')}`);
console.log(`  dropped            ${dropped.join(', ')}`);
console.log(`  fonts              ${FONTS.join(', ')}`);
console.log(`  ogg left out       ${oggDropped} file(s) -- iOS decodes the mp3`);
console.log(`  self-contained     yes (no ../ paths, no network assets)`);
console.log(
  `\nThe bundle, the Xcode project, the art and the store text all exist. Still missing:`
    + `\n  - the leaderboard and the eight achievements are reported but do not exist in App Store Connect yet`
    + `\n  - the Game Center capability, which needs the paid membership (App.entitlements declares it already)`
    + `\n  - magmacrunch.com/privacy/makemecookies/ and /support/makemecookies/, which live in the website repo`
);
