/**
 * @jest-environment node
 *
 * Tests for GET /api/directions (upstream MOTIS server mocked)
 */

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { clearAllRateLimits } from '@/lib/rate-limit';

const plan = {
  itineraries: [
    {
      duration: 1500,
      startTime: '2027-01-30T07:30:00Z',
      endTime: '2027-01-30T07:55:00Z',
      transfers: 0,
      legs: [
        {
          mode: 'BUS',
          from: { name: 'Gare Centrale', lat: 50.845, lon: 4.357 },
          to: { name: 'ULB', lat: 50.813, lon: 4.382 },
          duration: 1500,
          startTime: '2027-01-30T07:30:00Z',
          endTime: '2027-01-30T07:55:00Z',
          routeShortName: '71',
        },
      ],
    },
  ],
  direct: [],
};

function get(query: string, ip = '10.0.0.1') {
  return GET(
    new NextRequest(`http://localhost/api/directions?${query}`, {
      headers: { 'x-forwarded-for': ip },
    })
  );
}

describe('GET /api/directions', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    clearAllRateLimits();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(plan), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('plans from rounded coordinates to a venue', async () => {
    const res = await get('from=50.84567,4.35512&to=fosdem&time=2027-01-30T08:00:00Z&arriveBy=true');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routes[0].legs[0].line).toBe('71');
    expect(body.attribution.name).toBe('Transitous');

    const [url, init] = fetchMock.mock.calls[0];
    const upstream = new URL(url);
    expect(upstream.searchParams.get('fromPlace')).toBe('50.846,4.355');
    expect(upstream.searchParams.get('toPlace')).toBe('50.8127,4.3816');
    expect(upstream.searchParams.get('arriveBy')).toBe('true');
    expect(upstream.searchParams.get('timetableView')).toBe('false');
    expect(init.headers['User-Agent']).toMatch(/OpenSourceVillage/);
  });

  it('answers repeated questions from its cache', async () => {
    await get('from=50.8,4.3&to=commons-hub&time=2027-01-30T10:01:00Z');
    const res = await get('from=50.8,4.3&to=commons-hub&time=2027-01-30T10:02:00Z');
    expect(res.headers.get('X-Directions-Cache')).toBe('hit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects places outside Belgium and unknown venues', async () => {
    expect((await get('from=48.85,2.35&to=fosdem')).status).toBe(400);
    expect((await get('from=50.8,4.3&to=atlantis')).status).toBe(400);
    expect((await get('from=50.8,4.3&to=fosdem&time=soon')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unavailable planner as 502', async () => {
    fetchMock.mockResolvedValue(new Response('busy', { status: 503 }));
    const res = await get('from=50.81,4.31&to=fosdem&time=2027-01-30T12:00:00Z');
    expect(res.status).toBe(502);
  });

  it('rate limits each client', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await get(`from=50.8,4.3&to=fosdem&time=2027-01-31T${String(i).padStart(2, '0')}:00:00Z`, '10.0.0.9');
    }
    expect(last!.status).toBe(429);
  });
});
