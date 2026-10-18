/**
 * @jest-environment node
 *
 * Tests for GET /api/stib/departures (STIB open data API mocked)
 */

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { clearAllRateLimits } from '@/lib/rate-limit';

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/stib/departures?${query}`));
}

describe('GET /api/stib/departures', () => {
  const fetchMock = jest.fn();
  const originalKey = process.env.STIB_API_KEY;

  beforeEach(() => {
    clearAllRateLimits();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              pointid: '1059',
              lineid: '71',
              passingtimes: [
                { destination: { fr: 'DELTA' }, expectedArrivalTime: inMinutes(3), lineId: '71' },
                { destination: { fr: 'DELTA' }, expectedArrivalTime: inMinutes(11), lineId: '71' },
              ],
            },
            {
              pointid: '1059',
              lineid: '38',
              passingtimes: [{ destination: { fr: 'HOMBORCH' }, expectedArrivalTime: inMinutes(5), lineId: '38' }],
            },
          ],
        }),
        { status: 200 }
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.STIB_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env.STIB_API_KEY = originalKey;
  });

  it('is off without an API key', async () => {
    delete process.env.STIB_API_KEY;
    const res = await get('stop=1059&line=71');
    expect(res.status).toBe(503);
    expect((await res.json()).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the next departures of one line, sending the key', async () => {
    const res = await get('stop=1059&line=71');
    const body = await res.json();
    expect(body.departures.map((d: { line: string }) => d.line)).toEqual(['71', '71']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get('where')).toBe('pointid="1059"');
    expect(init.headers.Authorization).toBe('Apikey test-key');
  });

  it('serves every line at a stop from one cached upstream request', async () => {
    await get('stop=1060&line=71');
    const res = await get('stop=1060&line=38');
    expect((await res.json()).departures).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('validates its input', async () => {
    expect((await get('stop=abc')).status).toBe(400);
    expect((await get('stop=1059&line=71;drop')).status).toBe(400);
  });
});
