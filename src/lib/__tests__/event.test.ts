/**
 * Tests for edition details derived from settings.json
 */

import fs from 'fs';
import path from 'path';
import { EVENT, formatEventDateRange } from '../event';

describe('formatEventDateRange', () => {
  it('formats a range within one year', () => {
    expect(formatEventDateRange('2027-01-25', '2027-02-05')).toBe('Jan 25 - Feb 5, 2027');
  });

  it('shows both years when the range crosses a year boundary', () => {
    expect(formatEventDateRange('2027-12-30', '2028-01-02')).toBe('Dec 30, 2027 - Jan 2, 2028');
  });
});

describe('EVENT', () => {
  it('names the same year as its start date', () => {
    expect(EVENT.name).toContain(String(EVENT.year));
  });

  it('ends on or after it starts', () => {
    expect(EVENT.dates.end >= EVENT.dates.start).toBe(true);
  });
});

describe('pages and components', () => {
  const roots = ['src/app', 'src/components'].map((dir) => path.join(process.cwd(), dir));

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it('do not hard-code an edition year (read it from settings.json via src/lib/event)', () => {
    const offenders = roots.flatMap(sourceFiles).flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), at: `${path.relative(process.cwd(), file)}:${i + 1}` }))
        .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'))
        .filter(({ line }) => /\b20(2[6-9]|[3-9]\d)\b/.test(line))
        .map(({ at, line }) => `${at}: ${line}`)
    );
    expect(offenders).toEqual([]);
  });
});
