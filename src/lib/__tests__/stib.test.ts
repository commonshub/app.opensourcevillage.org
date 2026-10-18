/**
 * Tests for STIB-MIVB waiting-time parsing
 */

import { isStibAgency, stibStopId, parseWaitingTimes } from '../stib';

describe('isStibAgency', () => {
  it('recognises STIB in either language', () => {
    expect(isStibAgency('STIB-MIVB')).toBe(true);
    expect(isStibAgency('MIVB')).toBe(true);
    expect(isStibAgency('De Lijn')).toBe(false);
    expect(isStibAgency(undefined)).toBe(false);
  });
});

describe('stibStopId', () => {
  it('drops feed prefixes and platform letters', () => {
    expect(stibStopId('be-stib_1059F')).toBe('1059');
    expect(stibStopId('stib:5719')).toBe('5719');
    expect(stibStopId('8032')).toBe('8032');
  });

  it('gives up on ids that are not STIB stop numbers', () => {
    expect(stibStopId('be-sncb_x8814001')).toBeNull();
    expect(stibStopId(undefined)).toBeNull();
  });
});

describe('parseWaitingTimes', () => {
  it('reads Opendatasoft records with passing times as a JSON string', () => {
    const body = {
      results: [
        {
          pointid: '1059',
          lineid: '71',
          passingtimes: JSON.stringify([
            { destination: { fr: 'DELTA', nl: 'DELTA' }, expectedArrivalTime: '2027-01-30T09:11:00+01:00', lineId: '71' },
            { destination: { fr: 'DELTA', nl: 'DELTA' }, expectedArrivalTime: '2027-01-30T09:03:00+01:00', lineId: '71' },
          ]),
        },
        {
          pointid: '1059',
          lineid: '38',
          passingtimes: [{ destination: { fr: 'HOMBORCH' }, expectedArrivalTime: '2027-01-30T09:05:00+01:00', lineId: '38' }],
        },
      ],
    };
    expect(parseWaitingTimes(body, '71')).toEqual([
      { line: '71', destination: 'DELTA', expected: '2027-01-30T08:03:00.000Z', message: undefined },
      { line: '71', destination: 'DELTA', expected: '2027-01-30T08:11:00.000Z', message: undefined },
    ]);
    expect(parseWaitingTimes(body)).toHaveLength(3);
  });

  it('reads the older camelCase shape', () => {
    const body = {
      points: [
        {
          pointId: '8032',
          passingTimes: [{ destination: { fr: 'STOCKEL', nl: 'STOKKEL' }, expectedArrivalTime: '2027-01-30T09:00:00+01:00', lineId: 1 }],
        },
      ],
    };
    expect(parseWaitingTimes(body, '1')[0].destination).toBe('STOCKEL');
  });

  it('returns nothing for answers it does not understand', () => {
    expect(parseWaitingTimes(null)).toEqual([]);
    expect(parseWaitingTimes({ results: [{ passingtimes: 'not json' }] })).toEqual([]);
    expect(parseWaitingTimes({ results: [{ passingtimes: [{ lineId: '71' }] }] })).toEqual([]);
  });
});
