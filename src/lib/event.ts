/**
 * Edition details (name, year, dates) for the current Open Source Village.
 *
 * settings.json is the single source of truth: pages must read the event
 * name and dates from here instead of hard-coding them, so setting up the
 * next edition is a settings.json change only.
 */

import settings from '../../settings.json';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format two YYYY-MM-DD dates as a short range, e.g. "Jan 25 - Feb 5, 2027".
 * Parses the date parts directly so the result never shifts with the
 * viewer's timezone.
 */
export function formatEventDateRange(start: string, end: string): string {
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const startLabel = `${MONTHS[startMonth - 1]} ${startDay}`;
  const endLabel = `${MONTHS[endMonth - 1]} ${endDay}, ${endYear}`;
  if (startYear !== endYear) {
    return `${startLabel}, ${startYear} - ${endLabel}`;
  }
  return `${startLabel} - ${endLabel}`;
}

export const EVENT = {
  name: settings.eventName,
  year: Number(settings.eventDates.start.slice(0, 4)),
  dates: settings.eventDates,
  datesLabel: formatEventDateRange(settings.eventDates.start, settings.eventDates.end),
};
