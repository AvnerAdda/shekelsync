import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../donations.js');

const queryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();

let donationsService: any;

function createQueryHandler(state: { total: number; reminderMonthKey: string | null }) {
  return async (sql: string, params: unknown[] = []) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('create table') || normalized.startsWith('create index')) {
      return { rows: [], rowCount: 0 };
    }

    if (normalized.includes('insert into donation_events')) {
      const amount = Number(params?.[0] ?? 0);
      state.total = Math.round((state.total + amount) * 100) / 100;
      return { rows: [], rowCount: 1 };
    }

    if (normalized.includes('insert into donation_meta')) {
      if (Array.isArray(params) && params.length > 0) {
        const monthKey = params[0];
        state.reminderMonthKey = typeof monthKey === 'string' ? monthKey : null;
      }
      return { rows: [], rowCount: 1 };
    }

    if (normalized.includes('select coalesce(sum(amount_ils), 0) as total_amount_ils')) {
      return {
        rows: [{ total_amount_ils: String(state.total) }],
        rowCount: 1,
      };
    }

    if (normalized.includes('select last_reminder_month_key')) {
      return {
        rows: [{ last_reminder_month_key: state.reminderMonthKey }],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  };
}

beforeAll(async () => {
  const module = await modulePromise;
  donationsService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  releaseMock.mockReset();
  getClientMock.mockReset();

  const state = {
    total: 0,
    reminderMonthKey: null,
  };

  queryMock.mockImplementation(createQueryHandler(state));
  getClientMock.mockResolvedValue({ query: queryMock, release: releaseMock });

  donationsService.__setDatabase?.({
    getClient: getClientMock,
  });

  delete process.env.DONATION_URL;
});

afterEach(() => {
  donationsService.__resetDatabase?.();
  delete process.env.DONATION_URL;
  delete process.env.SUPPORTER_REQUIRE_AUTH;
  delete process.env.SQLITE_DB_PATH;
});

describe('donations service', () => {
  it('returns non-donor status by default', async () => {
    const result = await donationsService.getDonationStatus();

    expect(result.hasDonated).toBe(false);
    expect(result.totalAmountUsd).toBe(0);
    expect(result.tier).toBe('none');
    expect(result.supportStatus).toBe('none');
    expect(result.canAccessAiAgent).toBe(false);
    expect(result.reminderShownThisMonth).toBe(false);
    expect(result.shouldShowMonthlyReminder).toBe(true);
    expect(result.currentMonthKey).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    expect(result.donationUrl).toContain('https://buymeacoffee.com/shekelsync');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('grants demo supporter AI access when running against anonymized demo DB', async () => {
    process.env.SQLITE_DB_PATH = '/tmp/clarify-anonymized.sqlite';

    const result = await donationsService.getDonationStatus();

    expect(result.hasDonated).toBe(true);
    expect(result.tier).toBe('one_time');
    expect(result.supportStatus).toBe('verified');
    expect(result.currentPlanKey).toBe('one_time');
    expect(result.canAccessAiAgent).toBe(true);
    expect(result.aiAgentAccessLevel).toBe('standard');
    expect(result.shouldShowMonthlyReminder).toBe(false);
  });

  it('records local donations and grants AI access', async () => {
    const support = await donationsService.addDonationEvent({ amount: 12.5, note: 'First support' });

    expect(support.totalAmountUsd).toBe(12.5);
    expect(support.tier).toBe('one_time');
    expect(support.supportStatus).toBe('verified');
    expect(support.canAccessAiAgent).toBe(true);
    expect(support.shouldShowMonthlyReminder).toBe(false);
  });

  it('marks monthly reminder as shown for a month key', async () => {
    const before = await donationsService.getDonationStatus();
    const after = await donationsService.markMonthlyReminderShown({
      monthKey: before.currentMonthKey,
    });

    expect(before.shouldShowMonthlyReminder).toBe(true);
    expect(after.reminderShownThisMonth).toBe(true);
    expect(after.shouldShowMonthlyReminder).toBe(false);
  });

  it('rejects invalid donation amounts', async () => {
    await expect(
      donationsService.addDonationEvent({ amount: 0 }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Donation amount must be a positive number',
    });
  });

  it('uses configured donation URL from env', async () => {
    process.env.DONATION_URL = 'https://donate.example.org';

    const status = await donationsService.getDonationStatus();

    expect(status.donationUrl).toContain('https://donate.example.org');
  });

  it('allows anonymous support intent path when auth is not required', async () => {
    await expect(
      donationsService.createSupportIntent({}),
    ).rejects.toMatchObject({
      status: 503,
      code: 'SUPABASE_NOT_CONFIGURED',
    });
  });

  it('can enforce signed-in identity for support intent via env flag', async () => {
    process.env.SUPPORTER_REQUIRE_AUTH = 'true';

    await expect(
      donationsService.createSupportIntent({}),
    ).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    });
  });

  it('requires supabase configuration to sync supporter entitlements', async () => {
    await expect(
      donationsService.syncSupporterEntitlement({
        userId: 'user-10',
        email: 'member@example.com',
        status: 'verified',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'SUPABASE_NOT_CONFIGURED',
    });
  });
});
