import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const encryptMock = vi.fn((value) => `enc(${value})`);
const decryptMock = vi.fn((value) => {
  if (value === 'bad-encrypted') {
    throw new Error('decrypt failed');
  }
  return `dec(${value})`;
});
const toUTCISOStringMock = vi.fn((value) => (value ? `utc:${value}` : null));

const institutionsMock = {
  INSTITUTION_JOIN_VENDOR_CRED: 'LEFT JOIN institution_nodes fi ON fi.id = vc.institution_id',
  INSTITUTION_SELECT_FIELDS: [
    'fi.id as institution_id',
    'fi.vendor_code as institution_vendor_code',
    'fi.display_name_he as institution_display_name_he',
    'fi.display_name_en as institution_display_name_en',
    'fi.institution_type',
    'fi.category as institution_category',
    'fi.subcategory as institution_subcategory',
    'fi.logo_url as institution_logo_url',
    'fi.is_scrapable as institution_is_scrapable',
    'fi.scraper_company_id as institution_scraper_company_id',
    'fi.parent_id as institution_parent_id',
    'fi.hierarchy_path as institution_hierarchy_path',
    'fi.depth_level as institution_depth_level',
  ].join(', '),
  buildInstitutionFromRow: vi.fn((row) => {
    if (!row?.institution_id) return null;
    return {
      id: row.institution_id,
      vendor_code: row.institution_vendor_code,
      display_name_en: row.institution_display_name_en,
      institution_type: row.institution_type,
    };
  }),
  getInstitutionById: vi.fn(),
  mapVendorCodeToInstitutionId: vi.fn(),
};

let credentialsService;

function createCredentialRow(overrides = {}) {
  return {
    id: 7,
    vendor: 'hapoalim',
    institution_id: 3,
    username: 'enc(user)',
    password: 'enc(secret)',
    id_number: 'enc(id)',
    card6_digits: '123456',
    identification_code: 'enc(otp)',
    nickname: 'Main',
    bank_account_number: '1111',
    created_at: '2026-01-01T00:00:00.000Z',
    current_balance: 4500,
    balance_updated_at: '2026-01-02T00:00:00.000Z',
    last_scrape_success: '2026-01-03T00:00:00.000Z',
    last_scrape_status: 'success',
    last_scrape_attempt: '2026-01-04T00:00:00.000Z',
    institution_vendor_code: 'hapoalim',
    institution_display_name_en: 'Bank Hapoalim',
    institution_type: 'bank',
    ...overrides,
  };
}

beforeAll(async () => {
  const module = await import('../credentials.js');
  credentialsService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  encryptMock.mockClear();
  decryptMock.mockClear();
  toUTCISOStringMock.mockClear();
  institutionsMock.buildInstitutionFromRow.mockClear();
  institutionsMock.getInstitutionById.mockReset();
  institutionsMock.mapVendorCodeToInstitutionId.mockReset();

  credentialsService.__setDatabase({
    query: queryMock,
    getClient: async () => ({ query: queryMock, release: () => {} }),
  });
  credentialsService.__setEncryption({
    encrypt: encryptMock,
    decrypt: decryptMock,
  });
  credentialsService.__setInstitutionsModule(institutionsMock);
  credentialsService.__setTimeUtils({
    toUTCISOString: toUTCISOStringMock,
  });
});

afterEach(() => {
  credentialsService.__resetDependencies?.();
  vi.restoreAllMocks();
});

describe('credentials service', () => {
  it('lists all credentials and maps encrypted + institution fields', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [createCredentialRow()],
    });

    const result = await credentialsService.listCredentials();

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('ORDER BY vc.vendor');
    expect(queryMock.mock.calls[0][1]).toEqual([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 7,
      vendor: 'hapoalim',
      username: 'dec(enc(user))',
      password: 'dec(enc(secret))',
      id_number: 'dec(enc(id))',
      identification_code: 'dec(enc(otp))',
      created_at: 'utc:2026-01-01T00:00:00.000Z',
      institution: {
        id: 3,
        vendor_code: 'hapoalim',
      },
    });
  });

  it('lists credentials by vendor filter', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [createCredentialRow({ vendor: 'isracard' })],
    });

    await credentialsService.listCredentials({ vendor: 'isracard' });

    expect(String(queryMock.mock.calls[0][0])).toContain('WHERE vc.vendor = $1');
    expect(queryMock.mock.calls[0][1]).toEqual(['isracard']);
  });

  it('maps sqlite alias casing for lastUpdate and lastScrapeStatus', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        createCredentialRow({
          last_scrape_success: null,
          last_scrape_status: null,
          lastUpdate: '2026-02-19T11:40:53.757Z',
          lastScrapeStatus: 'success',
        }),
      ],
    });

    const result = await credentialsService.listCredentials();

    expect(result[0].lastUpdate).toBe('utc:2026-02-19T11:40:53.757Z');
    expect(result[0].lastScrapeStatus).toBe('success');
  });

  it('throws sanitized decrypt error when encrypted value cannot be decrypted', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [createCredentialRow({ username: 'bad-encrypted' })],
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(credentialsService.listCredentials()).rejects.toThrow(
      'Failed to decrypt credential. The encryption key may have changed.',
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('validates update payload requirements', async () => {
    await expect(credentialsService.updateCredential({})).rejects.toMatchObject({
      statusCode: 400,
      message: 'Credential ID is required',
    });
  });

  it('does not overwrite id_number when only row id + non-id field are provided', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [createCredentialRow({ id: 1 })] });

    await credentialsService.updateCredential({ id: 1, nickname: 'Updated nickname' });

    const [updateSql, updateParams] = queryMock.mock.calls[0];
    expect(String(updateSql)).not.toContain('id_number');
    expect(updateParams).toEqual([1, 'Updated nickname']);
    expect(encryptMock).not.toHaveBeenCalledWith('1');
  });

  it('updates credential fields and returns mapped credential', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [createCredentialRow({ id: 5 })] });

    const result = await credentialsService.updateCredential({
      id: 5,
      password: 'new-pass',
      email: 'new@example.com',
      id_number: '123456789',
      card6Digits: '654321',
      bankAccountNumber: '2222',
      otpToken: '999999',
      nickname: '  Renamed  ',
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [, updateParams] = queryMock.mock.calls[0];
    expect(updateParams).toEqual([
      5,
      'enc(new-pass)',
      'enc(new@example.com)',
      'enc(123456789)',
      '654321',
      '2222',
      'enc(999999)',
      'Renamed',
    ]);
    expect(result.id).toBe(5);
    expect(result.nickname).toBe('Main');
  });

  it('returns 404 when update affects no rows', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });

    await expect(credentialsService.updateCredential({ id: 999, nickname: 'X' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Credential not found',
    });
  });

  it('returns 404 when updated credential cannot be reloaded', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    await expect(credentialsService.updateCredential({ id: 2, nickname: 'X' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Credential not found',
    });
  });

  it('validates create payload and unknown institutions', async () => {
    await expect(credentialsService.createCredential({})).rejects.toMatchObject({
      statusCode: 400,
      message: 'Vendor or institution_id is required',
    });

    institutionsMock.mapVendorCodeToInstitutionId.mockResolvedValueOnce(null);
    await expect(credentialsService.createCredential({ vendor: 'unknown' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Unknown institution. Please choose a supported financial institution.',
    });
  });

  it('creates credential using institution lookup when vendor is missing', async () => {
    institutionsMock.getInstitutionById.mockResolvedValueOnce({ vendor_code: 'leumi' });
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [createCredentialRow({ id: 12, vendor: 'leumi' })] });

    const result = await credentialsService.createCredential({
      institution_id: 44,
      username: 'user',
      password: 'pass',
      nickname: 'Wallet',
    });

    expect(institutionsMock.getInstitutionById).toHaveBeenCalled();
    expect(queryMock.mock.calls[0][1][0]).toBe('leumi');
    expect(queryMock.mock.calls[0][1][8]).toBe(44);
    expect(result.vendor).toBe('leumi');
  });

  it('creates credential using vendor-to-institution mapping', async () => {
    institutionsMock.mapVendorCodeToInstitutionId.mockResolvedValueOnce(55);
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 13 }] })
      .mockResolvedValueOnce({ rows: [createCredentialRow({ id: 13, institution_id: 55 })] });

    await credentialsService.createCredential({
      vendor: 'hapoalim',
      userCode: 'my-user',
      num: '00112233',
    });

    expect(institutionsMock.mapVendorCodeToInstitutionId).toHaveBeenCalledWith(
      expect.any(Object),
      'hapoalim',
    );
    expect(queryMock.mock.calls[0][1][0]).toBe('hapoalim');
    expect(queryMock.mock.calls[0][1][1]).toBe('enc(my-user)');
    expect(queryMock.mock.calls[0][1][7]).toBe('enc(00112233)');
  });

  it('validates delete credential requirements and not-found branch', async () => {
    await expect(credentialsService.deleteCredential({})).rejects.toMatchObject({
      statusCode: 400,
      message: 'Credential ID is required',
    });

    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(credentialsService.deleteCredential({ id: 7 })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Credential not found',
    });
  });

  it('deletes vendor transactions by account number when present', async () => {
    queryMock.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT vendor, bank_account_number, nickname')) {
        return { rows: [{ vendor: 'hapoalim', bank_account_number: '1111', nickname: null }] };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(credentialsService.deleteCredential({ id: 10 })).resolves.toEqual({ success: true });
    expect(String(queryMock.mock.calls[4][0])).toContain('DELETE FROM transactions WHERE vendor = $1 AND account_number = $2');
    expect(queryMock.mock.calls[4][1]).toEqual(['hapoalim', '1111']);
  });

  it('deletes vendor transactions by nickname when account number is absent', async () => {
    queryMock.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT vendor, bank_account_number, nickname')) {
        return { rows: [{ vendor: 'isracard', bank_account_number: null, nickname: 'Gold Card' }] };
      }
      return { rows: [], rowCount: 1 };
    });

    await credentialsService.deleteCredential({ id: 11 });
    expect(String(queryMock.mock.calls[4][0])).toContain('DELETE FROM transactions WHERE vendor = $1 AND vendor_nickname = $2');
    expect(queryMock.mock.calls[4][1]).toEqual(['isracard', 'Gold Card']);
  });

  it('fallback-deletes all vendor transactions only when credential is last for that vendor', async () => {
    queryMock.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT vendor, bank_account_number, nickname')) {
        return { rows: [{ vendor: 'max', bank_account_number: null, nickname: null }] };
      }
      if (text.includes('SELECT COUNT(*) as count FROM vendor_credentials')) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [], rowCount: 1 };
    });

    await credentialsService.deleteCredential({ id: 12 });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM transactions WHERE vendor = $1'))).toBe(true);

    queryMock.mockReset();
    queryMock.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT vendor, bank_account_number, nickname')) {
        return { rows: [{ vendor: 'max', bank_account_number: null, nickname: null }] };
      }
      if (text.includes('SELECT COUNT(*) as count FROM vendor_credentials')) {
        return { rows: [{ count: 2 }] };
      }
      return { rows: [], rowCount: 1 };
    });

    await credentialsService.deleteCredential({ id: 13 });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM transactions WHERE vendor = $1'))).toBe(false);
  });
});
