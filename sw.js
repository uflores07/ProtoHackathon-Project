// Keeps Split opening with a weak or no connection: it tries the network first (so a new
// version shows up as soon as it's pushed) and falls back to the copy saved on the phone.
// Live sync (Firebase) and AI calls are never cached.
const CACHE = 'split-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon-192.png'];
const CDNS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'www.gstatic.com', 'images.unsplash.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || (url.origin !== location.origin && !CDNS.includes(url.hostname))) return;
  e.respondWith(
    fetch(req)
      .then(async (res) => {
        if (res.ok || res.type === 'opaque') await (await caches.open(CACHE)).put(req, res.clone());
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
  );
});
