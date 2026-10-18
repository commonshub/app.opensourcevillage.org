/**
 * Service Worker for Open Source Village PWA
 * Provides offline support, caching, and background sync
 */

const CACHE_VERSION = 'osv-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const API_CACHE = `${CACHE_VERSION}-api`;
// Map style, tiles, fonts and sprites. Not versioned with the app so a
// deploy does not throw away a map saved for offline use.
const MAP_CACHE = 'osv-map';
const MAP_HOSTS = ['tiles.openfreemap.org'];
const MAP_CACHE_LIMIT = 3000;

// Pages cached on install so the app opens without a connection
const STATIC_ASSETS = [
  '/',
  '/map',
  '/calendar',
  '/manifest.json',
];

// API endpoints that can be cached
const CACHEABLE_API_PATTERNS = [
  /\/api\/offers$/,
  /\/api\/profile\/[\w-]+$/,
  /\/api\/rsvp\?/,
];

// Maximum age for cached API responses (5 minutes)
const API_CACHE_MAX_AGE = 5 * 60 * 1000;

// Maximum number of items in dynamic cache
const DYNAMIC_CACHE_LIMIT = 50;

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        // One missing page must not stop the others from being cached
        return Promise.allSettled(STATIC_ASSETS.map((asset) => cache.add(asset)));
      })
      .then(() => {
        console.log('[SW] Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Installation failed:', error);
      })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Delete caches that don't match current version
              return cacheName.startsWith('osv-') &&
                     cacheName !== MAP_CACHE &&
                     !cacheName.startsWith(CACHE_VERSION);
            })
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

/**
 * Fetch event - serve from cache or network
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Map style, tiles, fonts and sprites
  if (MAP_HOSTS.includes(url.hostname)) {
    event.respondWith(handleMapRequest(request));
    return;
  }

  // Leave every other third-party request to the browser
  if (url.origin !== self.location.origin) {
    return;
  }

  // API requests - Network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Pages - network first so a deploy is picked up, cache when offline
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Build output is content-hashed, so a cached copy never goes stale
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // Other same-origin files (icons, manifest) - cache, refresh in background
  event.respondWith(handleStaleWhileRevalidate(request, DYNAMIC_CACHE));
});

/**
 * Handle API requests with network-first strategy
 */
async function handleApiRequest(request) {
  const url = new URL(request.url);

  // Check if this API endpoint is cacheable
  const isCacheable = CACHEABLE_API_PATTERNS.some(
    (pattern) => pattern.test(url.pathname + url.search)
  );

  if (!isCacheable) {
    // Non-cacheable API - just fetch from network
    try {
      return await fetch(request);
    } catch (error) {
      console.error('[SW] API request failed:', error);
      return new Response(
        JSON.stringify({ error: 'Network unavailable', offline: true }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Cacheable API - network first, cache fallback
  try {
    const response = await fetch(request);

    // Only cache successful responses
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      const clonedResponse = response.clone();

      // Add timestamp to cached response
      const responseWithTimestamp = new Response(
        await clonedResponse.blob(),
        {
          status: clonedResponse.status,
          statusText: clonedResponse.statusText,
          headers: {
            ...Object.fromEntries(clonedResponse.headers.entries()),
            'X-Cache-Time': Date.now().toString(),
          },
        }
      );

      cache.put(request, responseWithTimestamp);
    }

    return response;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);

    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      const cacheTime = cachedResponse.headers.get('X-Cache-Time');
      const age = Date.now() - parseInt(cacheTime || '0', 10);

      // Check if cache is still fresh
      if (age < API_CACHE_MAX_AGE) {
        console.log('[SW] Serving from cache:', request.url);
        return cachedResponse;
      } else {
        console.log('[SW] Cache expired:', request.url);
      }
    }

    // No cache available
    return new Response(
      JSON.stringify({ error: 'Network unavailable', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle page navigations: network first, then the cached page, then the
 * cached home page.
 */
async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
      limitCacheSize(DYNAMIC_CACHE, DYNAMIC_CACHE_LIMIT);
    }
    return response;
  } catch (error) {
    console.log('[SW] Offline, serving cached page:', request.url);
    const cached =
      (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match('/'));
    if (cached) return cached;
    throw error;
  }
}

/**
 * Handle static requests with cache-first strategy
 */
async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Serve from cache when possible and refresh the cached copy in the background
 */
async function handleStaleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch((error) => {
      if (cachedResponse) return cachedResponse;
      throw error;
    });

  return cachedResponse || network;
}

/**
 * Map requests. Style and TileJSON documents change when OpenFreeMap
 * publishes new data, so they are refreshed in the background; tiles,
 * glyphs and sprites live at versioned URLs and are served cache-first.
 */
async function handleMapRequest(request) {
  const url = new URL(request.url);
  const isDocument = !/\.(pbf|png|webp|json)$/.test(url.pathname);

  if (isDocument) {
    return handleStaleWhileRevalidate(request, MAP_CACHE);
  }

  const cache = await caches.open(MAP_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    limitCacheSize(MAP_CACHE, MAP_CACHE_LIMIT);
  }
  return response;
}

/**
 * Limit cache size by removing oldest entries
 */
async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length > maxSize) {
    // Delete oldest entries (first in array)
    const deleteCount = keys.length - maxSize;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
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
