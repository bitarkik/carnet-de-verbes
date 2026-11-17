const CACHE_PREFIX = `carnet-de-verbes-${encodeURIComponent(self.registration.scope)}-v`;
const CACHE_NAME = `${CACHE_PREFIX}26`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css?v=26",
  "./js/app.js?v=26",
  "./js/french-engine.js?v=26",
  "./js/ai.js?v=26",
  "./js/word-io.js?v=26",
  "./js/sync.js?v=26",
  "./js/practice.js?v=26",
  "./js/validation.js?v=26",
  "./assets/icon.svg",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        CORE_ASSETS.map((assetUrl) =>
          fetch(assetUrl, { cache: "no-cache" }).then((res) => {
            if (!res.ok) throw new Error(`Failed to cache ${assetUrl}`);
            return cache.put(assetUrl, res);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Versioned assets are immutable; serve cached assets immediately offline.
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
