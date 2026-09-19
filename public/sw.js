/**
 * Service worker minimo: serve a rendere l'app installabile e a partire più in
 * fretta. Non mette mai in cache le risposte dell'API (i dati sono già locali e
 * devono restare freschi): solo l'involucro statico.
 */
const CACHE = "ice-shell-v2";
const SHELL = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isAsset = url.origin === self.location.origin && (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname));
  if (event.request.method !== "GET" || !isAsset) return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        }),
    ),
  );
});
