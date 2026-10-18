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

// Keep in sync with public/sw.js
const MAP_CACHE = 'osv-map';
const STATIC_CACHE = 'osv-v2-static';
const DYNAMIC_CACHE = 'osv-v2-dynamic';

const MIN_ZOOM = 10;
const MAX_ZOOM = 14;
// Latin and Latin Extended: enough for Brussels street names
const GLYPH_RANGES = ['0-255', '256-511'];
const CONCURRENCY = 6;
const SAVED_KEY = 'osv-map-offline-saved-at';

export interface SaveProgress {
  done: number;
  total: number;
}

export function offlineMapSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

export function getOfflineMapSavedAt(): string | null {
  try {
    return localStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
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

async function cacheAll(
  cache: Cache,
  urls: string[],
  onDone: () => void
): Promise<number> {
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        if (!(await cache.match(url))) await cache.add(url);
      } catch {
        failed++;
      }
      onDone();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return failed;
}

/**
 * Save everything /map needs offline. Resolves with the number of
 * resources that could not be downloaded.
 */
export async function saveMapForOffline(
  styleUrl: string,
  style: StyleSpecification,
  onProgress: (progress: SaveProgress) => void
): Promise<number> {
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

  const total = mapUrls.length + appUrls.length + 1;
  let done = 0;
  const tick = () => onProgress({ done: ++done, total });
  onProgress({ done, total });

  const [mapCache, staticCache, dynamicCache] = await Promise.all([
    caches.open(MAP_CACHE),
    caches.open(STATIC_CACHE),
    caches.open(DYNAMIC_CACHE),
  ]);

  let failed = await cacheAll(mapCache, mapUrls, tick);
  failed += await cacheAll(staticCache, appUrls, tick);
  try {
    await dynamicCache.add('/map');
  } catch {
    failed++;
  }
  tick();

  if (failed === 0) {
    try {
      localStorage.setItem(SAVED_KEY, new Date().toISOString());
    } catch {
      // Private mode: the map is still cached, we just cannot remember when
    }
  }
  return failed;
}
