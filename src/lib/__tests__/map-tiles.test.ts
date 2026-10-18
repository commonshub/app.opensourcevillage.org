/**
 * Tests for slippy-map tile maths
 */

import { boundsAround, tileFor, tilesForBounds, tileUrl } from '../map-tiles';
import { VENUES } from '../venues';

describe('tileFor', () => {
  it('puts the whole world in one tile at zoom 0', () => {
    expect(tileFor(4.35, 50.84, 0)).toEqual({ x: 0, y: 0 });
  });

  it('finds the Brussels tile at zoom 14', () => {
    // Grand Place, 50.8467 N 4.3525 E
    expect(tileFor(4.3525, 50.8467, 14)).toEqual({ x: 8390, y: 5496 });
  });
});

describe('tilesForBounds', () => {
  it('covers every venue at every zoom level', () => {
    const bounds = boundsAround(VENUES);
    const tiles = tilesForBounds(bounds, 10, 14);
    for (const venue of VENUES) {
      for (let z = 10; z <= 14; z++) {
        const { x, y } = tileFor(venue.lon, venue.lat, z);
        expect(tiles).toContainEqual({ z, x, y });
      }
    }
  });

  it('keeps the venue area small enough to download on a phone', () => {
    const tiles = tilesForBounds(boundsAround(VENUES), 10, 14);
    expect(tiles.length).toBeLessThan(200);
  });
});

describe('tileUrl', () => {
  it('fills the template', () => {
    expect(tileUrl('https://t.example/{z}/{x}/{y}.pbf', { z: 14, x: 8390, y: 5496 })).toBe(
      'https://t.example/14/8390/5496.pbf'
    );
  });
});
