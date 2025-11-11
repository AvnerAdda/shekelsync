import { describe, it, expect, vi, afterEach } from 'vitest';
import { startOfMonth, subMonths } from 'date-fns';
import {
  getBankingAccountValidationError,
  buildInitialSyncPayload,
  type Account,
} from '../AccountsModal';
import { SPECIAL_BANK_VENDORS } from '@app/utils/constants';

const baseAccount: Account = {
  id: 0,
  vendor: 'isracard',
  password: 'secret',
  nickname: 'My Card',
  id_number: '123456789',
  created_at: new Date().toISOString(),
} as Account;

describe('getBankingAccountValidationError', () => {
  it('requires username for Visa Cal', () => {
    const result = getBankingAccountValidationError({ ...baseAccount, vendor: 'visaCal', username: '' });
    expect(result).toBe('Username is required for Visa Cal and Max');
  });

  it('requires identification code for Discount bank vendors', () => {
    const result = getBankingAccountValidationError({
      ...baseAccount,
      vendor: SPECIAL_BANK_VENDORS[0],
      id_number: '123123123',
      num: '',
      identification_code: '',
    });
    expect(result).toBe('Identification code (num) is required for Discount and Mercantile');
  });

  it('requires password and nickname for all vendors', () => {
    const result = getBankingAccountValidationError({
      ...baseAccount,
      password: '',
      nickname: '',
    });
    expect(result).toBe('Password is required');
  });
});

describe('buildInitialSyncPayload', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a scrape payload with normalized start date and credentials', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

    const payload = buildInitialSyncPayload({
      ...baseAccount,
      vendor: 'oneZero',
      username: 'test-user',
      userCode: '9999',
      card6_digits: '123456',
      num: 'ABC123',
      nationalID: '999',
      email: 'user@example.com',
      identification_code: 'CODE',
    });

    expect(payload.options.companyId).toBe('oneZero');
    const startDate = new Date(payload.options.startDate);
    const expectedStart = startOfMonth(subMonths(new Date('2025-01-15T12:00:00Z'), 3));
    expect(startDate.toISOString()).toBe(expectedStart.toISOString());

    expect(payload.credentials).toMatchObject({
      id: '123456789',
      password: 'secret',
      username: 'test-user',
      userCode: '9999',
      email: 'user@example.com',
      card6Digits: '123456',
      num: 'ABC123',
      nationalID: '999',
      identification_code: 'CODE',
      nickname: 'My Card',
    });
  });
});
