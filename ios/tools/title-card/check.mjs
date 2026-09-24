#!/usr/bin/env node
/**
 * The title card fits, at every shape a phone or iPad can hand it.
 *
 *     node ios/tools/title-card/check.mjs            # needs ios/www built
 *     node ios/tools/title-card/check.mjs --verbose  # print every measurement
 *
 * ## Why this exists
 *
 * `.title-publisher` is absolutely positioned at the foot of the card, so
 * nothing in the flow above it can see it. The flex column centres its content
 * against a container that looks empty at the bottom, and whatever is last
 * simply runs underneath. There is no error, no console warning and no visual
 * hint until somebody opens the app on the one phone size where it happens.
 *
 * That is not hypothetical. Adding the cookie to the card on 2026-09-23 cost
 * 32px of vertical budget, of which there had been 29 -- and on an 812x375
 * phone with the home-indicator inset the buttons finished 3px OVER the mark.
 * The fix was to make the mark a flex item on short viewports, which makes the
 * overlap impossible rather than merely absent; this is what notices if that
 * rule is removed, or if the next thing added to the card eats the margin
 * another way.
 *
 * ## Why it measures the bundle rather than web/
 *
 * Two reasons, and the second is the important one. web/index.html names
 * `../shared/` files that are not in this repo, so the page cannot be rendered
 * from a checkout at all; `ios/www/` is self-contained by construction. And
 * the insets only exist in the app: `ios.css` pads the body by the safe-area,
 * which is exactly what turned 29px of clearance into -3. Running the no-inset
 * cases covers the browser version, since the card is the same CSS with the
 * insets at zero.
 *
 * ## Why the insets are set rather than emulated
 *
 * Playwright cannot fake `env(safe-area-inset-*)`. `ios.css` reads those into
 * `--safe-*` custom properties on `:root` and everything else uses the
 * properties, so an inline style on the documentElement overrides them and the
 * body padding follows. That is the same thing a notch does, one level down.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = resolve(HERE, '../../www');
const VERBOSE = process.argv.includes('--verbose');

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The shapes worth checking, and why each is here rather than a sweep of
 * every size Apple sells. The landscape phones are the tight ones: the card
 * has about 440pt of height there for the cookie, four title lines, the rule,
 * three buttons and the mark, and Info.plist locks iPhone to landscape, so it
 * is the shape the app actually opens in.
 */
const CASES = [
  // 375pt is the shortest landscape phone still supported, and is where the
  // cookie regression showed up. The 50/21 insets are an iPhone 13 mini's.
  { name: 'phone landscape 812x375, notch', w: 812, h: 375,
    insets: { top: 0, right: 50, bottom: 21, left: 50 } },
  // An iPhone 14 Pro, the shape most of these screenshots are taken at.
  { name: 'phone landscape 844x390, notch', w: 844, h: 390,
    insets: { top: 0, right: 59, bottom: 21, left: 59 } },
  // An SE: no notch, no indicator, and the least height of the three.
  { name: 'phone landscape 667x375, no notch', w: 667, h: 375, insets: NONE },
  // Portrait is the browser version's shape, and the iPad's.
  { name: 'phone portrait 390x844, notch', w: 390, h: 844,
    insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { name: 'phone portrait 375x667, no notch', w: 375, h: 667, insets: NONE },
  { name: 'ipad portrait 1024x1366', w: 1024, h: 1366, insets: NONE },
  { name: 'ipad landscape 1366x1024', w: 1366, h: 1024, insets: NONE },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

function serve(root) {
  const server = createServer((req, res) => {
    let p = join(root, decodeURIComponent(req.url.split('?')[0]));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!p.startsWith(root) || !existsSync(p)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Measure one shape. Returns the numbers; the caller decides what fails. */
async function measure(page, { w, h, insets }) {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate((i) => {
    const s = document.documentElement.style;
    s.setProperty('--safe-top', `${i.top}px`);
    s.setProperty('--safe-right', `${i.right}px`);
    s.setProperty('--safe-bottom', `${i.bottom}px`);
    s.setProperty('--safe-left', `${i.left}px`);
  }, insets);
  await page.evaluate(() => document.fonts.ready);
  // The fonts land after layout, and Press Start 2P is a good deal taller than
  // the fallback, so measuring before they arrive measures a shorter card.
  await page.waitForTimeout(150);

  return page.evaluate((inset) => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height };
    };
    const overlay = document.getElementById('title-overlay');
    const buttons = box('.title-buttons');
    const mark = box('.title-publisher');
    const start = box('#btn-start-title');
    return {
      buttons, mark, start,
      overflowPx: overlay.scrollHeight - overlay.clientHeight,
      floor: window.innerHeight - inset.bottom,
      viewportH: window.innerHeight,
    };
  }, insets);
}

function faultsIn(m, name) {
  const faults = [];
  if (!m.buttons || !m.mark || !m.start) {
    faults.push(`${name}: the card is missing an element the check measures`);
    return faults;
  }
  const clearance = Math.round(m.mark.top - m.buttons.bottom);
  if (clearance < 0) {
    faults.push(`${name}: the buttons overlap the publisher's mark by ${-clearance}px`);
  }
  if (m.mark.bottom > m.floor + 0.5) {
    faults.push(
      `${name}: the mark runs ${Math.round(m.mark.bottom - m.floor)}px under the home indicator`
    );
  }
  if (m.start.bottom > m.floor + 0.5) {
    faults.push(
      `${name}: CLOCK IN runs ${Math.round(m.start.bottom - m.floor)}px under the home indicator`
    );
  }
  if (m.start.top < 0 || m.start.bottom > m.viewportH + 0.5) {
    faults.push(`${name}: CLOCK IN is off screen`);
  }
  if (m.overflowPx > 0) {
    faults.push(`${name}: the card is ${m.overflowPx}px taller than the screen`);
  }
  return faults;
}

async function main() {
  if (!existsSync(join(WWW, 'index.html'))) {
    console.error('ios/www/ is not built. Run: node ios/package.mjs');
    process.exit(2);
  }

  const server = await serve(WWW);
  const { port } = server.address();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

  const faults = [];
  const rows = [];
  for (const c of CASES) {
    const m = await measure(page, c);
    faults.push(...faultsIn(m, c.name));
    rows.push([
      c.name,
      m.buttons ? `${Math.round(m.mark.top - m.buttons.bottom)}px` : '-',
      m.mark ? `${Math.round(m.floor - m.mark.bottom)}px` : '-',
      `${m.overflowPx}px`,
    ]);
  }

  await browser.close();
  server.close();

  const head = ['shape', 'buttons/mark', 'mark/floor', 'overflow'];
  const wcol = head.map((hcell, i) => Math.max(hcell.length, ...rows.map((r) => r[i].length)));
  const line = (r) => '  ' + r.map((c, i) => c.padEnd(wcol[i])).join('  ');
  if (VERBOSE || faults.length) {
    console.log(line(head));
    for (const r of rows) console.log(line(r));
    console.log('');
  }

  if (faults.length) {
    console.error(`the title card does not fit (${faults.length} problem(s)):`);
    for (const f of faults) console.error(`  ${f}`);
    console.error(
      '\n`.title-publisher` is absolutely positioned, so nothing in the flow above it\n'
      + 'can see it and a card that grew will simply run underneath. On short\n'
      + 'viewports css/title.css makes it a flex item for that reason; if that rule\n'
      + 'is gone, put it back rather than trimming whatever grew.'
    );
    process.exit(1);
  }

  console.log(`the title card fits at all ${CASES.length} shapes checked`);
}

await main();
