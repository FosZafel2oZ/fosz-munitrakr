/* MuniTrakr service worker — network-first (fresh when online, works offline) */
const CACHE = "munitrakr-v76";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./debts.js",
  "./recurring.js",
  "./finance-helpers.js",
  "./styles.css",
  "./vendor/chart.umd.min.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon.png",
  "./chevron.svg",
  "./chevron-dark.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname.includes("frankfurter")) return; // FX API — always live
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Stale-while-revalidate: serve cached response instantly, refresh in
  // background. Trades "one stale load after a deploy" for a near-instant
  // startup on every subsequent boot. Users on the latest version still get
  // updates via "Check for updates" or two consecutive loads.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkPromise = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => null);
      // Return cached immediately if we have it; otherwise wait for network.
      return (
        cached ||
        networkPromise.then(
          (res) => res || caches.match("./index.html")
        )
      );
    })
  );
});
