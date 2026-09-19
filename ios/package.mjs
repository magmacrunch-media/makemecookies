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
 * | self-host the font | **two families**, and only one is self-hostable (below) |
 * | drop `.ogg` | different mechanism: a `MUSIC_SOURCES` array, not an `AUDIO_EXT` ternary |
 * | arcade cross-promo, credits `last updated`, scoreboard rebuild | **absent here**, so not transforms at all |
 * | the four shims | **none yet**, see the note at the bottom |
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

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IOS = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(IOS, '..');
const WEB = join(REPO, 'web');
const OUT = join(IOS, 'www');

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
 * **`web/index.html` asks Google for two families and only this one is
 * available.** `Share Tech Mono` is used by four rules in `css/` and is credited
 * on the credits screen, but the website repo's `fonts/` carries only
 * PressStart2P and CourierPrime. A bundle may not fetch it at runtime, so until
 * somebody adds `ShareTechMono-Regular.woff2` to the website, those four rules
 * fall through to the fallbacks they already declare: `'Courier New', monospace`
 * in `base.css` and bare `monospace` in `layout.css` and `modals.css`.
 *
 * That is a visible difference from the web version, not a broken bundle, and it
 * is recorded here rather than left to be noticed on a device. Adding the file to
 * the website repo is the real fix and would benefit the site too, which
 * currently depends on Google's CDN for it.
 */
const FONTS = ['PressStart2P-Regular.woff2', 'PressStart2P-Regular.ttf'];

function die(msg, detail) {
  console.error(`\npackage.mjs: ${msg}`);
  if (detail) console.error(detail);
  process.exit(1);
}

/**
 * Find a website checkout, the same way everything else here resolves a sibling
 * repo: the documented flat layout first, then the grouped tree, with an env
 * override for anywhere else. Mirrors the Wii Makefile's MAGNOLIA.
 */
function findWebsite() {
  const roots = [];
  if (process.env.WEBSITE) roots.push(resolve(process.env.WEBSITE));
  roots.push(resolve(REPO, '..', 'website'));
  roots.push(resolve(REPO, '..', '..', 'web', 'website'));
  const found = roots.find((r) => existsSync(join(r, 'arcade', 'shared', 'adenosine-rpg.js')));
  if (!found) {
    die(
      'no website checkout found.',
      `The shared arcade scripts and the self-hosted fonts live there, not in this repo.\nLooked in:\n${roots.map((r) => `  ${r}`).join('\n')}\nSet WEBSITE=<path to the magmacrunch.com checkout> to look elsewhere.`
    );
  }
  return found;
}

/** Apply one named edit to a file in `www/` other than the page, no-op fatal. */
function editFile(rel, name, fn) {
  const p = join(OUT, rel);
  if (!existsSync(p)) die(`the "${name}" step has nothing to edit: ${rel} is not in the bundle.`);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) {
    die(
      `the "${name}" step matched nothing.`,
      `web/${rel} no longer looks the way this script expects. That is not\nnecessarily a problem with the file -- but it means the bundle would be\nbuilt on an assumption that has stopped being true, so it stops here.`
    );
  }
  writeFileSync(p, after);
  return name;
}

/** Apply one named edit to the page, and fail if it changed nothing. */
function edit(state, name, fn) {
  const next = fn(state.html);
  if (next === state.html) {
    die(
      `the "${name}" step matched nothing.`,
      'web/index.html no longer looks the way this script expects. That is not\nnecessarily a problem with the page -- but it means the bundle would be\nbuilt on an assumption that has stopped being true, so it stops here.'
    );
  }
  state.html = next;
  state.applied.push(name);
}

const website = findWebsite();
const shared = join(website, 'arcade', 'shared');
const siteFonts = join(website, 'fonts');

// ── copy web/ ────────────────────────────────────────────────────────────────

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The song ships twice, .ogg and .mp3. iOS has no Ogg Vorbis decoder and every
// browser on iOS is WebKit, so the .ogg is bytes this bundle can never decode.
// Safe to drop *only* here, and only because the runtime is WebKit by definition;
// `web/` keeps both, since it is served to Firefox too, where the ogg is the file
// almost everyone receives.
let oggDropped = 0;
cpSync(WEB, OUT, {
  recursive: true,
  filter: (src) => {
    const rel = relative(WEB, src).split('\\').join('/');
    if (rel.endsWith('.ogg')) {
      oggDropped += 1;
      return false;
    }
    return rel === '' || !EXCLUDE.has(rel);
  },
});

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

const indexPath = join(OUT, 'index.html');
const state = { html: readFileSync(indexPath, 'utf8'), applied: [] };

// ── what the page asks for, checked against the allowlist ────────────────────

const asked = [...state.html.matchAll(/\.\.\/shared\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
const unknown = [...new Set(asked)].filter((f) => !(f in SHARED));
if (unknown.length) {
  die(
    `web/index.html names ${unknown.length} shared file(s) this script does not know about:`,
    `${unknown.map((f) => `  ../shared/${f}`).join('\n')}\n\nDecide what each one is and add it to SHARED as 'vendor' or 'drop'.\nRefusing to guess: vendoring an unread script could ship anything the\narcade picked up, and dropping it silently could break the game.`
  );
}

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

// Both of them: the arcade root and the category crumb. Neither exists in a
// bundle, and a dead link on the title screen is the kind of thing a reviewer
// taps first.
edit(state, 'remove the arcade back-links', (html) =>
  html
    .replace(/[ \t]*<a href="\.\.\/" class="mc-back"[^>]*>.*?<\/a>\r?\n/, '')
    .replace(/[ \t]*<a href="\.\.\/action\/" class="mc-crumb"[^>]*>.*?<\/a>\r?\n/, '')
);

// Press Start 2P only. Share Tech Mono has no self-hosted file, so its four
// rules fall back; see the FONTS comment above for why that is a recorded
// tradeoff rather than an oversight.
edit(state, 'self-host Press Start 2P and drop the CDN', (html) =>
  html
    .replace(/[ \t]*<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\r?\n/g, '')
    .replace(
      /[ \t]*<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/,
      [
        '<style>',
        "    @font-face {",
        "        font-family: 'Press Start 2P';",
        "        src: url('fonts/PressStart2P-Regular.woff2') format('woff2'),",
        "             url('fonts/PressStart2P-Regular.ttf') format('truetype');",
        '        font-display: block;',
        '    }',
        '    /* Share Tech Mono is not self-hosted; css/ already declares its fallbacks. */',
        '</style>',
      ].join('\n')
    )
);

edit(state, 'point shared assets at the bundle', (html) => html.replace(/\.\.\/shared\//g, 'shared/'));

edit(state, 'strip cache-buster stamps', (html) => html.replace(/\?v=[0-9a-f]{8}/g, ''));

edit(state, 'let the viewport reach the notch', (html) =>
  html.replace(
    /(<meta name="viewport" content="[^"]*?)(">)/,
    (_, head, tail) => (head.includes('viewport-fit') ? _ : `${head}, viewport-fit=cover${tail}`)
  )
);

edit(state, 'open outbound links in the system browser', (html) =>
  html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"')
);

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

writeFileSync(indexPath, state.html);

// ── vendor what the page still needs ─────────────────────────────────────────

mkdirSync(join(OUT, 'shared'), { recursive: true });
const vendored = Object.keys(SHARED).filter((f) => SHARED[f] === 'vendor');
for (const f of vendored) {
  const src = join(shared, f);
  if (!existsSync(src)) die(`shared asset missing from the website checkout: ${src}`);
  cpSync(src, join(OUT, 'shared', f));
}

mkdirSync(join(OUT, 'fonts'), { recursive: true });
for (const f of FONTS) {
  const src = join(siteFonts, f);
  if (!existsSync(src)) die(`font missing from the website checkout: ${src}`);
  cpSync(src, join(OUT, 'fonts', f));
}

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

/* The board already sets these; everything else in the app wants them too, or a
   mistimed second tap zooms the page and a long press offers to copy a tile. */
* {
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
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

const TEXT = /\.(html|css|js|mjs|json|txt|md)$/i;
const offences = [];

function sweep(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      sweep(p);
      continue;
    }
    if (!TEXT.test(name)) continue;
    const rel = relative(OUT, p).split('\\').join('/');
    readFileSync(p, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/(?:src|href)\s*=\s*["']\.\.\//.test(line)) {
          offences.push(`${rel}:${i + 1}  reaches outside the bundle: ${line.trim()}`);
        }
        if (/<(?:script|link|img|source|video|audio)\b[^>]*(?:src|href)\s*=\s*["']https?:/i.test(line)) {
          offences.push(`${rel}:${i + 1}  loads an asset over the network: ${line.trim()}`);
        }
      });
  }
}
sweep(OUT);

if (offences.length) {
  die(
    `the bundle is not self-contained (${offences.length} problem(s)):`,
    `${offences.map((o) => `  ${o}`).join('\n')}\n\nAn App Store build has to run with the network off -- Guideline 4.2 treats a\npage that needs a server to be useful as a web page in a wrapper. Vendor the\nasset in this script, or remove the reference in web/.`
  );
}

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
  `\nStep 1 only. No Xcode project, no shims, no icon yet:`
    + `\n  - haptics and achievements need an event seam in web/js/, which does not exist`
    + `\n  - the scoreboard shim does not apply: there is no #scoreboardModal here`
    + `\n  - leaderboard ids are undecided and permanent once created (see issue #1)`
    + `\n  - Share Tech Mono falls back; see the FONTS note in this file`
);
