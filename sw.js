const CACHE_NAME = "carnet-de-verbes-v17";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css?v=17",
  "./js/app.js?v=17",
  "./js/french-engine.js?v=17",
  "./js/ai.js?v=17",
  "./js/word-io.js?v=17",
  "./js/sync.js?v=17",
  "./js/practice.js?v=17",
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
            if (res.ok) return cache.put(assetUrl, res);
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
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
