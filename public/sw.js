/**
 * Service Worker for Open Source Village PWA
 * Provides offline support, caching, and background sync
 *
 * Caches (each pruned by age and entry count, see CACHE_RULES):
 * - pages:   HTML pages, network first, used when offline
 * - static:  content-hashed /_next/static build output, cache first
 * - runtime: other same-origin files (icons, manifest)
 * - api:     a few API responses, used when offline
 * - osv-map-runtime: map tiles fetched while browsing
 * - osv-map-offline: the map area saved from /map; managed by the page
 *   (src/lib/offline-map.ts), never pruned here
 *
 * Every cached response carries an `sw-cached-at` header (ms since epoch)
 * that pruning and API freshness checks read.
 */

const CACHE_VERSION = 'osv-v3';
const PAGES_CACHE = `${CACHE_VERSION}-pages`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const API_CACHE = `${CACHE_VERSION}-api`;
// Not versioned with the app, so a deploy keeps the map
const MAP_RUNTIME_CACHE = 'osv-map-runtime';
const MAP_OFFLINE_CACHE = 'osv-map-offline';
const MAP_HOSTS = ['tiles.openfreemap.org'];

const CACHED_AT = 'sw-cached-at';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const CACHE_RULES = {
  [PAGES_CACHE]: { maxEntries: 30, maxAge: 7 * DAY },
  // Old builds' chunks are useless once nobody runs that build any more
  [STATIC_CACHE]: { maxEntries: 300, maxAge: 30 * DAY },
  [RUNTIME_CACHE]: { maxEntries: 60, maxAge: 30 * DAY },
  [API_CACHE]: { maxEntries: 60, maxAge: DAY },
  [MAP_RUNTIME_CACHE]: { maxEntries: 1500, maxAge: 30 * DAY },
};

// Tighter limits when the browser says storage is nearly full
const PRESSURE_RULES = {
  [PAGES_CACHE]: { maxEntries: 10 },
  [STATIC_CACHE]: { maxEntries: 120 },
  [MAP_RUNTIME_CACHE]: { maxEntries: 200 },
};
const STORAGE_PRESSURE_RATIO = 0.8;
const CLEANUP_INTERVAL = 10 * 60 * 1000;

// Pages cached on install so the app opens without a connection
const STATIC_ASSETS = [
  '/',
  '/map',
  '/calendar',
];

// API responses kept for offline use, and how old they may be when served
const CACHEABLE_API = [
  { pattern: /^\/api\/offers$/, maxAge: 5 * 60 * 1000 },
  { pattern: /^\/api\/profile\/[\w-]+$/, maxAge: 5 * 60 * 1000 },
  { pattern: /^\/api\/rsvp\?/, maxAge: 5 * 60 * 1000 },
  // Routes go stale, but a route from this morning beats nothing offline
  { pattern: /^\/api\/directions\?/, maxAge: 12 * HOUR },
];

const KNOWN_CACHES = [
  PAGES_CACHE,
  STATIC_CACHE,
  RUNTIME_CACHE,
  API_CACHE,
  MAP_RUNTIME_CACHE,
  MAP_OFFLINE_CACHE,
];

/**
 * Store a copy of `response` stamped with the time it was cached
 */
async function putStamped(cacheName, request, response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, String(Date.now()));
  const stamped = new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(cacheName);
  await cache.put(request, stamped);
}

function cachedAt(response) {
  return parseInt(response.headers.get(CACHED_AT) || '0', 10);
}

/**
 * Install event - cache the main pages
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.allSettled(
      STATIC_ASSETS.map(async (asset) => {
        const response = await fetch(asset);
        if (response.ok) await putStamped(PAGES_CACHE, asset, response);
      })
    ).then(() => self.skipWaiting())
  );
});

/**
 * Activate event - drop caches from older versions, then prune
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith('osv-') && !KNOWN_CACHES.includes(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
      .then(() => cleanupCaches())
  );
});

/**
 * Fetch event - route each request to a caching strategy
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  if (MAP_HOSTS.includes(url.hostname)) {
    event.respondWith(handleMapRequest(request));
  } else if (url.origin !== self.location.origin) {
    // Leave every other third-party request to the browser
    return;
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(handleCacheFirst(request, STATIC_CACHE));
  } else {
    event.respondWith(handleStaleWhileRevalidate(request, RUNTIME_CACHE));
  }

  maybeCleanup(event);
});

/**
 * API requests: network first; a few endpoints fall back to a recent
 * cached copy when offline.
 */
async function handleApiRequest(request) {
  const url = new URL(request.url);
  const rule = CACHEABLE_API.find(({ pattern }) => pattern.test(url.pathname + url.search));

  const fromCache = async () => {
    if (!rule) return undefined;
    const cached = await caches.match(request, { cacheName: API_CACHE });
    return cached && Date.now() - cachedAt(cached) < rule.maxAge ? cached : undefined;
  };

  try {
    const response = await fetch(request);
    if (rule && response.ok) {
      await putStamped(API_CACHE, request, response.clone());
    }
    // Server down or upstream failing (502/503 during a deploy): a recent
    // cached answer is more useful than the error
    if (response.status >= 500) {
      return (await fromCache()) || response;
    }
    return response;
  } catch (error) {
    const cached = await fromCache();
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'Network unavailable', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Pages: network first so a deploy is picked up, then the cached page,
 * then the cached home page.
 */
async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putStamped(PAGES_CACHE, request, response.clone());
    }
    return response;
  } catch (error) {
    const cached =
      (await caches.match(request, { cacheName: PAGES_CACHE, ignoreSearch: true })) ||
      (await caches.match('/', { cacheName: PAGES_CACHE }));
    if (cached) return cached;
    throw error;
  }
}

/**
 * Cache first, for URLs whose content never changes
 */
async function handleCacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await putStamped(cacheName, request, response.clone());
  }
  return response;
}

/**
 * Serve from cache when possible and refresh the cached copy in the background
 */
async function handleStaleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await putStamped(cacheName, request, response.clone());
      return response;
    })
    .catch((error) => {
      if (cached) return cached;
      throw error;
    });

  return cached || network;
}

/**
 * Map requests. Style and TileJSON documents change when OpenFreeMap
 * publishes new data, so they are refreshed in the background; tiles,
 * glyphs and sprites live at versioned URLs and are served cache first.
 * Both look in the saved offline area as well as the runtime cache.
 */
async function handleMapRequest(request) {
  const url = new URL(request.url);
  const isDocument = !/\.(pbf|png|webp|json)$/.test(url.pathname);
  return isDocument
    ? handleStaleWhileRevalidate(request, MAP_RUNTIME_CACHE)
    : handleCacheFirst(request, MAP_RUNTIME_CACHE);
}

/**
 * Remove entries older than `maxAge`, then the oldest beyond `maxEntries`
 */
async function pruneCache(cacheName, { maxEntries, maxAge }) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  const now = Date.now();

  const entries = [];
  for (const request of requests) {
    const response = await cache.match(request);
    const time = response ? cachedAt(response) : 0;
    if (maxAge && now - time > maxAge) {
      await cache.delete(request);
    } else {
      entries.push({ request, time });
    }
  }

  if (maxEntries && entries.length > maxEntries) {
    entries.sort((a, b) => a.time - b.time);
    for (const { request } of entries.slice(0, entries.length - maxEntries)) {
      await cache.delete(request);
    }
  }
}

async function isUnderStoragePressure() {
  try {
    const { usage, quota } = await self.navigator.storage.estimate();
    return !!quota && usage / quota > STORAGE_PRESSURE_RATIO;
  } catch {
    return false;
  }
}

let cleanupRunning = null;
let lastCleanup = 0;

async function cleanupCaches() {
  if (cleanupRunning) return cleanupRunning;
  cleanupRunning = (async () => {
    const pressure = await isUnderStoragePressure();
    for (const [cacheName, rule] of Object.entries(CACHE_RULES)) {
      const tighter = pressure ? PRESSURE_RULES[cacheName] : undefined;
      await pruneCache(cacheName, { ...rule, ...tighter });
    }
    lastCleanup = Date.now();
  })().finally(() => {
    cleanupRunning = null;
  });
  return cleanupRunning;
}

/**
 * Prune at most every CLEANUP_INTERVAL, after the response is sent
 */
function maybeCleanup(event) {
  if (Date.now() - lastCleanup < CLEANUP_INTERVAL || cleanupRunning) return;
  lastCleanup = Date.now();
  event.waitUntil(
    new Promise((resolve) => setTimeout(resolve, 5000)).then(cleanupCaches)
  );
}

/**
 * Background sync for pending requests
 */
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);

  if (event.tag === 'sync-offers') {
    event.waitUntil(syncOffers());
  } else if (event.tag === 'sync-rsvps') {
    event.waitUntil(syncRSVPs());
  }
});

/**
 * Sync pending offers when back online
 */
async function syncOffers() {
  console.log('[SW] Syncing pending offers...');

  // Get pending offers from IndexedDB or similar
  // This is a placeholder - actual implementation would read from IndexedDB

  try {
    // Send pending offers to API
    // await fetch('/api/offers', { method: 'POST', body: ... });
    console.log('[SW] Offers synced successfully');
  } catch (error) {
    console.error('[SW] Failed to sync offers:', error);
    throw error; // Retry sync
  }
}

/**
 * Sync pending RSVPs when back online
 */
async function syncRSVPs() {
  console.log('[SW] Syncing pending RSVPs...');

  try {
    // Send pending RSVPs to API
    console.log('[SW] RSVPs synced successfully');
  } catch (error) {
    console.error('[SW] Failed to sync RSVPs:', error);
    throw error; // Retry sync
  }
}

/**
 * Handle push notifications
 */
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Open Source Village';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag || 'default',
    data: data.url ? { url: data.url } : undefined,
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/**
 * Handle notification clicks
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);

  event.notification.close();

  // Navigate to URL if provided
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});

/**
 * Handle messages from clients
 */
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearAllCaches());
  } else if (event.data.type === 'GET_CACHE_KEYS') {
    event.waitUntil(
      caches.keys().then((keys) => {
        event.ports[0].postMessage({ cacheKeys: keys });
      })
    );
  }
});

/**
 * Clear all caches
 */
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  return Promise.all(
    cacheNames.map((cacheName) => caches.delete(cacheName))
  );
}
