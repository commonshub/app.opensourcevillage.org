/**
 * Venues around FOSDEM that villagers move between (the village, FOSDEM
 * itself, fringe events). The list lives in settings.json under `venues`.
 *
 * Directions are handed off to apps that know Brussels public transport
 * (STIB/MIVB, SNCB, De Lijn, TEC) via deep links, so this file has no
 * routing logic of its own.
 */

import settings from '../../settings.json';

export interface Venue {
  slug: string;
  name: string;
  /** What happens there, e.g. "The village" or "FOSDEM PGDay" */
  role: string;
  address: string;
  lat: number;
  lon: number;
  url?: string;
  osmUrl?: string;
}

export interface Coordinates {
  lat: number;
  lon: number;
}

export const VENUES: Venue[] = settings.venues;

export function getVenue(slug: string): Venue | undefined {
  return VENUES.find((venue) => venue.slug === slug);
}

/** Great-circle distance in metres */
export function distanceInMeters(from: Coordinates, to: Coordinates): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Rough walking time: straight-line distance plus 30% for streets,
 * at 4.8 km/h. Good enough to decide between walking and the bus.
 */
export function walkingMinutes(meters: number): number {
  return Math.max(1, Math.round((meters * 1.3) / 80));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Deep links for public transport directions to `to`. When `from` is
 * omitted the app starts from the user's current location.
 */
export function directionsLinks(to: Venue, from?: Coordinates & { name?: string }) {
  const dest = `${to.lat},${to.lon}`;

  const google = new URL('https://www.google.com/maps/dir/');
  google.searchParams.set('api', '1');
  google.searchParams.set('destination', dest);
  google.searchParams.set('travelmode', 'transit');
  if (from) google.searchParams.set('origin', `${from.lat},${from.lon}`);

  const citymapper = new URL('https://citymapper.com/directions');
  citymapper.searchParams.set('endcoord', dest);
  citymapper.searchParams.set('endname', to.name);
  citymapper.searchParams.set('endaddress', to.address);
  if (from) {
    citymapper.searchParams.set('startcoord', `${from.lat},${from.lon}`);
    if (from.name) citymapper.searchParams.set('startname', from.name);
  }

  const osm = new URL('https://www.openstreetmap.org/directions');
  osm.searchParams.set('engine', 'fossgis_osrm_foot');
  osm.searchParams.set('route', `${from ? `${from.lat},${from.lon}` : ''};${dest}`);

  return {
    google: google.toString(),
    citymapper: citymapper.toString(),
    walking: osm.toString(),
  };
}
