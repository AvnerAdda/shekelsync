'use strict';

// Calendar helpers for the mortgage engine. Every date is a 'YYYY-MM-DD'
// string interpreted as a UTC calendar day; month arithmetic uses integer
// month indexes so local time zones never shift a payment date.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseIsoDate(value) {
  const match = ISO_DATE.exec(String(value || ''));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function isIsoDate(value) {
  return parseIsoDate(value) !== null;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatIsoDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthIndex(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error(`Invalid date: ${value}`);
  return parsed.y * 12 + (parsed.m - 1);
}

function monthKey(value) {
  return String(value).slice(0, 7);
}

/** Add `months` to a date, pinning the day to `day` (default: the date's own day) and clamping to month length. */
function addMonths(value, months, day) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error(`Invalid date: ${value}`);
  const index = parsed.y * 12 + (parsed.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index - y * 12) + 1;
  const targetDay = Math.min(day || parsed.d, daysInMonth(y, m));
  return formatIsoDate(y, m, targetDay);
}

function dayNumber(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error(`Invalid date: ${value}`);
  return Date.UTC(parsed.y, parsed.m - 1, parsed.d) / 86_400_000;
}

function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

function monthsBetween(from, to) {
  return monthIndex(to) - monthIndex(from);
}

function endOfMonth(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error(`Invalid date: ${value}`);
  return formatIsoDate(parsed.y, parsed.m, daysInMonth(parsed.y, parsed.m));
}

function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

module.exports = {
  addMonths,
  dayNumber,
  daysBetween,
  daysInMonth,
  endOfMonth,
  formatIsoDate,
  isIsoDate,
  monthIndex,
  monthKey,
  monthsBetween,
  parseIsoDate,
  todayIso,
};
