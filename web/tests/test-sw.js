/**
 * test-sw.js -- which caching strategy the service worker picks, and why.
 *
 * Run: node tests/test-sw.js
 *
 * ## Why this is tested here rather than in a browser
 *
 * The bug this file was written after could not be seen by looking at the page.
 * sw.js precached "./css/base.css" while index.html requested
 * "css/base.css?v=c634b661", cache.match compares the query string unless told
 * not to, and so every precached entry sat under a key nothing asked for. The
 * site worked perfectly. It simply had no offline support, and nothing said so.
 *
 * A service worker also cannot be exercised from the preview pane, which
 * refuses to register one at all. So the routing is tested the way the shim
 * suite tests the gamekit contract: load the real file into a fake world, fire
 * real events at it, and assert on what it did.
 *
 * ## What is actually worth asserting
 *
 * Not "does it cache", but "which strategy for which URL", because that is the
 * whole design and every bug here has been a misrouting:
 *
 *   index.html        network-first   it names every other file's stamp
 *   stamped (?v=)     cache-first     the URL changes when the file does
 *   everything else   stale-while-revalidate   the URL does not
 *
 * The third row is the one that bites quietly. The song is a plain <audio>
 * element on an unstamped path, so cache-first would have pinned one encode
 * for ever on every machine that had visited.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * The worker under test. Defaults to this repo's own; a path argument lets the
 * same file check a sibling app's, which is how the three were kept in step
 * when this rewrite was ported to makemecookies and crunchscope.
 */
const SW_PATH = process.argv[2] || path.join(__dirname, '..', 'sw.js');
const SOURCE = fs.readFileSync(SW_PATH, 'utf8');

// Read rather than hardcoded, so the assertions do not quietly stop seeing the
// cache when an app names its own differently.
const CACHE_NAME = (SOURCE.match(/var CACHE = "([^"]+)"/) || [])[1];
if (!CACHE_NAME) {
  console.error('could not find the cache name in ' + SW_PATH);
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) passed++;
  else { failed++; console.error('  FAIL: ' + message); }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else { failed++; console.error('  FAIL: ' + message + ' -- got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected)); }
}

/** A response good enough for the checks sw.js makes on one. */
function response(body, ok = true, status = 200) {
  return { body, ok, status, clone() { return response(body, ok, status); } };
}

/**
 * The world sw.js runs in: a CacheStorage backed by Maps, a fetch that records
 * what it was asked for, and a `self` that collects the event listeners.
 */
function makeWorld({ offline = false, seed = {} } = {}) {
  const stores = new Map();
  const log = { fetched: [], put: [], deletedCaches: [], skipWaiting: 0, claimed: 0 };

  function cacheFor(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      match(request) {
        return Promise.resolve(map.get(request.url));
      },
      put(request, resp) {
        log.put.push(request.url);
        map.set(request.url, resp);
        return Promise.resolve();
      },
      keys() {
        return Promise.resolve([...map.keys()]);
      },
    };
  }

  const caches = {
    open(name) { return Promise.resolve(cacheFor(name)); },
    keys() { return Promise.resolve([...stores.keys()]); },
    delete(name) { log.deletedCaches.push(name); stores.delete(name); return Promise.resolve(true); },
    match(request) {
      for (const map of stores.values()) if (map.has(request.url)) return Promise.resolve(map.get(request.url));
      return Promise.resolve(undefined);
    },
  };

  const listeners = new Map();
  const sandbox = {
    self: {
      addEventListener(type, fn) { listeners.set(type, fn); },
      skipWaiting() { log.skipWaiting++; },
      clients: { claim() { log.claimed++; return Promise.resolve(); } },
    },
    caches,
    URL,
    Promise,
    Error,
    fetch(request) {
      log.fetched.push(request.url);
      if (offline) return Promise.reject(new Error('offline'));
      return Promise.resolve(response('from network: ' + request.url));
    },
  };
  sandbox.addEventListener = sandbox.self.addEventListener;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: SW_PATH });

  // Pre-populate the one cache sw.js uses, for the "already cached" cases.
  const live = cacheFor(CACHE_NAME);
  for (const [url, body] of Object.entries(seed)) live.put({ url }, response(body));
  log.put.length = 0;

  /** Fire a fetch event and resolve to what respondWith was handed. */
  function request(url, mode = 'no-cors') {
    let answered = null;
    const event = {
      request: { url, method: 'GET', mode },
      respondWith(p) { answered = p; },
    };
    listeners.get('fetch')(event);
    return answered ? Promise.resolve(answered) : Promise.resolve(null);
  }

  function fire(type, event) { return listeners.get(type)(event); }

  return { request, fire, log, stores, listeners };
}

const SITE = 'https://magmacrunch.com/arcade/makemecookies/';

(async function main() {
  console.log('=== makemecookies service worker routing ===');

  console.log('\nthe page itself:');
  {
    // Network-first. The cached copy exists and must NOT win while online,
    // because index.html is where every other file's stamp is written.
    const w = makeWorld({ seed: { [SITE]: 'STALE PAGE' } });
    const got = await w.request(SITE, 'navigate');
    assert(w.log.fetched.includes(SITE), 'a navigation goes to the network first');
    assert(got.body.startsWith('from network'), 'and the network copy is what the page gets');
    assert(w.log.put.includes(SITE), 'and it is stored for offline');
  }
  {
    const w = makeWorld({ offline: true, seed: { [SITE]: 'CACHED PAGE' } });
    const got = await w.request(SITE, 'navigate');
    assertEqual(got.body, 'CACHED PAGE', 'offline, the cached page is the fallback');
  }
  {
    const w = makeWorld({ seed: { [SITE + 'index.html']: 'STALE' } });
    await w.request(SITE + 'index.html');
    assert(w.log.fetched.includes(SITE + 'index.html'),
      'an explicit index.html is treated as the page too, not as an asset');
  }

  console.log('\nstamped assets:');
  {
    const url = SITE + 'css/base.css?v=d0d7eb91';
    const w = makeWorld({ seed: { [url]: 'CACHED CSS' } });
    const got = await w.request(url);
    assertEqual(got.body, 'CACHED CSS', 'a stamped URL is served from the cache');
    assertEqual(w.log.fetched, [], 'without touching the network');
  }
  {
    // The regression that mattered: the stamp moved, so this is a different
    // URL, so it must miss and be fetched rather than serving the old file.
    const w = makeWorld({ seed: { [SITE + 'css/base.css?v=OLDSTAMP']: 'OLD CSS' } });
    const got = await w.request(SITE + 'css/base.css?v=NEWSTAMP');
    assert(got.body.startsWith('from network'), 'a changed stamp misses and goes to the network');
    assert(w.log.put.includes(SITE + 'css/base.css?v=NEWSTAMP'), 'and the new one is stored');
  }
  {
    const url = SITE + 'js/game.js?v=abc12345';
    const w = makeWorld();
    await w.request(url);
    assertEqual(w.log.put, [url], 'a first request stores what it fetched, with no precache list');
  }

  console.log('\nunstamped assets:');
  {
    // The case cache-first would have broken. The URL does not move when the
    // drawing changes, so the cache must refresh behind the request.
    const url = SITE + 'img/cookie.png';
    const w = makeWorld({ seed: { [url]: 'OLD DRAWING' } });
    const got = await w.request(url);
    assertEqual(got.body, 'OLD DRAWING', 'an unstamped asset is served from the cache, fast');
    await new Promise((r) => setTimeout(r, 0));
    assert(w.log.fetched.includes(url), 'and refreshed behind the request');
    assert(w.log.put.includes(url), 'so the next load has the new one');
  }
  {
    const url = SITE + 'audio/makemecookies.mp3';
    const w = makeWorld({ offline: true, seed: { [url]: 'CACHED AUDIO' } });
    const got = await w.request(url);
    assertEqual(got.body, 'CACHED AUDIO', 'offline, the cached copy still answers');
  }

  console.log('\nhousekeeping:');
  {
    const w = makeWorld();
    w.fire('install', {});
    assert(w.log.skipWaiting === 1, 'install does not wait for every tab to close');
    assert(w.log.put.length === 0, 'and precaches nothing, because there is no list to go stale');
  }
  {
    const w = makeWorld();
    const previous = CACHE_NAME.replace(/v2$/, 'v1');
    w.stores.set(previous, new Map());
    let done;
    w.fire('activate', { waitUntil(p) { done = p; } });
    await done;
    assert(w.log.deletedCaches.includes(previous), 'activate deletes the previous cache');
    assert(!w.log.deletedCaches.includes(CACHE_NAME), 'and keeps its own');
    assert(w.log.claimed === 1, 'and claims open pages');
  }
  {
    const w = makeWorld();
    const answered = await w.request(SITE + 'api/thing', 'cors');
    // A non-GET is left entirely alone; sw.js returns before respondWith.
    const ev = { request: { url: SITE + 'x', method: 'POST', mode: 'cors' }, answered: null, respondWith(p) { this.answered = p; } };
    w.listeners.get('fetch')(ev);
    assert(ev.answered === null, 'a non-GET request is not intercepted at all');
    assert(answered !== null, 'while a GET is');
  }

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
})();
