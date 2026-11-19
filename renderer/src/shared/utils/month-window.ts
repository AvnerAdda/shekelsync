import { addDays, addMonths, startOfDay, subMonths } from 'date-fns';

/**
 * First day of a trailing window of `months` calendar months ending today
 * (inclusive). 18 Nov with one month starts on 19 Oct. date-fns clamps month
 * ends, so 31 Mar starts on 1 Mar.
 */
export function startOfTrailingMonths(now: Date, months = 1): Date {
  return startOfDay(addDays(subMonths(now, months), 1));
}

/** The same calendar day `months` months ahead (18 Nov → 18 Dec). */
export function monthsAhead(now: Date, months = 1): Date {
  return addMonths(now, months);
}
