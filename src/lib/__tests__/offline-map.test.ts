/**
 * The page and the service worker share Cache Storage by name; keep them in sync.
 */

import fs from 'fs';
import path from 'path';
import { MAP_OFFLINE_CACHE, STATIC_CACHE, PAGES_CACHE, CACHED_AT, formatBytes } from '../offline-map';

describe('offline map caches', () => {
  const sw = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  const version = sw.match(/const CACHE_VERSION = '([^']+)'/)?.[1];

  it('uses the service worker cache version', () => {
    expect(STATIC_CACHE).toBe(`${version}-static`);
    expect(PAGES_CACHE).toBe(`${version}-pages`);
  });

  it('uses the service worker map cache and timestamp header', () => {
    expect(sw).toContain(`const MAP_OFFLINE_CACHE = '${MAP_OFFLINE_CACHE}'`);
    expect(sw).toContain(`const CACHED_AT = '${CACHED_AT}'`);
  });
});

describe('formatBytes', () => {
  it('formats kilobytes and megabytes', () => {
    expect(formatBytes(300)).toBe('1 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });
});
