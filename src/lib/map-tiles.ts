/**
 * Slippy-map tile maths, used to download the map around the venues for
 * offline use. The service worker (public/sw.js) caches whatever is fetched.
 */

import type { Coordinates } from './venues';

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Bounding box around the given points, padded by `padding` degrees */
export function boundsAround(points: Coordinates[], padding = 0.01): TileBounds {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    west: Math.min(...lons) - padding,
    south: Math.min(...lats) - padding,
    east: Math.max(...lons) + padding,
    north: Math.max(...lats) + padding,
  };
}

/** Tile containing a point at zoom `z` (Web Mercator) */
export function tileFor(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.min(n - 1, Math.max(0, x)),
    y: Math.min(n - 1, Math.max(0, y)),
  };
}

/** Every tile covering `bounds` from `minZoom` to `maxZoom` inclusive */
export function tilesForBounds(bounds: TileBounds, minZoom: number, maxZoom: number): Tile[] {
  const tiles: Tile[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const topLeft = tileFor(bounds.west, bounds.north, z);
    const bottomRight = tileFor(bounds.east, bounds.south, z);
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/** Fill a `{z}/{x}/{y}` URL template */
export function tileUrl(template: string, tile: Tile): string {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}
