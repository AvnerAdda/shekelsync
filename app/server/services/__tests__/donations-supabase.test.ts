import { afterEach, describe, expect, it, vi } from 'vitest';

interface SupabaseSelectCall {
  table: string;
  filters: Record<string, unknown>;
  inClause: { column: string; values: unknown[] } | null;
  limit: number;
}

function createSupabaseClientMock(options: {
  onInsert?: (table: string, payload: Record<string, unknown>) => { message: string } | null;
  onSelect?: (call: SupabaseSelectCall) => { data: any[] | null; error: { message: string } | null };
  onGetUser?: (token: string) => Promise<{ data: any; error: any }>;
} = {}) {
  const insertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const selectCalls: SupabaseSelectCall[] = [];

  const from = vi.fn((table: string) => {
    const state = {
      filters: {} as Record<string, unknown>,
      inClause: null as { column: string; values: unknown[] } | null,
    };

    return {
      async insert(payload: Record<string, unknown>) {
        insertCalls.push({ table, payload });
        return { error: options.onInsert?.(table, payload) ?? null };
      },
      select() {
        return this;
      },
      eq(column: string, value: unknown) {
        state.filters[column] = value;
        return this;
      },
      in(column: string, values: unknown[]) {
        state.inClause = { column, values };
        return this;
      },
      order() {
        return this;
      },
      async limit(limit: number) {
        const call: SupabaseSelectCall = {
          table,
          filters: { ...state.filters },
          inClause: state.inClause,
          limit,
        };
        selectCalls.push(call);
        const result = options.onSelect?.(call) ?? { data: [], error: null };
        return result;
      },
    };
  });

  const auth = {
    getUser: vi.fn(async (token: string) => {
      if (options.onGetUser) {
        return options.onGetUser(token);
      }
      return { data: null, error: { message: 'not configured' } };
    }),
  };

  return {
    client: { from, auth },
    insertCalls,
    selectCalls,
    auth,
  };
}

async function setupDonationsService({
  supabaseMock,
  dbState,
  env,
}: {
  supabaseMock: ReturnType<typeof createSupabaseClientMock>;
  dbState?: { total?: number; reminderMonthKey?: string | null };
  env?: Record<string, string | undefined>;
}) {
  vi.resetModules();

  const state = {
    total: dbState?.total ?? 0,
    reminderMonthKey: dbState?.reminderMonthKey ?? null,
  };

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPPORTER_REQUIRE_AUTH = 'false';
  delete process.env.DONATION_URL;

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  const release = vi.fn();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

    if (text.startsWith('create table') || text.startsWith('create index')) {
      return { rows: [], rowCount: 0 };
    }

    if (text.includes('insert into donation_meta')) {
      const monthKey = params?.[0];
      if (typeof monthKey === 'string') {
        state.reminderMonthKey = monthKey;
      }
      return { rows: [], rowCount: 1 };
    }

    if (text.includes('select last_reminder_month_key')) {
      return { rows: [{ last_reminder_month_key: state.reminderMonthKey }], rowCount: 1 };
    }

    if (text.includes('select coalesce(sum(amount_ils), 0) as total_amount_ils')) {
      return { rows: [{ total_amount_ils: String(state.total) }], rowCount: 1 };
    }

    if (text.includes('insert into donation_events')) {
      const amount = Number(params?.[0] ?? 0);
      state.total = Math.round((state.total + amount) * 100) / 100;
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });

  const getClient = vi.fn(async () => ({ query, release }));

  const module = await import('../donations.js');
  const service = module.default ?? module;
  service.__setDatabase({ getClient });
  service.__setSupabaseClients({
    adminClient: supabaseMock.client,
    authClient: supabaseMock.client,
  });

  return {
    service,
    query,
    release,
    getClient,
    state,
    supabaseMock,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPPORTER_REQUIRE_AUTH;
  delete process.env.DONATION_URL;
});

describe('donations service supabase flows', () => {
  it('maps missing intents table errors to SUPABASE_SCHEMA_MISSING', async () => {
    const supabaseMock = createSupabaseClientMock({
      onInsert: () => ({ message: 'Could not find the table public.supporter_intents in schema cache' }),
    });
    const { service } = await setupDonationsService({ supabaseMock });

    await expect(service.createSupportIntent({ planKey: 'bronze' })).rejects.toMatchObject({
      status: 503,
      code: 'SUPABASE_SCHEMA_MISSING',
    });
  });

  it('maps generic insert failures to SUPABASE_WRITE_FAILED', async () => {
    const supabaseMock = createSupabaseClientMock({
      onInsert: () => ({ message: 'permission denied' }),
    });
    const { service } = await setupDonationsService({ supabaseMock });

    await expect(service.createSupportIntent({ planKey: 'silver' })).rejects.toMatchObject({
      status: 502,
      code: 'SUPABASE_WRITE_FAILED',
      message: 'Failed to record support intent: permission denied',
    });
  });

  it('creates support intent and returns verified supporter status with checkout url', async () => {
    const supabaseMock = createSupabaseClientMock({
      onInsert: () => null,
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements' && call.filters.user_id === 'user-1') {
          return {
            data: [
              {
                user_id: 'user-1',
                email: 'user@example.com',
                tier: 'gold',
                plan_key: 'gold',
                status: 'active',
                amount_usd: '20',
                billing_cycle: 'monthly',
                updated_at: '2026-02-09T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        if (call.table === 'supporter_intents') {
          return { data: [], error: null };
        }
        return { data: [], error: null };
      },
    });

    const { service, supabaseMock: mock } = await setupDonationsService({ supabaseMock });

    const result = await service.createSupportIntent(
      {
        planKey: 'gold',
        source: '  desktop_menu ',
        note: '  thank you  ',
      },
      {
        userId: 'user-1',
        email: 'USER@EXAMPLE.COM',
      },
    );

    expect(result.supportStatus).toBe('verified');
    expect(result.tier).toBe('gold');
    expect(result.canAccessAiAgent).toBe(true);
    expect(result.aiAgentAccessLevel).toBe('unlimited');
    expect(result.shouldShowMonthlyReminder).toBe(false);
    expect(result.checkoutUrl).toContain('plan=gold');
    expect(result.checkoutUrl).toContain('utm_source=shekelsync');

    expect(mock.insertCalls).toHaveLength(1);
    expect(mock.insertCalls[0].payload.source).toBe('desktop_menu');
    expect(mock.insertCalls[0].payload.note).toBe('thank you');
    expect(mock.insertCalls[0].payload.email).toBe('user@example.com');
  });

  it('falls back to legacy local donation snapshot when entitlement lookup fails', async () => {
    const supabaseMock = createSupabaseClientMock({
      onInsert: () => null,
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return { data: null, error: { message: 'network failure' } };
        }
        return { data: [], error: null };
      },
    });

    const { service } = await setupDonationsService({
      supabaseMock,
      dbState: { total: 120, reminderMonthKey: null },
    });

    const status = await service.getDonationStatus({ userId: 'abc-1', email: 'a@b.com' });

    expect(status.supportStatus).toBe('verified');
    expect(status.tier).toBe('one_time');
    expect(status.totalAmountUsd).toBe(120);
    expect(status.currentPlanKey).toBe('one_time');
  });

  it('returns pending status from support intent when entitlement is not verified', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return { data: [], error: null };
        }
        if (call.table === 'supporter_intents') {
          return {
            data: [
              {
                user_id: 'abc-1',
                plan_key: 'bronze',
                status: 'pending',
                updated_at: '2026-02-09T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    const { service } = await setupDonationsService({
      supabaseMock,
      dbState: { total: 0, reminderMonthKey: null },
    });

    const status = await service.getDonationStatus({ userId: 'abc-1' });

    expect(status.supportStatus).toBe('pending');
    expect(status.hasPendingVerification).toBe(true);
    expect(status.pendingPlanKey).toBe('bronze');
    expect(status.tier).toBe('none');
    expect(status.shouldShowMonthlyReminder).toBe(false);
  });

  it('uses legacy anonymous fallback when authenticated identity is required but missing', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: () => ({ data: [], error: null }),
    });

    const { service, supabaseMock: mock } = await setupDonationsService({
      supabaseMock,
      env: { SUPPORTER_REQUIRE_AUTH: 'true' },
      dbState: { total: 0 },
    });

    const status = await service.getDonationStatus();

    expect(status.supportStatus).toBe('none');
    expect(status.hasDonated).toBe(false);
    expect(status.shouldShowMonthlyReminder).toBe(true);
    expect(mock.selectCalls).toHaveLength(0);
  });

  it('validates month key input when marking reminder', async () => {
    const supabaseMock = createSupabaseClientMock({});
    const { service } = await setupDonationsService({ supabaseMock });

    await expect(service.markMonthlyReminderShown({ monthKey: 202602 as any })).rejects.toMatchObject({
      status: 400,
      message: 'monthKey must be a string in YYYY-MM format',
    });

    await expect(service.markMonthlyReminderShown({ monthKey: '2026-13' })).rejects.toMatchObject({
      status: 400,
      message: 'monthKey must be in YYYY-MM format',
    });
  });

  it('resolves identity from access token via Supabase auth getUser', async () => {
    const supabaseMock = createSupabaseClientMock({
      onInsert: () => null,
      onGetUser: async () => ({
        data: {
          user: {
            id: 'token-user',
            email: 'token.user@example.com',
            user_metadata: { full_name: 'Token User' },
          },
        },
        error: null,
      }),
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return { data: [], error: null };
        }
        if (call.table === 'supporter_intents') {
          return {
            data: [
              {
                user_id: 'token-user',
                plan_key: 'bronze',
                status: 'pending',
                updated_at: '2026-02-09T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    const { service, supabaseMock: mock } = await setupDonationsService({ supabaseMock });

    const result = await service.createSupportIntent(
      { planKey: 'bronze' },
      { accessToken: 'token-abc' },
    );

    expect(mock.auth.getUser).toHaveBeenCalledWith('token-abc');
    expect(mock.insertCalls[0].payload.user_id).toBe('token-user');
    expect(result.supportStatus).toBe('pending');
    expect(result.pendingPlanKey).toBe('bronze');
  });

  it('delegates addDonationEvent with planKey to support-intent validation', async () => {
    const supabaseMock = createSupabaseClientMock({});
    const { service } = await setupDonationsService({ supabaseMock });

    await expect(service.addDonationEvent({ planKey: 'invalid-plan' } as any)).rejects.toMatchObject({
      status: 400,
      message: 'planKey must be one of: one_time, bronze, silver, gold, lifetime',
    });

    expect(service.getDonationTier(49)).toBe('none');
    expect(service.getDonationTier(50)).toBe('bronze');
    expect(service.getDonationTier(150)).toBe('silver');
    expect(service.getDonationTier(500)).toBe('gold');
  });
});
