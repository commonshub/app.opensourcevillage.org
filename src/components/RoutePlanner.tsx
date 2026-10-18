'use client';

/**
 * RoutePlanner Component
 *
 * Public transport routes to a venue, from /api/directions.
 * - "Leave now" or "Arrive by" a time (e.g. the start of a talk)
 * - Each option shows when to leave, a live countdown, the lines with
 *   their colours and real-time delays
 * - The chosen route is reported to the parent to draw on the map
 * - STIB-MIVB legs show STIB's own live waiting times at the boarding stop
 *   (when the server has a STIB_API_KEY)
 * - Offline, the service worker serves the last routes fetched (up to 12 h)
 */

import { useEffect, useMemo, useState } from 'react';
import settings from '../../settings.json';
import type { Coordinates, Venue } from '@/lib/venues';
import { leaveLabel, minutesUntil, type RouteLeg, type TransitRoute } from '@/lib/transit';
import { isStibAgency, stibStopId, type StibDeparture } from '@/lib/stib';

interface DirectionsResponse {
  routes: TransitRoute[];
  fetchedAt: string;
  attribution: { name: string; url: string };
}

interface RoutePlannerProps {
  origin: Coordinates;
  destination: Venue;
  /** ISO time to arrive by, e.g. from /map?arrive=... */
  initialArriveBy?: string;
  onRouteChange: (route: TransitRoute | null) => void;
}

const TIME_ZONE = settings.timezone;

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
}

/** Value for <input type="datetime-local"> in the viewer's local time */
function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function nextHour(): Date {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

const LEG_ICON: Record<RouteLeg['kind'], string> = {
  walk: '🚶',
  bus: '🚌',
  tram: '🚋',
  metro: 'Ⓜ️',
  train: '🚆',
  other: '➡️',
};

function LineBadge({ leg }: { leg: RouteLeg }) {
  if (leg.kind === 'walk') {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-gray-600">
        {LEG_ICON.walk}
        {leg.durationMinutes}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-bold rounded px-1.5 py-0.5"
      style={{
        backgroundColor: leg.color ?? '#374151',
        color: leg.textColor ?? '#ffffff',
      }}
    >
      <span aria-hidden>{LEG_ICON[leg.kind]}</span>
      {leg.line ?? leg.kind}
    </span>
  );
}

function Delay({ minutes, realTime }: { minutes: number; realTime: boolean }) {
  if (!realTime) return <span className="text-gray-400">scheduled</span>;
  if (minutes > 0) return <span className="text-red-600 font-medium">+{minutes} min</span>;
  if (minutes < 0) return <span className="text-green-700">{minutes} min</span>;
  return <span className="text-green-700">on time</span>;
}

const STIB_REFRESH = 30000;

/** STIB's live "next 71 in 3 min, 11 min" at the stop a leg boards */
function StibLive({ leg, now }: { leg: RouteLeg; now: number }) {
  const stop = isStibAgency(leg.agency) ? stibStopId(leg.fromStopId) : null;
  const [departures, setDepartures] = useState<StibDeparture[] | null>(null);

  useEffect(() => {
    if (!stop || !leg.line) return;
    let stopped = false;
    const params = new URLSearchParams({ stop, line: leg.line });
    const load = async () => {
      try {
        const res = await fetch(`/api/stib/departures?${params}`);
        if (!res.ok) {
          // Not configured: stop asking; offline or errors: try again later
          const body = await res.json().catch(() => ({}));
          if (body.disabled) stopped = true;
          setDepartures(null);
          return;
        }
        setDepartures((await res.json()).departures);
      } catch {
        setDepartures(null);
      }
    };
    load();
    const timer = setInterval(() => {
      if (!stopped && document.visibilityState === 'visible') load();
    }, STIB_REFRESH);
    return () => clearInterval(timer);
  }, [stop, leg.line]);

  const upcoming = (departures ?? []).filter((d) => minutesUntil(d.expected, now) >= 0).slice(0, 3);
  if (!upcoming.length) return null;

  return (
    <p className="text-xs text-gray-700 mt-0.5 flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" aria-hidden />
      <span>
        STIB live at {leg.from}:{' '}
        {upcoming.map((d) => {
          const minutes = minutesUntil(d.expected, now);
          return minutes === 0 ? 'now' : `${minutes} min`;
        }).join(' · ')}
      </span>
    </p>
  );
}

export default function RoutePlanner({
  origin,
  destination,
  initialArriveBy,
  onRouteChange,
}: RoutePlannerProps) {
  const [mode, setMode] = useState<'now' | 'arrive'>(initialArriveBy ? 'arrive' : 'now');
  const [arriveAt, setArriveAt] = useState(() =>
    toLocalInput(initialArriveBy ? new Date(initialArriveBy) : nextHour())
  );
  const [data, setData] = useState<DirectionsResponse | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Tick the countdowns
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      // ~100 m: enough for routing, vague enough to keep where you are private
      from: `${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}`,
      to: destination.slug,
    });
    if (mode === 'arrive') {
      const target = new Date(arriveAt);
      if (Number.isNaN(target.getTime())) return null;
      params.set('time', target.toISOString());
      params.set('arriveBy', 'true');
    }
    return params.toString();
  }, [origin.lat, origin.lon, destination.slug, mode, arriveAt]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/directions?${query}`, { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) {
          setError(
            body.offline
              ? 'You are offline and there are no saved routes for this trip.'
              : body.error || 'Could not get routes right now.'
          );
          setData(null);
          return;
        }
        setData(body);
        setSelected(0);
        // Only present when the service worker answered from its cache
        const stamp = res.headers.get('sw-cached-at');
        setCachedAt(stamp ? Number(stamp) : null);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError('Could not get routes right now.');
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const routes = data?.routes ?? [];
  const route = routes[selected] ?? null;

  useEffect(() => {
    onRouteChange(route);
  }, [route, onRouteChange]);

  useEffect(() => () => onRouteChange(null), [onRouteChange]);

  return (
    <section className="bg-white rounded-lg shadow-sm p-4 space-y-3" aria-label={`Routes to ${destination.name}`}>
      <h2 className="text-sm font-semibold text-gray-900">Routes to {destination.name}</h2>

      <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
        {(['now', 'arrive'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`flex-1 py-2 font-medium ${mode === value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            {value === 'now' ? 'Leave now' : 'Arrive by'}
          </button>
        ))}
      </div>
      {mode === 'arrive' && (
        <input
          type="datetime-local"
          value={arriveAt}
          onChange={(e) => setArriveAt(e.target.value)}
          aria-label="Arrive by"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      )}

      {loading && <p className="text-sm text-gray-500">Finding routes…</p>}
      {error && !loading && <p className="text-sm text-red-600">{error}</p>}
      {cachedAt && (
        <p className="text-xs text-yellow-800 bg-yellow-50 rounded p-2">
          Saved routes from {formatClock(new Date(cachedAt).toISOString())}. Times may have changed.
        </p>
      )}
      {!loading && !error && data && routes.length === 0 && (
        <p className="text-sm text-gray-600">No routes found for this time.</p>
      )}

      <ol className="space-y-2">
        {routes.map((option, index) => {
          const isSelected = index === selected;
          const leaveIn = minutesUntil(option.departure, now);
          return (
            <li key={`${option.departure}-${index}`}>
              <button
                onClick={() => setSelected(index)}
                aria-expanded={isSelected}
                className={`w-full text-left rounded-lg border-2 p-3 ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-gray-900">
                    {formatClock(option.departure)} → {formatClock(option.arrival)}
                  </span>
                  <span className="text-xs text-gray-600 shrink-0">
                    {option.durationMinutes} min
                    {option.walkOnly ? ' on foot' : option.transfers > 0 ? ` · ${option.transfers} change${option.transfers > 1 ? 's' : ''}` : ''}
                  </span>
                </div>
                <div
                  className={`text-sm font-medium ${leaveIn < 0 ? 'text-gray-400' : leaveIn <= 5 ? 'text-red-600' : 'text-blue-700'}`}
                >
                  {leaveLabel(option.departure, now)}
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {option.legs.map((leg, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {i > 0 && <span className="text-gray-300 text-xs">›</span>}
                      <LineBadge leg={leg} />
                    </span>
                  ))}
                </div>
              </button>

              {isSelected && (
                <ol className="mt-2 ml-2 border-l-2 border-gray-200 pl-3 space-y-2">
                  {option.legs.map((leg, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900 font-medium tabular-nums">{formatClock(leg.departure)}</span>
                        <LineBadge leg={leg} />
                        {leg.kind !== 'walk' && (
                          <span className="text-xs">
                            <Delay minutes={leg.delayMinutes} realTime={leg.realTime} />
                          </span>
                        )}
                      </div>
                      {leg.kind !== 'walk' && <StibLive leg={leg} now={now} />}
                      <p className="text-xs text-gray-600">
                        {leg.kind === 'walk'
                          ? `Walk ${leg.durationMinutes} min to ${leg.to}`
                          : `From ${leg.from}${leg.headsign ? ` towards ${leg.headsign}` : ''}, get off at ${leg.to}${leg.stops !== undefined ? ` (${leg.stops + 1} stop${leg.stops ? 's' : ''})` : ''}`}
                      </p>
                    </li>
                  ))}
                  <li className="text-sm">
                    <span className="text-gray-900 font-medium tabular-nums">{formatClock(option.arrival)}</span>{' '}
                    <span className="text-xs text-gray-600">Arrive at {destination.name}</span>
                  </li>
                </ol>
              )}
            </li>
          );
        })}
      </ol>

      {data && (
        <p className="text-[11px] text-gray-400">
          Routes by{' '}
          <a href={data.attribution.url} target="_blank" rel="noopener noreferrer" className="underline">
            {data.attribution.name}
          </a>{' '}
          from open public transport data. Times shown in Brussels time.
        </p>
      )}
    </section>
  );
}
