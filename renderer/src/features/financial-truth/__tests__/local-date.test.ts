import { afterEach, describe, expect, it } from 'vitest';
import { toLocalDateInputValue } from '../local-date';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('financial correction local dates', () => {
  it('uses the local calendar day instead of the UTC day', () => {
    process.env.TZ = 'Asia/Jerusalem';

    expect(toLocalDateInputValue(new Date('2026-08-30T22:30:00.000Z'))).toBe('2026-08-31');
  });
});

