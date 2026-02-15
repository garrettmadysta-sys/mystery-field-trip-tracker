const CACHE = "eli-trip-pwa-v2";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => k===CACHE ? null : caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => e.respondWith(caches.match(e.request).then(c => c || fetch(e.request))));
