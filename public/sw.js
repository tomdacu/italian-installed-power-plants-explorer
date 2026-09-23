/**
 * Service worker minimo: rende l'app installabile e accelera l'avvio.
 *
 * Tre strategie, perché le risorse invecchiano in modo diverso:
 * - `/assets/*` porta l'hash del contenuto nel nome → cache-first;
 * - la shell (`/`, `index.html`, icone) → network-first, con la cache come rete
 *   di sicurezza quando il server locale non risponde;
 * - le rotte dell'app (`/dashboard`, `/sync`, …) → network-first con ricaduta
 *   sulla shell in cache: sono navigazioni, e senza questa ricaduta una finestra
 *   installata che ricarica su `/dashboard` col server spento mostrerebbe la
 *   pagina di errore del browser invece dell'app.
 *
 * In cache entrano solo risposte `ok`: un 404 o un 500 memorizzato resterebbe
 * "avvelenato" fino al cambio di nome della cache. Le risposte dell'API non
 * vengono mai messe in cache (i dati sono già locali).
 *
 * La voce `/index.html` viene riscritta a ogni navigazione riuscita: la shell
 * in cache è quella servita adesso, non quella dell'installazione (che
 * punterebbe ad asset con hash non più presenti). Il nome della cache cambia a
 * ogni build — il suffisso lo aggiunge `scripts/build.ts` su `dist/sw.js`.
 */
const CACHE = "ice-shell-v6";
const SHELL = ["/", "/index.html", "/theme.js", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

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

/**
 * Memorizza una risposta solo se è `ok`, e lo fa *dentro* `event.waitUntil`:
 * senza, il browser può spegnere il worker mentre la scrittura in cache è
 * ancora in volo e la voce non entra mai. `extraKey` serve alla navigazione:
 * la stessa risposta è anche la shell, quindi va salvata pure lì.
 */
function cacheIfOk(event, request, response, extraKey) {
  if (response.ok) {
    const copy = response.clone();
    const shellCopy = extraKey ? response.clone() : null;
    event.waitUntil(
      caches.open(CACHE).then((store) => {
        const writes = [store.put(request, copy)];
        if (shellCopy) writes.push(store.put(extraKey, shellCopy));
        return Promise.all(writes);
      }),
    );
  }
  return response;
}

function fromCache(request, fallback) {
  return caches.match(request).then((cached) => cached ?? (fallback ? caches.match(fallback) : null));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  const isHashedAsset = url.pathname.startsWith("/assets/");
  const isShell = SHELL.includes(url.pathname);
  const isNavigation = event.request.mode === "navigate";

  if (!isHashedAsset && !isShell && !isNavigation) return;

  if (isHashedAsset) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ??
          fetch(event.request)
            .then((response) => cacheIfOk(event, event.request, response))
            .catch(() => new Response("", { status: 503, statusText: "Offline" })),
      ),
    );
    return;
  }

  // Una navigazione (o `/`) che riesce è la shell servita *ora*: salvandola
  // anche sotto `/index.html` la caduta offline non ripesca più la copia
  // dell'installazione, che punta ad asset con hash non più presenti.
  const shellKey = isNavigation || url.pathname === "/" ? "/index.html" : null;

  event.respondWith(
    fetch(event.request)
      .then((response) => cacheIfOk(event, event.request, response, shellKey))
      .catch(() =>
        fromCache(event.request, "/index.html").then(
          (cached) => cached ?? new Response("Offline", { status: 503, statusText: "Offline" }),
        ),
      ),
  );
});
