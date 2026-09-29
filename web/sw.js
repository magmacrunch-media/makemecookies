var CACHE = "cookies-v1";
var PRECACHE = [
  "./index.html",
  "./manifest.json",
  "./img/mc-logo.png"
];

self.addEventListener("install", function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE; })
             .map(function(n) { return caches.delete(n); })
      );
    })
  );
});

self.addEventListener("fetch", function(e) {
  var url = new URL(e.request.url);

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open(CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          var fetched = fetch(e.request).then(function(resp) {
            if (resp.ok) cache.put(e.request, resp.clone());
            return resp;
          }).catch(function() {
            return cached;
          });
          return cached || fetched;
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request);
    })
  );
});