/**
 * GET /api/stib/departures - live STIB-MIVB waiting times at a stop
 *
 * Query:
 *   stop  STIB stop id ("pointid"), e.g. 3503
 *   line  optional line number, e.g. 71
 *
 * Works without a key within STIB's anonymous quota; see
 * src/lib/stib-live.ts for the budget and caching, and .env.example for
 * the settings. STIB_LIVE_TIMES=off turns the feature off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, validationError } from '@/lib/api-utils';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { STIB_ATTRIBUTION } from '@/lib/stib';
import { getStopTimes } from '@/lib/stib-live';

export async function GET(request: NextRequest) {
  if (process.env.STIB_LIVE_TIMES === 'off') {
    return NextResponse.json({ error: 'STIB live times are turned off', disabled: true }, { status: 503 });
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

  const result = await getStopTimes(stop);
  if (!result.ok) {
    if (result.reason === 'quota') {
      return NextResponse.json({ error: 'STIB live times are busy, try again later', quota: true }, { status: 503 });
    }
    return errorResponse('STIB live times are unavailable', 502, 'UPSTREAM_ERROR', { message: result.detail });
  }

  const { departures, fetchedAt, stale } = result.times;
  return NextResponse.json({
    departures: departures
      .filter((departure) => !line || departure.line === line)
      .filter((departure) => Date.parse(departure.expected) > Date.now() - 60000),
    fetchedAt,
    stale,
    source: STIB_ATTRIBUTION,
  });
}
