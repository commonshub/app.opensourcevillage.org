/**
 * Public transport routes between venues, from a MOTIS routing server
 * (Transitous by default, https://transitous.org).
 *
 * MOTIS answers in its own format (openapi.yaml in motis-project/motis);
 * parsePlan() turns it into the small shape the app shows, and the
 * /api/directions route sends that to the browser.
 */

export type LegKind = 'walk' | 'bus' | 'tram' | 'metro' | 'train' | 'other';

export interface RouteLeg {
  kind: LegKind;
  from: string;
  to: string;
  /** ISO times, including real-time delays when known */
  departure: string;
  arrival: string;
  /** Minutes late against the timetable (negative when early) */
  delayMinutes: number;
  realTime: boolean;
  cancelled: boolean;
  durationMinutes: number;
  /** Line name, e.g. "71" */
  line?: string;
  headsign?: string;
  /** CSS colours, e.g. "#e2001a" */
  color?: string;
  textColor?: string;
  /** Number of stops between boarding and alighting */
  stops?: number;
  /** [lon, lat] pairs */
  path: [number, number][];
}

export interface TransitRoute {
  departure: string;
  arrival: string;
  durationMinutes: number;
  transfers: number;
  walkOnly: boolean;
  legs: RouteLeg[];
}

// ─── MOTIS response (only the fields we read) ────────────────────────────

interface MotisPlace {
  name: string;
  lat: number;
  lon: number;
}

interface MotisLeg {
  mode: string;
  from: MotisPlace;
  to: MotisPlace;
  duration: number;
  startTime: string;
  endTime: string;
  scheduledStartTime?: string;
  realTime?: boolean;
  cancelled?: boolean;
  headsign?: string;
  routeShortName?: string;
  displayName?: string;
  routeColor?: string;
  routeTextColor?: string;
  intermediateStops?: unknown[];
  legGeometry?: { points: string; precision: number };
}

interface MotisItinerary {
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: MotisLeg[];
}

interface MotisPlan {
  itineraries?: MotisItinerary[];
  direct?: MotisItinerary[];
}

// ─── Parsing ─────────────────────────────────────────────────────────────

const MODE_KINDS: Record<string, LegKind> = {
  WALK: 'walk',
  BUS: 'bus',
  COACH: 'bus',
  TRAM: 'tram',
  SUBWAY: 'metro',
  METRO: 'metro',
  RAIL: 'train',
  SUBURBAN: 'train',
  REGIONAL_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'train',
  LONG_DISTANCE: 'train',
  HIGHSPEED_RAIL: 'train',
  NIGHT_RAIL: 'train',
};

function cssColor(hex?: string): string | undefined {
  if (!hex) return undefined;
  const value = hex.replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : undefined;
}

/**
 * Decode a Google encoded polyline into [lon, lat] pairs.
 * MOTIS uses precision 6 or 7 depending on the API version.
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lon / factor, lat / factor]);
  }
  return points;
}

function parseLeg(leg: MotisLeg): RouteLeg {
  const kind = MODE_KINDS[leg.mode] ?? 'other';
  const scheduled = leg.scheduledStartTime ? Date.parse(leg.scheduledStartTime) : NaN;
  const delayMinutes = Number.isNaN(scheduled)
    ? 0
    : Math.round((Date.parse(leg.startTime) - scheduled) / 60000);
  const path = leg.legGeometry?.points
    ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision)
    : [];

  return {
    kind,
    from: leg.from.name,
    to: leg.to.name,
    departure: leg.startTime,
    arrival: leg.endTime,
    delayMinutes,
    realTime: !!leg.realTime,
    cancelled: !!leg.cancelled,
    durationMinutes: Math.max(1, Math.round(leg.duration / 60)),
    line: kind === 'walk' ? undefined : leg.routeShortName || leg.displayName,
    headsign: leg.headsign,
    color: cssColor(leg.routeColor),
    textColor: cssColor(leg.routeTextColor),
    stops: leg.intermediateStops ? leg.intermediateStops.length : undefined,
    path: path.length ? path : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]],
  };
}

function parseItinerary(itinerary: MotisItinerary): TransitRoute {
  const legs = itinerary.legs.map(parseLeg);
  return {
    departure: itinerary.startTime,
    arrival: itinerary.endTime,
    durationMinutes: Math.max(1, Math.round(itinerary.duration / 60)),
    transfers: itinerary.transfers,
    walkOnly: legs.every((leg) => leg.kind === 'walk'),
    legs,
  };
}

/**
 * Turn a MOTIS plan response into routes, best first: for "arrive by"
 * the latest departure, otherwise the earliest arrival. Cancelled
 * connections are dropped; a walking route is kept as an option.
 */
export function parsePlan(plan: MotisPlan, arriveBy: boolean, limit = 4): TransitRoute[] {
  const transit = (plan.itineraries ?? [])
    .map(parseItinerary)
    .filter((route) => !route.legs.some((leg) => leg.cancelled));
  const walking = (plan.direct ?? [])
    .map(parseItinerary)
    .filter((route) => route.walkOnly);

  const byPreference = (a: TransitRoute, b: TransitRoute) =>
    arriveBy
      ? Date.parse(b.departure) - Date.parse(a.departure)
      : Date.parse(a.arrival) - Date.parse(b.arrival);

  return [...transit.sort(byPreference).slice(0, limit - (walking.length ? 1 : 0)), ...walking.slice(0, 1)];
}

/** Whole minutes from `now` until `iso`; negative once it has passed */
export function minutesUntil(iso: string, now: number = Date.now()): number {
  return Math.floor((Date.parse(iso) - now) / 60000);
}

/** "Leave now", "Leave in 12 min", "Leave in 1 h 05", "Left 3 min ago" */
export function leaveLabel(iso: string, now: number = Date.now()): string {
  const minutes = minutesUntil(iso, now);
  if (minutes < 0) return `Left ${-minutes} min ago`;
  if (minutes === 0) return 'Leave now';
  if (minutes < 60) return `Leave in ${minutes} min`;
  return `Leave in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}
