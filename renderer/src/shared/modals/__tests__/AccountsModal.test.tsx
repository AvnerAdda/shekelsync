import { describe, it, expect, vi, afterEach } from 'vitest';
import { startOfMonth, subMonths } from 'date-fns';
import {
  getBankingAccountValidationError,
  buildInitialSyncPayload,
  type Account,
} from '@renderer/shared/modals/AccountsModal';
import type { InstitutionMetadata } from '@renderer/shared/components/InstitutionBadge';

const baseAccount: Account = {
  id: 0,
  vendor: 'isracard',
  password: 'secret',
  nickname: 'My Card',
  id_number: '123456789',
  created_at: new Date().toISOString(),
} as Account;

const buildInstitution = (vendor: string, fields: string[]): InstitutionMetadata & { credentialFieldList: string[] } => ({
  id: 1,
  vendor_code: vendor,
  display_name_en: vendor,
  display_name_he: vendor,
  institution_type: 'bank',
  credentialFieldList: fields,
});

describe('getBankingAccountValidationError', () => {
  it('requires credential fields defined by institution', () => {
    const institution = buildInstitution('visaCal', ['username', 'password']);
    const result = getBankingAccountValidationError(
      { ...baseAccount, vendor: 'visaCal', username: '' },
      institution,
    );
    expect(result).toBe('Username is required for visaCal');
  });

  it('requires password and nickname for all vendors', () => {
    const result = getBankingAccountValidationError(
      {
        ...baseAccount,
        password: '',
        nickname: '',
      },
      buildInstitution('isracard', ['password']),
    );
    expect(result).toBe('Password is required');
  });

  it('falls back to general validation when no institution metadata', () => {
    const result = getBankingAccountValidationError({
      ...baseAccount,
      vendor: 'legacyVendor',
      username: '',
    });
    expect(result).toBe('Username is required');
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
      id: 42,
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
      dbId: 42,
      fromSavedCredential: true,
    });
  });
});
