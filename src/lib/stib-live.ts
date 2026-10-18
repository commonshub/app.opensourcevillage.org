/**
 * Server-side access to STIB-MIVB live waiting times, within STIB's quota.
 *
 * Data: STIB-MIVB "Waiting Time" via the Belgian Mobility open data portal
 * (https://data.belgianmobility.io), which replaced data.stib-mivb.brussels.
 * Anonymous access is allowed for 100 requests a day and 10 a minute; a
 * free key from the portal's developer area raises that. To stay within
 * the budget for the whole server:
 * - one upstream request per stop serves every line and every villager
 *   asking about it, cached 20 s with a key (STIB refreshes every 20 s)
 *   and 2 min without
 * - once the budget is spent, the last known times are served (marked
 *   stale) rather than nothing
 *
 * Environment:
 *   STIB_API_KEY          optional key, sent in STIB_API_KEY_HEADER
 *   STIB_API_KEY_HEADER   default Ocp-Apim-Subscription-Key (Azure API Management)
 *   STIB_DAILY_LIMIT / STIB_MINUTE_LIMIT  override the request budget
 *   STIB_WAITING_TIMES_URL  override the endpoint
 */

import { parseWaitingTimes, type StibDeparture } from './stib';

const DEFAULT_URL =
  'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/rt/WaitingTimes';

const ANONYMOUS_DAILY_LIMIT = 100;
const ANONYMOUS_MINUTE_LIMIT = 10;
const KEYED_CACHE_TTL = 20 * 1000;
const ANONYMOUS_CACHE_TTL = 2 * 60 * 1000;
const UPSTREAM_TIMEOUT = 8000;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export interface StopTimes {
  departures: StibDeparture[];
  fetchedAt: string;
  /** True when these are older times served because the budget is spent or STIB failed */
  stale: boolean;
}

export type StopTimesResult =
  | { ok: true; times: StopTimes }
  | { ok: false; reason: 'quota' | 'upstream'; detail?: string };

const cache = new Map<string, { expires: number; departures: StibDeparture[]; fetchedAt: string }>();
const budget = { minuteStart: 0, minuteCount: 0, dayStart: 0, dayCount: 0 };

function limits() {
  const keyed = !!process.env.STIB_API_KEY;
  const parse = (value: string | undefined, fallback: number) =>
    value !== undefined && value !== '' ? Number(value) : fallback;
  return {
    daily: parse(process.env.STIB_DAILY_LIMIT, keyed ? Infinity : ANONYMOUS_DAILY_LIMIT),
    perMinute: parse(process.env.STIB_MINUTE_LIMIT, keyed ? Infinity : ANONYMOUS_MINUTE_LIMIT),
    ttl: keyed ? KEYED_CACHE_TTL : ANONYMOUS_CACHE_TTL,
  };
}

/** Take one request from the budget, or return false if it is spent */
function spendBudget(now: number): boolean {
  const { daily, perMinute } = limits();
  if (now - budget.dayStart >= DAY) Object.assign(budget, { dayStart: now, dayCount: 0 });
  if (now - budget.minuteStart >= MINUTE) Object.assign(budget, { minuteStart: now, minuteCount: 0 });
  if (budget.dayCount >= daily || budget.minuteCount >= perMinute) return false;
  budget.dayCount++;
  budget.minuteCount++;
  return true;
}

/** Forget cached times and spent budget (tests) */
export function resetStibLive() {
  cache.clear();
  Object.assign(budget, { minuteStart: 0, minuteCount: 0, dayStart: 0, dayCount: 0 });
}

/** All departures at a STIB stop, from cache when fresh enough */
export async function getStopTimes(stop: string): Promise<StopTimesResult> {
  const now = Date.now();
  const cached = cache.get(stop);
  const fallback = (reason: 'quota' | 'upstream', detail?: string): StopTimesResult =>
    cached
      ? { ok: true, times: { departures: cached.departures, fetchedAt: cached.fetchedAt, stale: true } }
      : { ok: false, reason, detail };

  if (cached && cached.expires > now) {
    return { ok: true, times: { departures: cached.departures, fetchedAt: cached.fetchedAt, stale: false } };
  }
  if (!spendBudget(now)) return fallback('quota');

  const url = new URL(process.env.STIB_WAITING_TIMES_URL || DEFAULT_URL);
  url.searchParams.set('where', `pointid="${stop}"`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.STIB_API_KEY) {
    headers[process.env.STIB_API_KEY_HEADER || 'Ocp-Apim-Subscription-Key'] = process.env.STIB_API_KEY;
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) });
    if (!res.ok) return fallback('upstream', `HTTP ${res.status}`);
    const entry = {
      expires: now + limits().ttl,
      departures: parseWaitingTimes(await res.json()),
      fetchedAt: new Date().toISOString(),
    };
    cache.set(stop, entry);
    return { ok: true, times: { departures: entry.departures, fetchedAt: entry.fetchedAt, stale: false } };
  } catch (error) {
    return fallback('upstream', error instanceof Error ? error.message : String(error));
  }
}
