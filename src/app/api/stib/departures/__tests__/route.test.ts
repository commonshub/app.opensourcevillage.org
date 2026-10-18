/**
 * @jest-environment node
 *
 * Tests for GET /api/stib/departures (STIB open data API mocked)
 */

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { clearAllRateLimits } from '@/lib/rate-limit';
import { resetStibLive } from '@/lib/stib-live';

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/stib/departures?${query}`));
}

function stibAnswer() {
  return new Response(
    JSON.stringify({
      results: [
        {
          pointid: '3503',
          lineid: '71',
          // The live API sends passing times as a JSON string
          passingtimes: JSON.stringify([
            { destination: { fr: 'DELTA', nl: 'DELTA' }, expectedArrivalTime: inMinutes(3), lineId: '71' },
            { destination: { fr: 'DELTA', nl: 'DELTA' }, expectedArrivalTime: inMinutes(11), lineId: '71' },
          ]),
        },
        {
          pointid: '3503',
          lineid: '38',
          passingtimes: JSON.stringify([
            { destination: { fr: 'HEROS', nl: 'HELDEN' }, expectedArrivalTime: inMinutes(5), lineId: '38' },
          ]),
        },
      ],
    }),
    { status: 200 }
  );
}

describe('GET /api/stib/departures', () => {
  const fetchMock = jest.fn();
  const env = { ...process.env };

  beforeEach(() => {
    clearAllRateLimits();
    resetStibLive();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => stibAnswer());
    global.fetch = fetchMock as unknown as typeof fetch;
    for (const key of ['STIB_API_KEY', 'STIB_API_KEY_HEADER', 'STIB_DAILY_LIMIT', 'STIB_MINUTE_LIMIT', 'STIB_LIVE_TIMES']) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = env;
  });

  it('works without a key and returns the next departures of one line', async () => {
    const res = await get('stop=3503&line=71');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.departures.map((d: { line: string }) => d.line)).toEqual(['71', '71']);
    expect(body.departures[0].destination).toBe('DELTA');
    expect(body.source).toBe('STIB-MIVB – Open Data');
    expect(body.stale).toBe(false);

    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).hostname).toBe('api-management-discovery-production.azure-api.net');
    expect(new URL(url).searchParams.get('where')).toBe('pointid="3503"');
    expect(Object.keys(init.headers)).toEqual(['Accept']);
  });

  it('sends the key when one is configured', async () => {
    process.env.STIB_API_KEY = 'test-key';
    await get('stop=3503');
    expect(fetchMock.mock.calls[0][1].headers['Ocp-Apim-Subscription-Key']).toBe('test-key');

    resetStibLive();
    process.env.STIB_API_KEY_HEADER = 'bmc-partner-key';
    await get('stop=3503');
    expect(fetchMock.mock.calls[1][1].headers['bmc-partner-key']).toBe('test-key');
  });

  it('serves every line at a stop from one cached upstream request', async () => {
    await get('stop=3503&line=71');
    const res = await get('stop=3503&line=38');
    expect((await res.json()).departures).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays within the anonymous quota of 10 requests a minute', async () => {
    for (let stop = 1000; stop < 1010; stop++) {
      expect((await get(`stop=${stop}`)).status).toBe(200);
    }
    const res = await get('stop=1010');
    expect(res.status).toBe(503);
    expect((await res.json()).quota).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('serves older times, marked stale, when the budget is spent', async () => {
    process.env.STIB_MINUTE_LIMIT = '1';
    process.env.STIB_API_KEY = 'test-key';
    jest.useFakeTimers({ now: Date.now(), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      await get('stop=3503');
      jest.advanceTimersByTime(30 * 1000); // past the 20 s cache, inside the minute
      const res = await get('stop=3503&line=71');
      const body = await res.json();
      expect(body.stale).toBe(true);
      expect(body.departures).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('can be turned off', async () => {
    process.env.STIB_LIVE_TIMES = 'off';
    const res = await get('stop=3503&line=71');
    expect(res.status).toBe(503);
    expect((await res.json()).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates its input', async () => {
    expect((await get('stop=abc')).status).toBe(400);
    expect((await get('stop=3503&line=71;drop')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
