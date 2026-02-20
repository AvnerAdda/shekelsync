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
  delete process.env.SQLITE_DB_PATH;
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

  it('grants demo bronze AI access for anonymized demo DB even when supporter status is pending', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return { data: [], error: null };
        }
        if (call.table === 'supporter_intents') {
          return {
            data: [
              {
                user_id: 'demo-user',
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
      env: { SQLITE_DB_PATH: '/tmp/clarify-anonymized.sqlite' },
    });

    const status = await service.getDonationStatus({ userId: 'demo-user' });

    expect(status.supportStatus).toBe('verified');
    expect(status.hasDonated).toBe(true);
    expect(status.tier).toBe('bronze');
    expect(status.currentPlanKey).toBe('bronze');
    expect(status.hasPendingVerification).toBe(false);
    expect(status.pendingPlanKey).toBeNull();
    expect(status.canAccessAiAgent).toBe(true);
    expect(status.aiAgentAccessLevel).toBe('standard');
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

  it('falls back to session identity when token lookup fails', async () => {
    const supabaseMock = createSupabaseClientMock({
      onInsert: () => null,
      onGetUser: async () => ({ data: null, error: { message: 'invalid token' } }),
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return { data: [], error: null };
        }
        if (call.table === 'supporter_intents') {
          return {
            data: [
              {
                user_id: 'ctx-user',
                plan_key: 'silver',
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
      { planKey: 'silver' },
      { accessToken: 'invalid-token', userId: 'ctx-user', email: 'CTX@EXAMPLE.COM' },
    );

    expect(mock.auth.getUser).toHaveBeenCalledWith('invalid-token');
    expect(mock.insertCalls[0].payload.user_id).toBe('ctx-user');
    expect(mock.insertCalls[0].payload.email).toBe('ctx@example.com');
    expect(result.supportStatus).toBe('pending');
    expect(result.pendingPlanKey).toBe('silver');
  });

  it('uses email fallback entitlement and derives plan-based amount and billing cycle', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements' && call.filters.user_id === 'user-100') {
          return { data: [], error: null };
        }
        if (call.table === 'supporter_entitlements' && call.filters.email === 'mail@example.com') {
          return {
            data: [
              {
                user_id: null,
                email: 'mail@example.com',
                tier: 'silver',
                plan: 'silver',
                verification_status: 'verified',
                amount_usd: '0',
                billing_cycle: 'unexpected',
                updated_at: '2026-02-10T00:00:00.000Z',
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

    const { service } = await setupDonationsService({ supabaseMock });

    const status = await service.getDonationStatus({ userId: 'user-100', email: 'MAIL@EXAMPLE.COM' });

    expect(status.supportStatus).toBe('verified');
    expect(status.tier).toBe('silver');
    expect(status.currentPlanKey).toBe('silver');
    expect(status.totalAmountUsd).toBe(10);
    expect(status.billingCycle).toBe('monthly');
    expect(status.canAccessAiAgent).toBe(true);
    expect(status.aiAgentAccessLevel).toBe('extended');
  });

  it('returns rejected support status and default donation url when configured url is invalid', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return {
            data: [
              {
                user_id: 'declined-user',
                tier: 'gold',
                plan_key: 'gold',
                status: 'declined',
                amount_usd: '20',
                updated_at: '2026-02-10T00:00:00.000Z',
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

    const { service } = await setupDonationsService({
      supabaseMock,
      env: { DONATION_URL: 'not-a-valid-url' },
    });

    const status = await service.getDonationStatus({ userId: 'declined-user' });

    expect(status.supportStatus).toBe('rejected');
    expect(status.tier).toBe('none');
    expect(status.hasDonated).toBe(false);
    expect(status.shouldShowMonthlyReminder).toBe(true);
    expect(status.donationUrl).toBe(service.DEFAULT_DONATION_URL);
  });

  it('supports custom intents table and falls back invalid entitlement table config', async () => {
    const supabaseMock = createSupabaseClientMock({
      onInsert: () => null,
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return { data: [], error: null };
        }
        if (call.table === 'custom_intents') {
          return {
            data: [
              {
                user_id: 'custom-user',
                plan_key: 'bronze',
                status: 'clicked',
                updated_at: '2026-02-11T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    const { service, supabaseMock: mock } = await setupDonationsService({
      supabaseMock,
      env: {
        SUPABASE_SUPPORTER_ENTITLEMENTS_TABLE: '123bad',
        SUPABASE_SUPPORTER_INTENTS_TABLE: 'custom_intents',
      },
    });

    const result = await service.createSupportIntent({ planKey: 'bronze' }, { userId: 'custom-user' });

    expect(mock.insertCalls[0].table).toBe('custom_intents');
    expect(mock.selectCalls.some((call) => call.table === 'supporter_entitlements')).toBe(true);
    expect(mock.selectCalls.some((call) => call.table === 'custom_intents')).toBe(true);
    expect(result.supportStatus).toBe('pending');
    expect(result.pendingPlanKey).toBe('bronze');
  });

  it('uses current month when reminder month key is omitted', async () => {
    const supabaseMock = createSupabaseClientMock({});
    const { service } = await setupDonationsService({ supabaseMock });

    const status = await service.markMonthlyReminderShown({});

    expect(status.reminderShownThisMonth).toBe(true);
    expect(status.shouldShowMonthlyReminder).toBe(false);
  });

  it('maps active entitlement status to verified and falls back negative amount to plan amount', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return {
            data: [
              {
                user_id: 'active-user',
                tier: 'gold',
                plan_key: 'gold',
                status: 'active',
                amount_usd: '-5',
                billing_cycle: 'unexpected',
                updated_at: '2026-02-10T00:00:00.000Z',
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

    const { service } = await setupDonationsService({ supabaseMock });

    const status = await service.getDonationStatus({ userId: 'active-user' });

    expect(status.supportStatus).toBe('verified');
    expect(status.tier).toBe('gold');
    expect(status.totalAmountUsd).toBe(20);
    expect(status.billingCycle).toBe('monthly');
    expect(status.canAccessAiAgent).toBe(true);
    expect(status.aiAgentAccessLevel).toBe('unlimited');
  });

  it('keeps declined entitlement rejected even when an intent row exists', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          return {
            data: [
              {
                user_id: 'declined-pending-user',
                tier: 'gold',
                plan_key: 'gold',
                status: 'declined',
                amount_usd: '20',
                updated_at: '2026-02-10T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        if (call.table === 'supporter_intents') {
          return {
            data: [
              {
                user_id: 'declined-pending-user',
                plan_key: 'silver',
                status: 'clicked',
                updated_at: '2026-02-11T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    const { service } = await setupDonationsService({ supabaseMock });

    const status = await service.getDonationStatus({ userId: 'declined-pending-user' });

    expect(status.supportStatus).toBe('rejected');
    expect(status.hasPendingVerification).toBe(false);
    expect(status.pendingPlanKey).toBeNull();
    expect(status.tier).toBe('none');
    expect(status.hasDonated).toBe(false);
  });

  it('throws non-supabase-query errors from entitlement lookup', async () => {
    const supabaseMock = createSupabaseClientMock({
      onSelect: (call) => {
        if (call.table === 'supporter_entitlements') {
          throw new Error('unexpected select failure');
        }
        return { data: [], error: null };
      },
    });

    const { service } = await setupDonationsService({ supabaseMock });

    await expect(service.getDonationStatus({ userId: 'u-1' })).rejects.toThrow('unexpected select failure');
  });

  it('builds supabase clients from env using injected createClient and reuses cached client', async () => {
    vi.resetModules();

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPPORTER_REQUIRE_AUTH = 'false';

    const release = vi.fn();
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.startsWith('create table') || text.startsWith('create index')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('insert into donation_meta')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('select last_reminder_month_key')) {
        return { rows: [{ last_reminder_month_key: null }], rowCount: 1 };
      }
      if (text.includes('select coalesce(sum(amount_ils), 0) as total_amount_ils')) {
        return { rows: [{ total_amount_ils: '0' }], rowCount: 1 };
      }
      if (text.includes('insert into donation_events')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const getClient = vi.fn(async () => ({ query, release }));

    const createClient = vi.fn((_url: string, _key: string) => ({
      from: (_table: string) => ({
        insert: async () => ({ error: null }),
        select: () => {
          const chain = {
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: async () => ({ data: [], error: null }),
          };
          return chain;
        },
      }),
      auth: {
        getUser: vi.fn(async () => ({ data: null, error: { message: 'not used' } })),
      },
    }));

    const module = await import('../donations.js');
    const service = module.default ?? module;
    service.__setDatabase({ getClient });
    service.__setSupabaseClients({ createClient });

    const first = await service.createSupportIntent({ planKey: 'bronze' }, { userId: 'cached-user' });
    const second = await service.getDonationStatus({ userId: 'cached-user' });

    expect(first.supportStatus).toBe('none');
    expect(first.pendingPlanKey).toBeNull();
    expect(first.checkoutUrl).toContain('plan=bronze');
    expect(second.supportStatus).toBe('none');
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-role-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
        }),
      }),
    );
  });

  it('returns SUPABASE_NOT_CONFIGURED when injected createClient throws', async () => {
    vi.resetModules();

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPPORTER_REQUIRE_AUTH = 'false';

    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.startsWith('create table') || text.startsWith('create index')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('insert into donation_meta')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('select last_reminder_month_key')) {
        return { rows: [{ last_reminder_month_key: null }], rowCount: 1 };
      }
      if (text.includes('select coalesce(sum(amount_ils), 0) as total_amount_ils')) {
        return { rows: [{ total_amount_ils: '0' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const getClient = vi.fn(async () => ({ query, release }));

    const module = await import('../donations.js');
    const service = module.default ?? module;
    service.__setDatabase({ getClient });
    service.__setSupabaseClients({
      createClient: () => {
        throw new Error('create client boom');
      },
    });

    await expect(service.createSupportIntent({ planKey: 'bronze' }, { userId: 'u-2' })).rejects.toMatchObject({
      status: 503,
      code: 'SUPABASE_NOT_CONFIGURED',
    });
  });
});
