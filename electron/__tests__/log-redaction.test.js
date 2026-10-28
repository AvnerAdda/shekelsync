import { describe, expect, it } from 'vitest';

const redactionModule = await import('../log-redaction.js');
const { redactLogMessageHook, redactSensitiveText } = redactionModule.default || redactionModule;

describe('log redaction', () => {
  it('masks account numbers and balances from scrape logs', () => {
    expect(redactSensitiveText('[Scrape:discount] Account 1: accountNumber=0123456789, txns=4, balance=₪12,345.67'))
      .toBe('[Scrape:discount] Account 1: accountNumber=****6789, txns=4, balance=[redacted]');
    expect(redactSensitiveText('Account 12-345-678901: 3 transactions, balance: ₪-500'))
      .toBe('Account ****8901: 3 transactions, balance: [redacted]');
  });

  it('redacts secrets in key=value and JSON forms and e-mail addresses', () => {
    expect(redactSensitiveText('{"password":"hunter2!","id_number":"123456782"}'))
      .toBe('{"password":"[redacted]","id_number":"[redacted]"}');
    expect(redactSensitiveText('token=abcdefgh1234 user a.b@example.com')) // gitleaks:allow -- synthetic redaction fixture
      .toBe('token=[redacted] user [redacted-email]');
  });

  it('keeps timestamps, amounts and short numbers readable', () => {
    const line = '{"timestamp":"2026-10-25T12:00:00.000Z","message":"Imported 244 txns in 1532ms","price":-14.5}';
    expect(redactSensitiveText(line)).toBe(line);
  });

  it('redacts shekel amounts outside balance= fields without eating dates', () => {
    expect(redactSensitiveText('Captured balance for max: ₪-5078.99 (account: 4886)'))
      .toBe('Captured balance for max: ₪[redacted] (account: 4886)');
    expect(redactSensitiveText('✓ Synced current balance: 2026-10-26 = ₪65,204.79'))
      .toBe('✓ Synced current balance: 2026-10-26 = ₪[redacted]');
    expect(redactSensitiveText('Starting for discount (balance: ₪79249.16, account: 0162490242)'))
      .toBe('Starting for discount (balance: [redacted], account: ****0242)');
  });

  it('keeps durations readable', () => {
    expect(redactSensitiveText('Request timed out after 120000ms: POST /api/scrape'))
      .toBe('Request timed out after 120000ms: POST /api/scrape');
    expect(redactSensitiveText('Navigation timeout of 120000 ms exceeded'))
      .toBe('Navigation timeout of 120000 ms exceeded');
  });

  it('redacts nested electron-log message data', () => {
    const message = { level: 'info', data: ['card 4580123456781234', { meta: { accountNumber: '0123456789' } }] };
    expect(redactLogMessageHook(message).data).toEqual(['card ****1234', { meta: { accountNumber: '****6789' } }]);
  });
});
