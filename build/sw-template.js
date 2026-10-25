/* Moj Evolako — service worker. Generated at build time; do not edit dist/sw.js. */
"use strict";

const VERSION = "__VERSION__";
const CACHE = "evolako-shell-" + VERSION;
const RUNTIME = "evolako-static-" + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  // No skipWaiting here: the page asks the person first ("Nova verzija je spremna").
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("evolako-") && key !== CACHE && key !== RUNTIME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

function isStatic(url) {
  return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")
    || url.pathname === "/favicon.svg" || url.pathname === "/manifest.webmanifest";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // The API (and anything else on another origin) is never cached.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network first, so a new deploy is picked up; the cached shell when offline.
    event.respondWith(fetch(request).catch(() => caches.match("/", { cacheName: CACHE })
      .then((cached) => cached || Response.error())));
    return;
  }
  if (url.pathname === "/config.json") {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || Response.error())));
    return;
  }
  if (isStatic(url) || url.pathname === "/boot.js") {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && url.pathname.startsWith("/assets/")) {
        const copy = response.clone();
        caches.open(RUNTIME).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});
