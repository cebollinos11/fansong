// The service worker that lets the game load with no connection. The build
// (`offlineWorker` in vite.config.ts) puts `const FILES = { path: hash, ... }`,
// every file of that build, above this code and writes the result to `sw.js`.
//
// A build is one version of the app: all its files are downloaded before it
// takes over, and the page is then served from that copy alone, never the
// network. A new build downloads in the background (only the files that
// changed) and waits; it takes over when the app is next opened, or at once
// when the page sends 'skipWaiting' (the menu's update check, src/ui/appUpdate.ts).

const CACHE = 'fansong-files';
const FONT_CACHE = 'fansong-fonts';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const DOWNLOADS_AT_ONCE = 8;

const scope = self.registration.scope;
/** Where a file of this build is kept: its hash is in the key, so a changed file is a new entry. */
const keyOf = (path) => new URL(`${path}?v=${FILES[path]}`, scope).href;

async function download() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((request) => request.url));
  const missing = Object.keys(FILES).filter((path) => !have.has(keyOf(path)));
  let next = 0;
  const fetchNext = async () => {
    while (next < missing.length) {
      const path = missing[next++];
      const response = await fetch(new URL(path, scope), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      await cache.put(keyOf(path), response);
    }
  };
  await Promise.all(Array.from({ length: DOWNLOADS_AT_ONCE }, fetchNext));
}

/** Drop the files only an older build used. */
async function prune() {
  const cache = await caches.open(CACHE);
  const wanted = new Set(Object.keys(FILES).map(keyOf));
  await Promise.all((await cache.keys()).filter((request) => !wanted.has(request.url)).map((request) => cache.delete(request)));
}

/** The web fonts are not ours to list: keep whatever was last fetched, and refresh it when online. */
async function font(request) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    void cache.put(request, response.clone());
    return response;
  });
  if (!hit) return fresh;
  fresh.catch(() => {});
  return hit;
}

self.addEventListener('install', (event) => event.waitUntil(download()));

self.addEventListener('activate', (event) => event.waitUntil(prune().then(() => self.clients.claim())));

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (FONT_HOSTS.includes(url.hostname)) return event.respondWith(font(request));
  if (!url.href.startsWith(scope)) return;
  // Queries (`?room=CODE`, `?dev=1`, a sound's `?v=`) never change which file it is.
  const path = decodeURIComponent(url.pathname.slice(new URL(scope).pathname.length)) || 'index.html';
  if (!(path in FILES)) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(keyOf(path)))
      .then((hit) => hit ?? fetch(request)),
  );
});
