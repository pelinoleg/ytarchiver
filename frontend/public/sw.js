/* Service Worker for YT Archive.
 *
 * Strategy — three lanes:
 *
 *   1. ``/api/*`` and ``/ws*``  → network-only.  Never cache API responses
 *      (they're stateful) and never intercept WebSocket upgrades.
 *
 *   2. ``/api/stream/*``        → bypassed entirely.  Video / thumbnail / preview
 *      / subtitle streams use HTTP Range requests; caching them via the
 *      Cache API breaks Range semantics in many browsers and would inflate
 *      storage by gigabytes anyway.  Let the browser HTTP cache handle them.
 *
 *   3. Everything else (app shell, JS/CSS bundle, icons, fonts) →
 *      stale-while-revalidate. The cached copy is served instantly; a
 *      background fetch updates the cache for the next load.  This is
 *      what makes the PWA feel native — instant launch, even offline.
 *
 * Versioning: bump CACHE_VERSION whenever shell semantics change.  Old
 * caches are pruned in ``activate``. Vite content-hashes its JS/CSS, so
 * normal deploys don't need a version bump — the new bundle simply lands
 * in the cache on first visit.
 */

const CACHE_VERSION = "yt-archive-v1";
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // ``addAll`` aborts on any 404 — guard each URL individually so a
      // missing icon doesn't take down the whole install step.
      Promise.all(
        SHELL_URLS.map((url) =>
          fetch(url).then((r) => (r.ok ? cache.put(url, r) : null)).catch(() => null),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Cache only same-origin GETs. Cross-origin (YouTube thumbnails on
  // i.ytimg.com) is served fresh — those use a CDN that handles caching.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Lane 1 + 2: never intercept dynamic / streaming endpoints.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/ws"))   return;

  // For navigation requests fall through to ``/`` (SPA shell) — important
  // so /watch/<id> reloads also work offline once the shell is cached.
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("/").then((cached) =>
        cached || fetch(req).catch(() => caches.match("/index.html") || new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  // Lane 3: stale-while-revalidate for everything else.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        // Cache only successful, finalised responses. Avoid caching opaque
        // / partial / error responses so the offline experience is honest.
        if (res && res.ok && res.status === 200 && res.type === "basic") {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(() => undefined);
      // Return cached if we have it; otherwise wait for network. If both
      // fail (offline + uncached) the browser surfaces its own error.
      return cached || (await network) || Response.error();
    }),
  );
});
