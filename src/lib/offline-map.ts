/**
 * Download the map around the venues into the Cache Storage used by the
 * service worker (public/sw.js), so /map works without a connection.
 *
 * Writes straight to the cache instead of relying on the service worker
 * intercepting the fetches, so it also works on a first visit, before the
 * worker controls the page.
 */

import type { StyleSpecification } from 'maplibre-gl';
import { VENUES } from './venues';
import { boundsAround, tilesForBounds, tileUrl } from './map-tiles';

// Cache names and the timestamp header are shared with public/sw.js;
// src/lib/__tests__/offline-map.test.ts checks they stay in sync.
export const MAP_OFFLINE_CACHE = 'osv-map-offline';
export const STATIC_CACHE = 'osv-v3-static';
export const PAGES_CACHE = 'osv-v3-pages';
export const CACHED_AT = 'sw-cached-at';

const MIN_ZOOM = 10;
const MAX_ZOOM = 14;
// Latin and Latin Extended: enough for Brussels street names
const GLYPH_RANGES = ['0-255', '256-511'];
const CONCURRENCY = 6;
const SAVED_KEY = 'osv-map-offline';

export interface SaveProgress {
  done: number;
  total: number;
}

export interface OfflineMapInfo {
  savedAt: string;
  bytes: number;
}

export interface SaveResult {
  failed: number;
  bytes: number;
}

export function offlineMapSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

export function getOfflineMapInfo(): OfflineMapInfo | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as OfflineMapInfo) : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tile URL templates, plus the TileJSON documents they came from */
async function tileSources(
  style: StyleSpecification
): Promise<{ templates: string[]; tileJsonUrls: string[] }> {
  const templates: string[] = [];
  const tileJsonUrls: string[] = [];
  for (const source of Object.values(style.sources)) {
    if (source.type !== 'vector' && source.type !== 'raster') continue;
    if (source.tiles) {
      templates.push(...source.tiles);
    } else if (source.url) {
      tileJsonUrls.push(source.url);
      const tileJson = await fetch(source.url).then((res) => res.json());
      if (Array.isArray(tileJson.tiles)) templates.push(...tileJson.tiles);
    }
  }
  return { templates, tileJsonUrls };
}

function glyphUrls(style: StyleSpecification): string[] {
  if (!style.glyphs) return [];
  const fontStacks = new Set<string>();
  for (const layer of style.layers) {
    const font = layer.type === 'symbol' ? layer.layout?.['text-font'] : undefined;
    // Only literal font lists; expressions are rare and fall back to the network
    if (Array.isArray(font) && font.every((f) => typeof f === 'string')) {
      fontStacks.add(font.join(','));
    }
  }
  return [...fontStacks].flatMap((stack) =>
    GLYPH_RANGES.map((range) =>
      style.glyphs!.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range)
    )
  );
}

function spriteUrls(style: StyleSpecification): string[] {
  const sprites =
    typeof style.sprite === 'string'
      ? [style.sprite]
      : (style.sprite ?? []).map((sprite) => sprite.url);
  return sprites.flatMap((base) =>
    ['.json', '.png', '@2x.json', '@2x.png'].map((suffix) => base + suffix)
  );
}

/** The page's own scripts and styles, so /map can boot offline */
function appAssetUrls(): string[] {
  return performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => new URL(name).pathname.startsWith('/_next/static/'));
}

/** Fetch `url` and store it stamped like the service worker does; returns its size */
async function fetchInto(cache: Cache, url: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, String(Date.now()));
  await cache.put(url, new Response(body, { status: response.status, headers }));
  return body.size;
}

/**
 * Cache every URL not cached yet. Resolves with the number of failures and
 * the size of everything in `urls` that is now cached.
 */
async function cacheAll(cache: Cache, urls: string[], onDone: () => void): Promise<SaveResult> {
  let failed = 0;
  let bytes = 0;
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const cached = await cache.match(url);
        bytes += cached ? (await cached.clone().blob()).size : await fetchInto(cache, url);
      } catch {
        failed++;
      }
      onDone();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { failed, bytes };
}

/** Drop entries a previous save stored that are no longer needed */
async function removeOtherEntries(cache: Cache, keep: string[]): Promise<void> {
  const wanted = new Set(keep);
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url)) await cache.delete(request);
  }
}

/**
 * Save everything /map needs offline.
 */
export async function saveMapForOffline(
  styleUrl: string,
  style: StyleSpecification,
  onProgress: (progress: SaveProgress) => void
): Promise<SaveResult> {
  // Ask the browser not to evict the saved map under storage pressure
  navigator.storage?.persist?.().catch(() => undefined);

  const tiles = tilesForBounds(boundsAround(VENUES), MIN_ZOOM, MAX_ZOOM);
  const { templates, tileJsonUrls } = await tileSources(style);
  const mapUrls = [
    styleUrl,
    ...tileJsonUrls,
    ...templates.flatMap((template) => tiles.map((tile) => tileUrl(template, tile))),
    ...glyphUrls(style),
    ...spriteUrls(style),
  ];
  const appUrls = appAssetUrls();
  const pageUrl = new URL('/map', window.location.origin).toString();

  const total = mapUrls.length + appUrls.length + 1;
  let done = 0;
  const tick = () => onProgress({ done: ++done, total });
  onProgress({ done, total });

  const [mapCache, staticCache, pagesCache] = await Promise.all([
    caches.open(MAP_OFFLINE_CACHE),
    caches.open(STATIC_CACHE),
    caches.open(PAGES_CACHE),
  ]);

  // The style and TileJSON may have changed since the last save; tiles live
  // at versioned URLs, so a new data release means new URLs anyway.
  await Promise.all([styleUrl, ...tileJsonUrls].map((url) => mapCache.delete(url)));

  const map = await cacheAll(mapCache, mapUrls, tick);
  const app = await cacheAll(staticCache, appUrls, tick);
  let pageFailed = 0;
  try {
    await fetchInto(pagesCache, pageUrl);
  } catch {
    pageFailed = 1;
  }
  tick();

  const result = { failed: map.failed + app.failed + pageFailed, bytes: map.bytes + app.bytes };

  if (map.failed === 0) {
    // Only prune after a complete save, so a failed update never leaves
    // less offline than there was before
    await removeOtherEntries(mapCache, mapUrls);
    try {
      const info: OfflineMapInfo = { savedAt: new Date().toISOString(), bytes: map.bytes };
      localStorage.setItem(SAVED_KEY, JSON.stringify(info));
    } catch {
      // Private mode: the map is still cached, we just cannot remember when
    }
  }
  return result;
}

/** Delete the saved map area */
export async function removeOfflineMap(): Promise<void> {
  await caches.delete(MAP_OFFLINE_CACHE);
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    // Nothing remembered
  }
}
