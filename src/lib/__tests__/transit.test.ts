/**
 * Tests for parsing MOTIS routing responses
 */

import { decodePolyline, parsePlan, minutesUntil, leaveLabel } from '../transit';

describe('decodePolyline', () => {
  it('decodes the Google reference example at precision 5', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('honours the precision MOTIS reports', () => {
    // 50.8, 4.35 at precision 6
    const encoded = encodePoint(50.8, 4.35, 6);
    const [[lon, lat]] = decodePolyline(encoded, 6);
    expect(lat).toBeCloseTo(50.8, 6);
    expect(lon).toBeCloseTo(4.35, 6);
  });
});

/** Minimal encoder for a single point, to build test fixtures */
function encodePoint(lat: number, lon: number, precision: number): string {
  const encode = (value: number) => {
    let v = Math.round(value * 10 ** precision);
    v = v < 0 ? ~(v << 1) : v << 1;
    let out = '';
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return out + String.fromCharCode(v + 63);
  };
  return encode(lat) + encode(lon);
}

const place = (name: string, lat = 50.84, lon = 4.35) => ({ name, lat, lon });

function walk(start: string, end: string) {
  return {
    mode: 'WALK',
    from: place('Start'),
    to: place('Stop'),
    duration: (Date.parse(end) - Date.parse(start)) / 1000,
    startTime: start,
    endTime: end,
  };
}

function bus71(start: string, end: string, scheduledStart: string, extra = {}) {
  return {
    mode: 'BUS',
    from: place('Gare Centrale'),
    to: place('ULB'),
    duration: (Date.parse(end) - Date.parse(start)) / 1000,
    startTime: start,
    endTime: end,
    scheduledStartTime: scheduledStart,
    realTime: true,
    routeShortName: '71',
    headsign: 'DELTA',
    routeColor: 'E2001A',
    routeTextColor: 'FFFFFF',
    intermediateStops: [{}, {}, {}],
    legGeometry: { points: encodePoint(50.845, 4.357, 6) + encodePoint(0.01, 0.01, 6), precision: 6 },
    ...extra,
  };
}

function itinerary(legs: ReturnType<typeof walk | typeof bus71>[]) {
  const start = legs[0].startTime;
  const end = legs[legs.length - 1].endTime;
  return {
    duration: (Date.parse(end) - Date.parse(start)) / 1000,
    startTime: start,
    endTime: end,
    transfers: 0,
    legs,
  };
}

describe('parsePlan', () => {
  const early = itinerary([
    walk('2027-01-30T08:10:00Z', '2027-01-30T08:15:00Z'),
    bus71('2027-01-30T08:17:00Z', '2027-01-30T08:38:00Z', '2027-01-30T08:15:00Z'),
  ]);
  const late = itinerary([
    walk('2027-01-30T08:25:00Z', '2027-01-30T08:30:00Z'),
    bus71('2027-01-30T08:30:00Z', '2027-01-30T08:52:00Z', '2027-01-30T08:30:00Z'),
  ]);
  const cancelled = itinerary([
    bus71('2027-01-30T08:40:00Z', '2027-01-30T08:55:00Z', '2027-01-30T08:40:00Z', { cancelled: true }),
  ]);
  const onFoot = itinerary([walk('2027-01-30T08:00:00Z', '2027-01-30T08:58:00Z')]);
  const plan = { itineraries: [early, late, cancelled], direct: [onFoot] };

  it('reads line, colour, delay and stops for transit legs', () => {
    const [route] = parsePlan(plan, false);
    const bus = route.legs[1];
    expect(bus).toMatchObject({
      kind: 'bus',
      line: '71',
      headsign: 'DELTA',
      color: '#e2001a',
      textColor: '#ffffff',
      delayMinutes: 2,
      realTime: true,
      stops: 3,
      durationMinutes: 21,
    });
    expect(bus.path[0][1]).toBeCloseTo(50.845, 5);
    expect(route.legs[0].line).toBeUndefined();
  });

  it('puts the earliest arrival first when leaving now', () => {
    const routes = parsePlan(plan, false);
    expect(routes.map((r) => r.departure)).toEqual([
      '2027-01-30T08:10:00Z',
      '2027-01-30T08:25:00Z',
      '2027-01-30T08:00:00Z',
    ]);
  });

  it('puts the latest departure first when arriving by a time', () => {
    const routes = parsePlan(plan, true);
    expect(routes[0].departure).toBe('2027-01-30T08:25:00Z');
  });

  it('drops cancelled connections and keeps walking as the last option', () => {
    const routes = parsePlan(plan, false);
    expect(routes).toHaveLength(3);
    expect(routes[2].walkOnly).toBe(true);
  });

  it('falls back to a straight line when a leg has no geometry', () => {
    const [route] = parsePlan({ itineraries: [itinerary([walk('2027-01-30T08:00:00Z', '2027-01-30T08:05:00Z')])] }, false);
    expect(route.legs[0].path).toHaveLength(2);
  });

  it('copes with an empty answer', () => {
    expect(parsePlan({}, false)).toEqual([]);
  });
});

describe('leave times', () => {
  const now = Date.parse('2027-01-30T08:00:00Z');

  it('counts whole minutes', () => {
    expect(minutesUntil('2027-01-30T08:12:30Z', now)).toBe(12);
  });

  it('labels departures', () => {
    expect(leaveLabel('2027-01-30T08:00:30Z', now)).toBe('Leave now');
    expect(leaveLabel('2027-01-30T08:12:00Z', now)).toBe('Leave in 12 min');
    expect(leaveLabel('2027-01-30T09:05:00Z', now)).toBe('Leave in 1 h 05');
    expect(leaveLabel('2027-01-30T07:57:00Z', now)).toBe('Left 3 min ago');
  });
});
