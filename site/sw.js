/* 神保町 jimbocho.app — service worker.
 *
 * Deliberately network-first for everything the app is made of. A cache-first
 * worker would be faster, but this site rebuilds its whole data set on every
 * import, and a worker that served yesterday's app.js against today's manifest
 * would break the page in a way that is very hard for a visitor to clear. So:
 * always try the network, fall back to the cache when it is slow or gone.
 * The cache is here for the aeroplane and the MTR tunnel, not for speed.
 */
'use strict';

var CACHE = 'jimbocho-v3';
var NET_TIMEOUT = 4000;

/* Enough to open the app and show the shelf with no network at all. The data
 * shards are not precached — they are big, and they land in the cache the
 * first time the visitor actually loads them. */
var SHELL = [
  './',
  'index.html',
  'styles.css',
  'tokenize.js',
  'schema.js',
  'app.js',
  'install.js',
  'site.webmanifest',
  'data/manifest.json',
  'data/firstpage.json',
  'favicon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // One bad URL must not fail the whole install, so request them singly.
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
        })
      );
    })
  );
  // Safe here precisely because we never serve stale code while online.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            return k === CACHE ? null : caches.delete(k);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Same-origin only. Cover images come from Google and arrive as opaque
  // responses, which some browsers charge several megabytes each against the
  // storage quota — not worth it for a thumbnail.
  if (url.origin !== self.location.origin) return;

  // Range requests are how the SQLite backend reads the database. Passing a
  // 206 through the Cache API corrupts it; let those go straight to the network.
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      networkFirst(req).catch(function () {
        return caches.match('./', { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }

  event.respondWith(networkFirst(req));
});

/** Network, with a timeout and the cache as the safety net. */
function networkFirst(req) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      fromCache(req).then(function (hit) {
        if (hit && !settled) {
          settled = true;
          resolve(hit);
        }
      });
    }, NET_TIMEOUT);

    fetch(req)
      .then(function (res) {
        clearTimeout(timer);
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(req, copy).catch(function () {});
          });
        }
        if (!settled) {
          settled = true;
          resolve(res);
        }
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (settled) return;
        fromCache(req).then(function (hit) {
          settled = true;
          if (hit) resolve(hit);
          else reject(err);
        });
      });
  });
}

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).catch(function () {
    return undefined;
  });
}
