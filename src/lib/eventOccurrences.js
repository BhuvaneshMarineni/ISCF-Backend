const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function startOfUtcDay(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(value) {
  const date = startOfUtcDay(value);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCMilliseconds(-1);
  return date;
}

function calculateTimeStatus(start, end, now = new Date()) {
  if (now < start) return 'UPCOMING';
  if (now > end) return 'PAST';
  return 'ONGOING';
}

function occurrenceTimes(event, occurrenceDate) {
  if (!event.startTime && !event.endTime) {
    return { start: startOfUtcDay(occurrenceDate), end: endOfUtcDay(occurrenceDate) };
  }
  const sourceStart = event.startTime || event.eventDate;
  const sourceEnd = event.endTime || sourceStart;
  const start = new Date(occurrenceDate);
  start.setUTCHours(
    sourceStart.getUTCHours(),
    sourceStart.getUTCMinutes(),
    sourceStart.getUTCSeconds(),
    sourceStart.getUTCMilliseconds()
  );
  const end = new Date(occurrenceDate);
  end.setUTCHours(
    sourceEnd.getUTCHours(),
    sourceEnd.getUTCMinutes(),
    sourceEnd.getUTCSeconds(),
    sourceEnd.getUTCMilliseconds()
  );
  if (end < start) end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function matchesRecurrence(event, date, anchor) {
  if (event.recurrenceType === 'DAILY') return true;
  if (event.recurrenceType === 'WEEKLY') {
    return event.recurrenceDays.includes(DAY_NAMES[date.getUTCDay()]);
  }
  if (event.recurrenceType === 'MONTHLY') {
    return date.getUTCDate() === anchor.getUTCDate();
  }
  return date.getTime() === anchor.getTime();
}

function expandEventOccurrences(event, from, to, now = new Date()) {
  const anchorSource = event.eventDate || event.startTime;
  if (!anchorSource) return [];
  const anchor = startOfUtcDay(anchorSource);
  const rangeStart = from ? startOfUtcDay(from) : anchor;
  const rangeEnd = to ? endOfUtcDay(to) : endOfUtcDay(anchor);
  const recurrenceEnd = event.recurrenceEndDate ? endOfUtcDay(event.recurrenceEndDate) : null;
  const effectiveEnd = recurrenceEnd && recurrenceEnd < rangeEnd ? recurrenceEnd : rangeEnd;
  const occurrences = [];

  if (event.recurrenceType === 'NONE') {
    if (anchor >= rangeStart && anchor <= effectiveEnd) {
      const { start, end } = occurrenceTimes(event, anchor);
      occurrences.push({ occurrenceDate: anchor, startTime: event.startTime ? start : null, endTime: event.endTime ? end : null, timeStatus: calculateTimeStatus(start, end, now) });
    }
    return occurrences;
  }

  for (const date = new Date(rangeStart); date <= effectiveEnd; date.setUTCDate(date.getUTCDate() + 1)) {
    if (matchesRecurrence(event, date, anchor)) {
      const occurrenceDate = new Date(date);
      const { start, end } = occurrenceTimes(event, occurrenceDate);
      occurrences.push({ occurrenceDate, startTime: event.startTime ? start : null, endTime: event.endTime ? end : null, timeStatus: calculateTimeStatus(start, end, now) });
    }
  }
  return occurrences;
}

module.exports = { calculateTimeStatus, expandEventOccurrences };
