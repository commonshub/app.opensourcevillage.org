'use client';

/**
 * VenueMap Component
 *
 * Map of the venues around FOSDEM with public transport directions.
 * - MapLibre GL with OpenFreeMap tiles (OpenStreetMap data, no API key),
 *   loaded on demand so the rest of the app does not pay for it
 * - "From" picker: the user's location or another venue
 * - Routes and leave-by times for the selected venue (RoutePlanner), drawn
 *   on the map; ?venue=slug&arrive=ISO opens straight onto them
 * - Directions also open Google Maps (transit), Citymapper or OSM (walking)
 * - The venue area can be saved for offline use (OfflineMapPanel)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  VENUES,
  getVenue,
  distanceInMeters,
  walkingMinutes,
  formatDistance,
  directionsLinks,
  type Coordinates,
  type Venue,
} from '@/lib/venues';
import type { TransitRoute } from '@/lib/transit';
import { isOnline, setupNetworkListeners } from '@/lib/pwa';
import RoutePlanner from './RoutePlanner';
import OfflineMapPanel from './OfflineMapPanel';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const HERE = 'here';
const ROUTE_SOURCE = 'route';
const WALK_COLOR = '#6b7280';
const DEFAULT_LINE_COLOR = '#2563eb';

type Origin = (Coordinates & { name?: string }) | undefined;

function markerElement(index: number): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = String(index + 1);
  el.classList.add(
    'w-8', 'h-8', 'rounded-full', 'border-2', 'border-white', 'shadow-md',
    'text-sm', 'font-bold', 'text-white', 'bg-gray-800'
  );
  return el;
}

function setMarkerSelected(el: HTMLElement, selected: boolean) {
  el.classList.toggle('bg-blue-600', selected);
  el.classList.toggle('ring-4', selected);
  el.classList.toggle('ring-blue-200', selected);
  el.classList.toggle('bg-gray-800', !selected);
}

export default function VenueMap() {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  const [selected, setSelected] = useState<string | null>(() => {
    const slug = searchParams.get('venue');
    return slug && getVenue(slug) ? slug : null;
  });
  const [from, setFrom] = useState<string>(HERE);
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mapError, setMapError] = useState(false);
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null);
  const [online, setOnline] = useState(true);
  const [route, setRoute] = useState<TransitRoute | null>(null);
  const arriveParam = searchParams.get('arrive') ?? undefined;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Create the map once
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const maplibregl = (await import('maplibre-gl')).default;
        if (cancelled || !containerRef.current) return;

        const lats = VENUES.map((v) => v.lat);
        const lons = VENUES.map((v) => v.lon);
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          bounds: [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          fitBoundsOptions: { padding: 48 },
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        // Before the style has loaded, an error means no map at all (offline,
        // tiles blocked); later errors are single tiles and can be ignored.
        map.on('error', (e) => {
          console.warn('[VenueMap] map error', e.error);
          if (!map.loaded() && !cancelled) setMapError(true);
        });
        map.on('load', () => {
          setMapError(false);
          addRouteLayers(map);
          setLoadedMap(map);
        });

        markersRef.current = VENUES.map((venue, index) => {
          const el = markerElement(index);
          setMarkerSelected(el, venue.slug === selectedRef.current);
          el.setAttribute('aria-label', venue.name);
          el.addEventListener('click', () => setSelected(venue.slug));
          return new maplibregl.Marker({ element: el }).setLngLat([venue.lon, venue.lat]).addTo(map);
        });
        mapRef.current = map;

        // Deep link (?venue=slug) selected a venue before the map existed
        const initial = selectedRef.current ? getVenue(selectedRef.current) : undefined;
        if (initial) map.jumpTo({ center: [initial.lon, initial.lat], zoom: 15 });
      } catch (err) {
        console.error('[VenueMap] Failed to load map', err);
        if (!cancelled) setMapError(true);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setLoadedMap(null);
      markersRef.current = [];
    };
  }, []);

  // Highlight and fly to the selected venue
  useEffect(() => {
    markersRef.current.forEach((marker, index) => {
      setMarkerSelected(marker.getElement(), VENUES[index].slug === selected);
    });
    const venue = selected ? getVenue(selected) : undefined;
    if (venue && mapRef.current) {
      mapRef.current.flyTo({ center: [venue.lon, venue.lat], zoom: 15 });
    }
  }, [selected]);

  // Show the user's position on the map
  useEffect(() => {
    if (!position || !mapRef.current) return;
    let marker: Marker | undefined;
    import('maplibre-gl').then(({ default: maplibregl }) => {
      if (!mapRef.current) return;
      const el = document.createElement('div');
      el.className = 'w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow';
      el.setAttribute('aria-label', 'You are here');
      marker = new maplibregl.Marker({ element: el })
        .setLngLat([position.lon, position.lat])
        .addTo(mapRef.current);
    });
    return () => {
      marker?.remove();
    };
  }, [position]);

  // Draw the chosen route and frame it
  useEffect(() => {
    if (!loadedMap) return;
    const source = loadedMap.getSource<GeoJSONSource>(ROUTE_SOURCE);
    source?.setData(routeGeoJson(route));
    if (!route) return;
    const points = route.legs.flatMap((leg) => leg.path);
    if (points.length < 2) return;
    const lons = points.map(([lon]) => lon);
    const lats = points.map(([, lat]) => lat);
    loadedMap.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 40, maxZoom: 16 }
    );
  }, [loadedMap, route]);

  // Online status (browser-only API)
  useEffect(() => {
    setOnline(isOnline());
    return setupNetworkListeners(
      () => setOnline(true),
      () => setOnline(false)
    );
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Location is not available on this device.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocationError('Could not get your location. Pick a starting venue instead.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const origin: Origin = useMemo(() => {
    if (from === HERE) return position ?? undefined;
    const venue = getVenue(from);
    return venue ? { lat: venue.lat, lon: venue.lon, name: venue.name } : undefined;
  }, [from, position]);

  const destination = selected && selected !== from ? getVenue(selected) : undefined;

  return (
    <div className="space-y-4">
      <div className="relative bg-gray-200 rounded-lg overflow-hidden shadow-sm h-[50vh] min-h-[280px]">
        <div ref={containerRef} className="absolute inset-0" />
        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-gray-600">
            The map could not be loaded. Directions below still work.
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 space-y-2">
        <label htmlFor="directions-from" className="block text-sm font-medium text-gray-700">
          Directions from
        </label>
        <div className="flex gap-2">
          <select
            id="directions-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value={HERE}>My location</option>
            {VENUES.map((venue) => (
              <option key={venue.slug} value={venue.slug}>
                {venue.name}
              </option>
            ))}
          </select>
          {from === HERE && !position && (
            <button
              onClick={locate}
              disabled={locating}
              className="shrink-0 bg-blue-600 text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {locating ? 'Locating…' : 'Locate me'}
            </button>
          )}
        </div>
        {locationError && <p className="text-xs text-red-600">{locationError}</p>}
        {from === HERE && !position && !locationError && (
          <p className="text-xs text-gray-500">
            Your location is rounded to about 100 m before routes are looked up, and is not stored.
          </p>
        )}
      </div>

      {!online && (
        <p className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-3">
          You are offline. Distances, venue notes and routes you looked up recently still work;
          the directions apps need a connection.
        </p>
      )}

      {destination && origin && (
        <RoutePlanner
          key={destination.slug}
          origin={origin}
          destination={destination}
          initialArriveBy={destination.slug === searchParams.get('venue') ? arriveParam : undefined}
          onRouteChange={setRoute}
        />
      )}
      {destination && !origin && (
        <p className="text-sm text-gray-600 bg-white rounded-lg shadow-sm p-4">
          Tap <strong>Locate me</strong> or pick a starting venue to see routes to {destination.name}.
        </p>
      )}

      <ul className="space-y-3">
        {VENUES.map((venue, index) => (
          <VenueCard
            key={venue.slug}
            venue={venue}
            index={index}
            origin={from === venue.slug ? undefined : origin}
            isOrigin={from === venue.slug}
            selected={selected === venue.slug}
            onSelect={() => setSelected(venue.slug)}
          />
        ))}
      </ul>

      <OfflineMapPanel styleUrl={MAP_STYLE} map={loadedMap} online={online} />
    </div>
  );
}

/** Line layers for the chosen route: coloured transit legs, dashed walks */
function addRouteLayers(map: MapLibreMap) {
  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routeGeoJson(null) });
  map.addLayer({
    id: 'route-transit',
    type: 'line',
    source: ROUTE_SOURCE,
    filter: ['!=', ['get', 'kind'], 'walk'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 6 },
  });
  map.addLayer({
    id: 'route-walk',
    type: 'line',
    source: ROUTE_SOURCE,
    filter: ['==', ['get', 'kind'], 'walk'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': WALK_COLOR, 'line-width': 4, 'line-dasharray': [0.5, 2] },
  });
}

function routeGeoJson(route: TransitRoute | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (route?.legs ?? []).map((leg) => ({
      type: 'Feature',
      properties: { kind: leg.kind, color: leg.color ?? DEFAULT_LINE_COLOR },
      geometry: { type: 'LineString', coordinates: leg.path },
    })),
  };
}

function VenueCard({
  venue,
  index,
  origin,
  isOrigin,
  selected,
  onSelect,
}: {
  venue: Venue;
  index: number;
  origin: Origin;
  isOrigin: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const links = directionsLinks(venue, origin);
  const meters = origin ? distanceInMeters(origin, venue) : null;

  return (
    <li
      className={`bg-white rounded-lg shadow-sm p-4 border-2 ${selected ? 'border-blue-500' : 'border-transparent'}`}
    >
      <button onClick={onSelect} className="w-full text-left flex items-start gap-3">
        <span
          className={`shrink-0 w-7 h-7 rounded-full text-white text-sm font-bold flex items-center justify-center ${selected ? 'bg-blue-600' : 'bg-gray-800'}`}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-gray-900">{venue.name}</span>
          <span className="block text-sm text-gray-600">{venue.role}</span>
          <span className="block text-xs text-gray-500 mt-0.5">{venue.address}</span>
          {venue.note && <span className="block text-xs text-gray-600 mt-1">{venue.note}</span>}
          {meters !== null && (
            <span className="block text-xs text-gray-700 mt-1">
              {formatDistance(meters)} away · about {walkingMinutes(meters)} min on foot
            </span>
          )}
          {isOrigin && <span className="block text-xs text-gray-500 mt-1">Starting point</span>}
        </span>
      </button>

      {!isOrigin && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <a
            href={links.google}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-xs font-medium bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700"
          >
            Transit
          </a>
          <a
            href={links.citymapper}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-xs font-medium bg-green-600 text-white rounded-lg py-2 hover:bg-green-700"
          >
            Citymapper
          </a>
          <a
            href={links.walking}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-xs font-medium bg-gray-100 text-gray-800 rounded-lg py-2 hover:bg-gray-200"
          >
            Walk
          </a>
        </div>
      )}
      {venue.url && (
        <a
          href={venue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-xs text-blue-600 hover:underline"
        >
          About this venue →
        </a>
      )}
    </li>
  );
}
