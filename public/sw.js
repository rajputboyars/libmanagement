/* StudyQuest service worker.
 * Caches ONLY immutable static assets and an offline fallback page.
 * It never caches /api responses or HTML documents, so no personal, financial or authenticated data is stored on the device.
 * Bump VERSION to invalidate old caches.
 */
const VERSION = "v3";
const MAX_RUNTIME_ENTRIES = 120; // oldest runtime entries are evicted so old build chunks cannot pile up
const STATIC = `sq-static-${VERSION}`;
const PRECACHE = ["/offline.html", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Phone notifications (web push): show the message, and open the right page when it is tapped.
self.addEventListener("push", (event) => {
  let data = { title: "StudyQuest", body: "", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch { /* plain or empty payload */ }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: data.url } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin));
      if (open) { open.navigate(url); return open.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-caches") event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});
let trimQueue = Promise.resolve();
async function trimCache(max) {
  const cache = await caches.open(STATIC);
  const keys = await cache.keys();
  const runtime = keys.filter((r) => { const u = new URL(r.url); return !(u.search === "" && PRECACHE.includes(u.pathname)); });
  await Promise.all(runtime.slice(0, Math.max(0, runtime.length - max)).map((r) => cache.delete(r)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/billing/")) return; // always network, never cached
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  const immutable = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(?:woff2?|svg|png)$/.test(url.pathname);
  if (!immutable) return;
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      // Store and trim while the event is still alive; trims are serialised so concurrent fetches cannot overshoot the cap.
      event.waitUntil(trimQueue = trimQueue.then(async () => { await (await caches.open(STATIC)).put(req, copy); await trimCache(MAX_RUNTIME_ENTRIES); }).catch(() => null));
    }
    return res;
  })());
});
