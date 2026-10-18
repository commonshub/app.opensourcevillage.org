/**
 * GET /api/directions - public transport routes to a venue
 *
 * Query:
 *   from      "lat,lon" (rounded to ~100 m before it leaves this server)
 *   to        venue slug from settings.json, or "lat,lon"
 *   time      ISO date-time, defaults to now
 *   arriveBy  "true" to arrive by `time` (leave-by planning)
 *
 * Example: /api/directions?from=50.845,4.355&to=fosdem&time=2027-01-30T09:00:00%2B01:00&arriveBy=true
 *
 * Routes come from a MOTIS server, Transitous by default
 * (https://transitous.org, data sources: https://transitous.org/sources/).
 * Answers are cached briefly so many villagers asking the same thing
 * cost one upstream request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, validationError } from '@/lib/api-utils';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { parsePlan, type TransitRoute } from '@/lib/transit';
import { getVenue, type Coordinates } from '@/lib/venues';

const PLAN_URL = process.env.DIRECTIONS_API_URL || 'https://api.transitous.org/api/v5/plan';
// Transitous asks every client to identify itself with a way to reach us
const USER_AGENT =
  process.env.DIRECTIONS_USER_AGENT ||
  'OpenSourceVillage/1.0 (+https://app.opensourcevillage.org; opensourcevillage@commonshub.brussels)';

const CACHE_TTL = 2 * 60 * 1000;
const CACHE_MAX = 300;
const UPSTREAM_TIMEOUT = 10000;

// Belgium and a margin: this is a Brussels app, not a general planner
const AREA = { south: 49.4, north: 51.6, west: 2.4, east: 6.5 };

interface DirectionsResponse {
  routes: TransitRoute[];
  fetchedAt: string;
  attribution: { name: string; url: string };
}

const cache = new Map<string, { expires: number; body: DirectionsResponse }>();

function parseCoordinates(value: string | null): Coordinates | null {
  const match = value?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (lat < AREA.south || lat > AREA.north || lon < AREA.west || lon > AREA.east) return null;
  return { lat, lon };
}

const rounded = ({ lat, lon }: Coordinates) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

/** Round to 5 minutes so nearby requests share a cache entry */
function roundTime(date: Date): Date {
  const step = 5 * 60 * 1000;
  return new Date(Math.round(date.getTime() / step) * step);
}

function remember(key: string, body: DirectionsResponse) {
  if (cache.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
    while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL, body });
}

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(`directions:${getClientIdentifier(request)}`, {
    maxRequests: 20,
    windowMs: 60000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many route requests, please wait a moment' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfter / 1000)) } }
    );
  }

  const params = request.nextUrl.searchParams;
  const from = parseCoordinates(params.get('from'));
  if (!from) return validationError('`from` must be "lat,lon" in Belgium');

  const toParam = params.get('to');
  const venue = toParam ? getVenue(toParam) : undefined;
  const to = venue ? { lat: venue.lat, lon: venue.lon } : parseCoordinates(toParam);
  if (!to) return validationError('`to` must be a venue slug or "lat,lon" in Belgium');

  const timeParam = params.get('time');
  const time = timeParam ? new Date(timeParam) : new Date();
  if (Number.isNaN(time.getTime())) return validationError('`time` must be an ISO date-time');
  const arriveBy = params.get('arriveBy') === 'true';

  const fromPlace = rounded(from);
  const toPlace = venue ? `${to.lat},${to.lon}` : rounded(to);
  const queryTime = roundTime(time).toISOString();
  const key = `${fromPlace}|${toPlace}|${queryTime}|${arriveBy}`;

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json(hit.body, { headers: { 'X-Directions-Cache': 'hit' } });
  }

  const upstream = new URL(PLAN_URL);
  upstream.searchParams.set('fromPlace', fromPlace);
  upstream.searchParams.set('toPlace', toPlace);
  upstream.searchParams.set('time', queryTime);
  upstream.searchParams.set('arriveBy', String(arriveBy));
  // arriveBy + no timetable view = latest departures that still arrive in time
  upstream.searchParams.set('timetableView', String(!arriveBy));
  upstream.searchParams.set('detailedTransfers', 'false');

  try {
    const res = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
    });
    if (!res.ok) {
      return errorResponse('The route planner is unavailable', 502, 'UPSTREAM_ERROR', {
        status: res.status,
      });
    }
    const body: DirectionsResponse = {
      routes: parsePlan(await res.json(), arriveBy),
      fetchedAt: new Date().toISOString(),
      attribution: { name: 'Transitous', url: 'https://transitous.org/sources/' },
    };
    remember(key, body);
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse('The route planner is unavailable', 502, 'UPSTREAM_ERROR', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
