const CACHE_PREFIX = `carnet-de-verbes-${encodeURIComponent(self.registration.scope)}-v`;
const CACHE_NAME = `${CACHE_PREFIX}34`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./js/updates.js?v=34",
  "./css/styles.css?v=34",
  "./js/app.js?v=34",
  "./js/french-engine.js?v=34",
  "./js/ai.js?v=34",
  "./js/word-io.js?v=34",
  "./js/sync.js?v=34",
  "./js/practice.js?v=34",
  "./js/validation.js?v=34",
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
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (event.request.mode === "navigate") {
      try {
        const fresh = await fetch(event.request, { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (fresh.ok) { await cache.put(event.request, fresh.clone()); return fresh; }
      } catch { /* Fall back to the current app shell offline. */ }
      return cached || await cache.match("./index.html") || Response.error();
    }
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
