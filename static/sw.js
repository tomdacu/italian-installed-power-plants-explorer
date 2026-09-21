/**
 * Service worker minimo: rende l'app installabile e accelera l'avvio.
 *
 * Due strategie, perché i due tipi di risorsa invecchiano in modo diverso:
 * - `/assets/*` porta l'hash del contenuto nel nome → la copia in cache è
 *   sempre quella giusta, quindi cache-first;
 * - la shell (`/`, `index.html`, icone) no: una copia vecchia terra l'app
 *   indietro dopo un aggiornamento, perché referenzia bundle che ormai hanno
 *   un altro nome → network-first, con la cache solo come rete di sicurezza
 *   quando il server locale non risponde.
 *
 * Le risposte dell'API non entrano mai in cache: i dati sono già locali.
 */
const CACHE = "ice-shell-v4";
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

function cache(request, response) {
  const copy = response.clone();
  return caches.open(CACHE).then((store) => store.put(request, copy)).then(() => response);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  const isHashedAsset = url.pathname.startsWith("/assets/");
  const isShell = SHELL.includes(url.pathname);
  if (!isHashedAsset && !isShell) return;

  if (isHashedAsset) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached ?? fetch(event.request).then((response) => cache(event.request, response))),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => cache(event.request, response))
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached ?? new Response("Offline", { status: 503, statusText: "Offline" })),
      ),
  );
});
