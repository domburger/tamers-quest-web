// Minimal service worker — enough for PWA installability + a light offline cache of the app SHELL.
// Network-first so deploys are picked up immediately; the cache is only an offline fallback.
const CACHE = "tq-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  // Purge older caches (e.g. tq-v1, which cached dynamic/authenticated responses) so they can't be
  // served from a stale cache, then take control of open clients.
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith("http")) return;
  const url = new URL(req.url);
  // Cache ONLY the same-origin static app shell. NEVER cache dynamic or AUTHENTICATED responses
  // (/api, /account, /auth): the cache is keyed by URL and ignores the session header, so a cached
  // authenticated response could be served to a DIFFERENT session offline (shared device) — and
  // stale API data is useless offline anyway. Only successful (OK) responses are stored.
  const cacheable = url.origin === self.location.origin && !/^\/(api|account|auth)\//.test(url.pathname);
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (cacheable && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
