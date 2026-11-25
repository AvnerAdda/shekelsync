import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../one-zero-verification.js');

let verification: any;

describe('One Zero phone verification', () => {
  const queryMock = vi.fn();
  const updateCredentialMock = vi.fn();
  const triggerMock = vi.fn();
  const exchangeMock = vi.fn();
  const createScraperMock = vi.fn();
  let nowMs = Date.UTC(2026, 0, 15, 10, 0, 0);

  beforeAll(async () => {
    const mod = await modulePromise;
    verification = mod.default ?? mod;
  });

  beforeEach(() => {
    nowMs = Date.UTC(2026, 0, 15, 10, 0, 0);
    queryMock.mockReset().mockResolvedValue({ rows: [{ id: 7, vendor: 'oneZero' }] });
    updateCredentialMock.mockReset().mockResolvedValue({ id: 7 });
    triggerMock.mockReset().mockResolvedValue({ success: true });
    exchangeMock.mockReset().mockResolvedValue({ success: true, longTermTwoFactorAuthToken: 'long-term-token' });
    createScraperMock.mockReset().mockImplementation(() => ({
      triggerTwoFactorAuth: triggerMock,
      getLongTermTwoFactorToken: exchangeMock,
    }));
    verification.__resetForTests();
    verification.__setDependencies({
      database: { query: queryMock },
      updateCredential: updateCredentialMock,
      createScraper: createScraperMock,
      now: () => nowMs,
    });
  });

  afterEach(() => {
    verification.__resetForTests();
  });

  describe('normalizePhoneNumber', () => {
    it.each([
      ['050-1234567', '+972501234567'],
      ['0501234567', '+972501234567'],
      ['972501234567', '+972501234567'],
      ['+972 50 123 4567', '+972501234567'],
      ['00972501234567', '+972501234567'],
      ['+447700900123', '+447700900123'],
    ])('accepts %s', (input, expected) => {
      expect(verification.normalizePhoneNumber(input)).toBe(expected);
    });

    it.each(['', '12345', '050123456', 'phone', '+12', null, undefined])('rejects %s', (input) => {
      expect(verification.normalizePhoneNumber(input)).toBeNull();
    });
  });

  it('sends the SMS, then stores the long-term token on the credential without returning it', async () => {
    const started = await verification.startVerification({ credentialId: 7, phoneNumber: '050-1234567' });

    expect(createScraperMock).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'oneZero' }));
    expect(triggerMock).toHaveBeenCalledWith('+972501234567');
    expect(started).toEqual({
      sessionId: expect.any(String),
      expiresAt: new Date(nowMs + verification.SESSION_TTL_MS).toISOString(),
      maskedPhoneNumber: '•••• 4567',
    });
    expect(updateCredentialMock).not.toHaveBeenCalled();

    const confirmed = await verification.confirmVerification({
      credentialId: 7,
      sessionId: started.sessionId,
      code: ' 123 456 ',
    });

    expect(exchangeMock).toHaveBeenCalledWith('123456');
    expect(updateCredentialMock).toHaveBeenCalledWith({ id: 7, otpToken: 'long-term-token' });
    expect(confirmed).toEqual({ verified: true });
    expect(JSON.stringify(confirmed)).not.toContain('long-term-token');

    // The session is single-use.
    await expect(
      verification.confirmVerification({ credentialId: 7, sessionId: started.sessionId, code: '123456' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'session_not_found' });
  });

  it('rejects an invalid phone number before contacting the bank', async () => {
    await expect(
      verification.startVerification({ credentialId: 7, phoneNumber: '12' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_phone_number' });
    expect(createScraperMock).not.toHaveBeenCalled();
  });

  it('only verifies One Zero credentials', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 7, vendor: 'max' }] });
    await expect(
      verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'not_one_zero' });

    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      verification.startVerification({ credentialId: 8, phoneNumber: '0501234567' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'credential_not_found' });
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('reports a failed SMS send (bank error or thrown parse error) as 502', async () => {
    triggerMock.mockResolvedValueOnce({ success: false, errorMessage: 'nope' });
    await expect(
      verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' }),
    ).rejects.toMatchObject({ statusCode: 502, code: 'sms_send_failed' });

    triggerMock.mockRejectedValueOnce(new TypeError("Cannot destructure property 'deviceToken'"));
    await expect(
      verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' }),
    ).rejects.toMatchObject({ statusCode: 502, code: 'sms_send_failed' });
  });

  it('counts wrong codes and ends the session after the last attempt', async () => {
    const { sessionId } = await verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' });
    // The library destructures resultData.otpToken; a wrong code comes back as a missing token or a throw.
    exchangeMock.mockResolvedValue({ success: true, longTermTwoFactorAuthToken: undefined });

    for (let attempt = 1; attempt < verification.MAX_CONFIRM_ATTEMPTS; attempt += 1) {
      await expect(
        verification.confirmVerification({ credentialId: 7, sessionId, code: '000000' }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'code_rejected',
        attemptsRemaining: verification.MAX_CONFIRM_ATTEMPTS - attempt,
      });
    }

    exchangeMock.mockRejectedValueOnce(new TypeError("Cannot destructure property 'otpToken'"));
    await expect(
      verification.confirmVerification({ credentialId: 7, sessionId, code: '000000' }),
    ).rejects.toMatchObject({ statusCode: 429, code: 'too_many_attempts', attemptsRemaining: 0 });

    await expect(
      verification.confirmVerification({ credentialId: 7, sessionId, code: '123456' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'session_not_found' });
    expect(updateCredentialMock).not.toHaveBeenCalled();
  });

  it('expires sessions and rejects a session used for another credential', async () => {
    const { sessionId } = await verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' });

    await expect(
      verification.confirmVerification({ credentialId: 9, sessionId, code: '123456' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'session_not_found' });

    nowMs += verification.SESSION_TTL_MS + 1;
    await expect(
      verification.confirmVerification({ credentialId: 7, sessionId, code: '123456' }),
    ).rejects.toMatchObject({ statusCode: 410, code: 'session_expired' });
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('replaces an earlier pending code request for the same credential', async () => {
    const first = await verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' });
    const second = await verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' });

    await expect(
      verification.confirmVerification({ credentialId: 7, sessionId: first.sessionId, code: '123456' }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await expect(
      verification.confirmVerification({ credentialId: 7, sessionId: second.sessionId, code: '123456' }),
    ).resolves.toEqual({ verified: true });
  });

  it('rejects malformed codes without spending an attempt', async () => {
    const { sessionId } = await verification.startVerification({ credentialId: 7, phoneNumber: '0501234567' });
    await expect(
      verification.confirmVerification({ credentialId: 7, sessionId, code: 'abc' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_code' });
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});
