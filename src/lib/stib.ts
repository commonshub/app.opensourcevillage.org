/**
 * Live waiting times from STIB-MIVB open data
 * (dataset `waiting-time-rt-production`, refreshed every 20 s).
 *
 * Routes come from Transitous, which knows STIB's timetable; this adds
 * STIB's own real-time "next 71 in 3 min" at the stop where a route
 * boards a STIB line. Fetching lives in stib-live.ts (server only).
 *
 * The dataset has been published in two shapes over the years (camelCase
 * `points`/`passingTimes`, and lowercase Opendatasoft records); both are
 * read. Anything unrecognised yields no departures rather than an error.
 */

/** Attribution STIB-MIVB's terms of use ask for */
export const STIB_ATTRIBUTION = 'STIB-MIVB – Open Data';

export interface StibDeparture {
  line: string;
  destination: string;
  /** ISO time */
  expected: string;
  /** Service message STIB attaches instead of a time, if any */
  message?: string;
}

/** Is this route leg run by STIB-MIVB? */
export function isStibAgency(agency?: string): boolean {
  return !!agency && /\b(STIB|MIVB)\b/i.test(agency);
}

/**
 * STIB stop id ("pointid") for a stop id from the route planner.
 * Transitous prefixes ids with the feed name ("be-stib_1059F"); STIB's
 * GTFS adds a platform letter that the waiting-time API leaves out.
 */
export function stibStopId(stopId?: string): string | null {
  if (!stopId) return null;
  const id = stopId.slice(Math.max(stopId.lastIndexOf('_'), stopId.lastIndexOf(':')) + 1);
  return id.match(/^\d{3,5}/)?.[0] ?? null;
}

interface PassingTime {
  destination?: { fr?: string; nl?: string; en?: string } | string;
  expectedArrivalTime?: string;
  lineId?: string | number;
  message?: { fr?: string; nl?: string; en?: string } | string;
}

function text(value: PassingTime['destination']): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.en || value.fr || value.nl || '';
}

function passingTimesOf(record: Record<string, unknown>): PassingTime[] {
  const raw = record.passingtimes ?? record.passingTimes;
  if (Array.isArray(raw)) return raw as PassingTime[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Departures in a waiting-time response, soonest first, optionally for
 * one line only.
 */
export function parseWaitingTimes(body: unknown, line?: string): StibDeparture[] {
  const data = body as { results?: unknown[]; points?: unknown[] } | null;
  const records = (data?.results ?? data?.points ?? []) as Record<string, unknown>[];

  const departures: StibDeparture[] = [];
  for (const record of records) {
    const recordLine = record.lineid ?? record.lineId;
    for (const passing of passingTimesOf(record)) {
      const lineId = String(passing.lineId ?? recordLine ?? '');
      if (line && lineId !== line) continue;
      if (!passing.expectedArrivalTime) continue;
      const expected = new Date(passing.expectedArrivalTime);
      if (Number.isNaN(expected.getTime())) continue;
      departures.push({
        line: lineId,
        destination: text(passing.destination),
        expected: expected.toISOString(),
        message: passing.message ? text(passing.message) || undefined : undefined,
      });
    }
  }
  return departures.sort((a, b) => Date.parse(a.expected) - Date.parse(b.expected));
}
