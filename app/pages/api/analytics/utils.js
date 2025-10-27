import { subMonths } from 'date-fns';

/**
 * Normalises start/end date range based on query params.
 * Falls back to last `months` months when explicit dates are not provided.
 */
export function resolveDateRange({ startDate, endDate, months = 3 }) {
  let start;
  let end;

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else {
    end = new Date();
    start = subMonths(end, parseInt(months, 10));
  }

  return { start, end };
}
