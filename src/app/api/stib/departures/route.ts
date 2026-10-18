/**
 * GET /api/stib/departures - live STIB-MIVB waiting times at a stop
 *
 * Query:
 *   stop  STIB stop id ("pointid"), e.g. 1059
 *   line  optional line number, e.g. 71
 *
 * Off unless STIB_API_KEY is set (free key from the STIB-MIVB open data
 * portal): the anonymous quota is far too small for a whole village.
 * STIB refreshes the data every 20 s, so answers are cached that long.
 */

import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, validationError } from '@/lib/api-utils';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { parseWaitingTimes, type StibDeparture } from '@/lib/stib';

const WAITING_TIMES_URL =
  process.env.STIB_WAITING_TIMES_URL ||
  'https://data.stib-mivb.brussels/api/explore/v2.1/catalog/datasets/waiting-time-rt-production/records';

const CACHE_TTL = 20 * 1000;
const UPSTREAM_TIMEOUT = 8000;

interface DeparturesResponse {
  departures: StibDeparture[];
  fetchedAt: string;
}

const cache = new Map<string, { expires: number; departures: StibDeparture[]; fetchedAt: string }>();

export async function GET(request: NextRequest) {
  const apiKey = process.env.STIB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'STIB live times are not configured', disabled: true }, { status: 503 });
  }

  const limit = checkRateLimit(`stib:${getClientIdentifier(request)}`, { maxRequests: 30, windowMs: 60000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests, please wait a moment' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfter / 1000)) } }
    );
  }

  const stop = request.nextUrl.searchParams.get('stop') ?? '';
  const line = request.nextUrl.searchParams.get('line') ?? undefined;
  if (!/^\d{3,5}$/.test(stop)) return validationError('`stop` must be a STIB stop number');
  if (line !== undefined && !/^[A-Za-z0-9]{1,4}$/.test(line)) return validationError('`line` must be a line number');

  // One upstream request per stop serves every line asked about there
  let entry = cache.get(stop);
  if (!entry || entry.expires < Date.now()) {
    const upstream = new URL(WAITING_TIMES_URL);
    upstream.searchParams.set('where', `pointid="${stop}"`);
    upstream.searchParams.set('limit', '50');
    try {
      const res = await fetch(upstream, {
        headers: { Authorization: `Apikey ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
      });
      if (!res.ok) {
        return errorResponse('STIB live times are unavailable', 502, 'UPSTREAM_ERROR', { status: res.status });
      }
      entry = {
        expires: Date.now() + CACHE_TTL,
        departures: parseWaitingTimes(await res.json()),
        fetchedAt: new Date().toISOString(),
      };
      cache.set(stop, entry);
    } catch (error) {
      return errorResponse('STIB live times are unavailable', 502, 'UPSTREAM_ERROR', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const body: DeparturesResponse = {
    departures: entry.departures
      .filter((departure) => !line || departure.line === line)
      .filter((departure) => Date.parse(departure.expected) > Date.now() - 60000),
    fetchedAt: entry.fetchedAt,
  };
  return NextResponse.json(body);
}
