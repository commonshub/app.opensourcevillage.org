/**
 * Tests for venue data and directions helpers
 */

import {
  VENUES,
  getVenue,
  distanceInMeters,
  walkingMinutes,
  formatDistance,
  directionsLinks,
} from '../venues';

describe('VENUES', () => {
  it('has unique slugs', () => {
    const slugs = VENUES.map((venue) => venue.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('places every venue in Brussels', () => {
    for (const venue of VENUES) {
      expect(venue.lat).toBeGreaterThan(50.75);
      expect(venue.lat).toBeLessThan(50.92);
      expect(venue.lon).toBeGreaterThan(4.25);
      expect(venue.lon).toBeLessThan(4.5);
    }
  });

  it('includes the village', () => {
    expect(getVenue('commons-hub')?.name).toBe('Commons Hub Brussels');
  });
});

describe('distance helpers', () => {
  it('measures the village to FOSDEM at about 4 km', () => {
    const meters = distanceInMeters(getVenue('commons-hub')!, getVenue('fosdem')!);
    expect(meters).toBeGreaterThan(3500);
    expect(meters).toBeLessThan(4500);
  });

  it('formats short and long distances', () => {
    expect(formatDistance(342)).toBe('340 m');
    expect(formatDistance(3870)).toBe('3.9 km');
  });

  it('never estimates less than a minute of walking', () => {
    expect(walkingMinutes(0)).toBe(1);
    expect(walkingMinutes(800)).toBe(13);
  });
});

describe('directionsLinks', () => {
  const fosdem = getVenue('fosdem')!;

  it('asks Google Maps for public transport to the venue', () => {
    const url = new URL(directionsLinks(fosdem).google);
    expect(url.searchParams.get('travelmode')).toBe('transit');
    expect(url.searchParams.get('destination')).toBe(`${fosdem.lat},${fosdem.lon}`);
    expect(url.searchParams.has('origin')).toBe(false);
  });

  it('starts from the given origin when there is one', () => {
    const hub = getVenue('commons-hub')!;
    const links = directionsLinks(fosdem, { lat: hub.lat, lon: hub.lon, name: hub.name });
    expect(new URL(links.google).searchParams.get('origin')).toBe(`${hub.lat},${hub.lon}`);
    expect(new URL(links.citymapper).searchParams.get('startname')).toBe(hub.name);
    expect(new URL(links.walking).searchParams.get('route')).toBe(
      `${hub.lat},${hub.lon};${fosdem.lat},${fosdem.lon}`
    );
  });
});
