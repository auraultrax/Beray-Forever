const CACHE_VERSION = 'forever-shell-v16';
const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './kvkk.html',
  './kullanim-kosullari.html',
  './manifest.json',
  './manifest-violet.json',
  './manifest-emerald.json',
  './manifest-ocean.json',
  './supabase-compat.js',
  './aurax-theme.css',
  './rooms.js',
  './icons/forever-violet.svg',
  './icons/forever-emerald.svg',
  './icons/forever-ocean.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('forever-shell-') && key !== CACHE_VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only cache this app's own static shell; Supabase authentication and live data remain network-backed.
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_VERSION);
        if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
          await cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (_) {
        return (await caches.match(request)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE_VERSION);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      return cached || Response.error();
    }
  })());
});
