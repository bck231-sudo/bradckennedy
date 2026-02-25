const CACHE_NAME = "medication-tracker-shell-v8";
const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./dose-actions.js",
  "./risk-engine.js",
  "./storage-service.js",
  "./site-icon.svg",
  "./manifest.webmanifest",
  "./icons/icon-192-v2.png",
  "./icons/icon-512-v2.png"
];

const NETWORK_FIRST_PATHS = new Set(["/", "/index.html", "/styles.css", "/app.js"]);

function isNetworkFirstRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    return NETWORK_FIRST_PATHS.has(url.pathname);
  } catch {
    return false;
  }
}

async function matchIgnoringSearch(request) {
  const direct = await caches.match(request);
  if (direct) return direct;
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return null;
    const byPath = await caches.match(url.pathname);
    if (byPath) return byPath;
    return caches.match(`.${url.pathname}`);
  } catch {
    return null;
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await matchIgnoringSearch(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match("./index.html")) || Response.error();
    }
    return Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (isNetworkFirstRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    matchIgnoringSearch(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached || Response.error());
    })
  );
});
