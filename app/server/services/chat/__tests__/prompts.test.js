const {
  TOOLS,
  SYSTEM_PROMPT_BASE,
  getSystemPrompt,
  getGreetingMessage,
  getErrorMessage,
} = require('../prompts.js');

describe('chat prompts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes expected tool definitions', () => {
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS).toHaveLength(2);
    expect(TOOLS[0]?.function?.name).toBe('execute_sql_query');
    expect(TOOLS[1]?.function?.name).toBe('execute_calculation');
  });

  it('builds system prompt with English fallback for unknown locale', () => {
    const prompt = getSystemPrompt(
      'de',
      'FINANCIAL CONTEXT',
      'SCHEMA BLOCK',
      {
        allowTransactionAccess: true,
        allowCategoryAccess: false,
        allowAnalyticsAccess: false,
      },
    );

    expect(prompt).toContain(SYSTEM_PROMPT_BASE.en);
    expect(prompt).toContain('CURRENT FINANCIAL DATA');
    expect(prompt).toContain('FINANCIAL CONTEXT');
    expect(prompt).toContain('SCHEMA BLOCK');
  });

  it('includes personalization guidance when profile details are available', () => {
    const prompt = getSystemPrompt(
      'en',
      'USER PROFILE:\n- Name: Dana',
      'SCHEMA BLOCK',
      {
        allowTransactionAccess: true,
        allowCategoryAccess: true,
        allowAnalyticsAccess: true,
      },
    );

    expect(prompt).toContain('If user profile details are available');
    expect(prompt).toContain('address the user by their name');
  });

  it('adds permission note when all permissions are disabled (en/he/fr)', () => {
    const perms = {
      allowTransactionAccess: false,
      allowCategoryAccess: false,
      allowAnalyticsAccess: false,
    };

    expect(getSystemPrompt('en', 'CTX', 'SCHEMA', perms)).toContain(
      'IMPORTANT NOTE: User has not enabled data access permissions',
    );
    expect(getSystemPrompt('he', 'CTX', 'SCHEMA', perms)).toContain(
      'הערה חשובה: המשתמש לא הפעיל הרשאות גישה לנתונים',
    );
    expect(getSystemPrompt('fr', 'CTX', 'SCHEMA', perms)).toContain(
      "NOTE IMPORTANTE: L'utilisateur n'a pas activé les permissions d'accès aux données",
    );
  });

  it('does not add permission note when at least one permission is enabled', () => {
    const prompt = getSystemPrompt(
      'en',
      'CTX',
      'SCHEMA',
      {
        allowTransactionAccess: true,
        allowCategoryAccess: false,
        allowAnalyticsAccess: false,
      },
    );

    expect(prompt).not.toContain('IMPORTANT NOTE: User has not enabled data access permissions');
  });

  it('returns localized greeting based on morning/afternoon/evening time buckets', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2025-01-01T09:00:00Z'));
    expect(getGreetingMessage('en')).toContain('Good morning');

    vi.setSystemTime(new Date('2025-01-01T13:00:00Z'));
    expect(getGreetingMessage('he')).toContain('צהריים טובים');

    vi.setSystemTime(new Date('2025-01-01T20:00:00Z'));
    expect(getGreetingMessage('fr')).toContain('Bonsoir');
  });

  it('falls back to English greeting for unknown locales', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T09:00:00Z'));

    expect(getGreetingMessage('de')).toContain('Good morning');
  });

  it('returns localized error messages with sane fallbacks', () => {
    expect(getErrorMessage('rate_limited', 'en')).toContain('Please try again');
    expect(getErrorMessage('no_permission', 'he')).toContain('אין לי הרשאה');
    expect(getErrorMessage('no_data', 'fr')).toContain('Je n\'ai pas assez de données');

    // unknown error type falls back to api_error set
    expect(getErrorMessage('nonexistent_error', 'en')).toContain('encountered an error');
    // unknown locale falls back to English for known error type
    expect(getErrorMessage('api_error', 'de')).toContain('Please try again later');
  });
});
