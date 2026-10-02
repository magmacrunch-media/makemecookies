/**
 * Offline support for the browser version.
 *
 * NOT part of the App Store build: ios/package.mjs excludes this file and the
 * line that registers it. A service worker earns nothing in a Capacitor app,
 * where every asset is already on disk, and a cache-first one there is actively
 * harmful because an app update cannot invalidate it. This exists for the web,
 * and for the Microsoft Store packaging the PWA is wanted for later.
 *
 * ## Why there is no precache list any more
 *
 * There was one, naming index.html and every css and js file by unstamped path:
 * "./css/base.css" and so on. It never matched anything. index.html requests
 * those files WITH their cache-buster, as "css/base.css?v=c634b661", and
 * cache.match compares the whole URL including the query string unless it is
 * told otherwise. So every precached entry sat under a key nothing ever asked
 * for, the fetch handler fell through to the network every time, and the
 * default branch put nothing back. The offline support this file exists to
 * provide was not working, and it looked like it was.
 *
 * The obvious repair is `ignoreSearch: true` on the match, and it is a trap. It
 * would make a stamped request hit the unstamped entry, which is the same as
 * making the cache ignore the one mechanism that tells it a file has changed:
 * the site would then serve the old stylesheet for ever, which is the exact
 * failure the stamps exist to prevent.
 *
 * The other repair is to stamp the precache list, which means keeping a second
 * copy of every stamp in step with index.html by hand. A list maintained in two
 * places is a list that goes stale, and this one already had.
 *
 * So there is no list. The cache fills from what the page actually requests,
 * under the URL it actually requested. Nothing to keep in step, and nothing is
 * lost: this is a single page that loads its whole self at once, so precaching
 * and caching-what-the-first-load-fetched reach the same state moments apart.
 *
 * ## Three strategies, chosen by what can invalidate the thing
 *
 *   index.html          network-first
 *   stamped (?v=)       cache-first
 *   everything else     stale-while-revalidate
 *
 * index.html carries no stamp of its own and is where every other file's stamp
 * is written. Serve a stale one and the page asks for the old stamped assets,
 * finds them cached, and the site is pinned to an old version with no way out.
 * The cached copy is its offline fallback and nothing else.
 *
 * A stamped URL names one exact version of one file, so cache-first is safe:
 * a changed file is a different URL, misses, and is fetched and stored beside
 * the old one.
 *
 * Everything else -- audio, images, the fonts -- is addressed by a URL that
 * does not change when the file does. Cache-first would pin those for ever,
 * so they are served from the cache and refreshed behind the request, which
 * is fast now and correct next time. The song is the one that matters here:
 * it is a plain <audio> element on an unstamped path.
 *
 * Superseded entries are not pruned. They are small, bounded by how often the
 * site deploys, and the browser evicts the whole origin under pressure. Pruning
 * would mean knowing which stamps are current, which is index.html's job and
 * not worth duplicating here to save a few hundred kilobytes.
 */

var CACHE = "cookies-v2";

self.addEventListener("install", function () {
  // Nothing to precache. Take over without waiting for every tab to close, so
  // a corrected worker reaches people promptly.
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/** Only a complete, successful response is worth storing. */
function storable(resp) {
  return resp && resp.ok && resp.status === 200;
}

/** For a URL that changes when its file does. */
function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (resp) {
        if (storable(resp)) cache.put(request, resp.clone());
        return resp;
      });
    });
  });
}

/** For index.html, which must never be the stale thing. */
function networkFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return fetch(request).then(function (resp) {
      if (storable(resp)) cache.put(request, resp.clone());
      return resp;
    }).catch(function () {
      return cache.match(request).then(function (cached) {
        return cached || Promise.reject(new Error("offline and not cached"));
      });
    });
  });
}

/** For a URL that stays the same when its file changes. */
function staleWhileRevalidate(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var fetched = fetch(request).then(function (resp) {
        if (storable(resp)) cache.put(request, resp.clone());
        return resp;
      }).catch(function () {
        return cached;
      });
      return cached || fetched;
    });
  });
}

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;

  var url = new URL(e.request.url);

  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // `v` is the cache-buster index.html stamps its css and js with. Its presence
  // is the whole test: it means this URL will change when the file does.
  if (url.searchParams.has("v")) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  e.respondWith(staleWhileRevalidate(e.request));
});
