import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseQueryMock = vi.fn();

let dataExportService: any;

beforeAll(async () => {
  const module = await import('../data/export.js');
  dataExportService = module.default ?? module;
});

beforeEach(() => {
  databaseQueryMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-10T12:00:00.000Z'));
  dataExportService.__setDatabase({
    query: databaseQueryMock,
  });
});

afterEach(() => {
  dataExportService.__resetDependencies?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('data export service', () => {
  it('rejects invalid format values', async () => {
    await expect(
      dataExportService.exportData({ format: 'xml' }),
    ).rejects.toMatchObject({
      error: {
        code: 'INVALID_FORMAT',
      },
    });

    expect(databaseQueryMock).not.toHaveBeenCalled();
  });

  it('rejects invalid dataType values', async () => {
    await expect(
      dataExportService.exportData({ dataType: 'snapshot' }),
    ).rejects.toMatchObject({
      error: {
        code: 'INVALID_DATA_TYPE',
      },
    });

    expect(databaseQueryMock).not.toHaveBeenCalled();
  });

  it('exports transactions as CSV with institution columns and escaped values', async () => {
    databaseQueryMock.mockResolvedValueOnce({
      rows: [
        {
          date: '2026-01-14',
          vendor: 'Shop "Prime", Ltd',
          name: 'Monthly\nsubscription',
          price: -89.9,
          category: 'Streaming',
          parent_category: 'Leisure',
          type: 'card',
          status: 'posted',
          account_number: '1234',
          institution_id: 11,
          institution_vendor_code: 'isracard',
          institution_name_he: null,
          institution_name_en: 'Isracard',
          institution_type: 'credit_card',
          institution_logo_url: 'https://logo.example/isracard.png',
        },
      ],
    });

    const result = await dataExportService.exportData({
      format: 'csv',
      dataType: 'transactions',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      includeInstitutions: 'true',
    });

    const [sql, params] = databaseQueryMock.mock.calls[0];
    expect(String(sql)).toContain('FROM transactions t');
    expect(params).toHaveLength(2);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBeInstanceOf(Date);

    expect(result.format).toBe('csv');
    expect(result.filename).toBe('clarify-export-transactions-2026-02-10.csv');
    expect(result.contentType).toBe('text/csv');
    expect(result.body).toContain('Institution,Institution Type');
    expect(result.body).toContain('"Shop ""Prime"", Ltd"');
    expect(result.body).toContain('"Monthly\nsubscription"');
    expect(result.body).toContain('Isracard,credit_card');
  });

  it('applies category and vendor filters when exporting vendors CSV', async () => {
    let vendorsSql = '';
    let vendorsParams: unknown[] = [];

    databaseQueryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const text = String(sql);

      if (text.includes('WITH provided AS')) {
        return { rows: [{ id: '2' }, { id: 7 }, { id: 'not-a-number' }] };
      }

      if (text.includes('GROUP BY t.vendor')) {
        vendorsSql = text;
        vendorsParams = params;
        return {
          rows: [
            {
              vendor: 'Amazon',
              transaction_count: 4,
              total_amount: 301,
              first_transaction: '2026-01-02',
              last_transaction: '2026-01-20',
              institution_id: 99,
              institution_vendor_code: 'amazon',
              institution_name_he: 'אמזון',
              institution_name_en: 'Amazon',
              institution_type: 'merchant',
              institution_logo_url: null,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text.slice(0, 80)}`);
    });

    const result = await dataExportService.exportData({
      format: 'csv',
      dataType: 'vendors',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      categories: 'Food, 2,',
      vendors: 'Amazon, Netflix',
      includeIncome: 'false',
      includeExpenses: 'true',
      includeInvestments: 'false',
      includeInstitutions: 'false',
    });

    const [, categoryParams] = databaseQueryMock.mock.calls[0];
    expect(categoryParams).toEqual([['Food', '2']]);

    expect(vendorsSql).toContain('t.price < 0');
    expect(vendorsSql).toContain("cd.category_type IS NULL OR cd.category_type != 'investment'");
    expect(vendorsSql).toContain('t.category_definition_id = ANY($3::int[])');
    expect(vendorsSql).toContain('t.vendor = ANY($4::text[])');

    expect(vendorsParams).toHaveLength(4);
    expect(vendorsParams[2]).toEqual([2, 7]);
    expect(vendorsParams[3]).toEqual(['Amazon', 'Netflix']);

    expect(result.body).toContain('Vendor,Transaction Count,Total Amount');
    expect(result.body).not.toContain('Institution,Institution Type');
    expect(result.body).toContain('Amazon,4,301');
    expect(result.body).not.toContain('אמזון');
  });

  it('skips category SQL filter when provided categories resolve to no valid ids', async () => {
    let categoriesSql = '';
    let categoriesParams: unknown[] = [];

    databaseQueryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const text = String(sql);

      if (text.includes('WITH provided AS')) {
        return { rows: [{ id: 'invalid' }, { id: undefined }] };
      }

      if (text.includes('COALESCE(parent.id, cd.id) AS category_definition_id')) {
        categoriesSql = text;
        categoriesParams = params;
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${text.slice(0, 80)}`);
    });

    const result = await dataExportService.exportData({
      format: 'json',
      dataType: 'categories',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      categories: 'unknown-category',
    });

    expect(categoriesSql).not.toContain('t.category_definition_id = ANY(');
    expect(categoriesParams).toHaveLength(2);
    expect(result.body.data.exportInfo.filters.categories).toEqual(['unknown-category']);
    expect(result.body.data.exportInfo.recordCounts.categories).toBe(0);
  });

  it('exports full JSON payload with counts, filters and budgets', async () => {
    let transactionSql = '';

    databaseQueryMock.mockImplementation(async (sql: string) => {
      const text = String(sql);

      if (text.includes('ORDER BY t.date DESC, t.vendor, t.name')) {
        transactionSql = text;
        return {
          rows: [
            {
              date: '2026-01-15',
              vendor: 'isracard',
              name: 'Card bill',
              price: -1200,
              category: 'Credit Card Repayment',
              parent_category: 'Banking',
              type: 'card',
              status: 'posted',
              account_number: '1111',
              institution_id: 1,
              institution_vendor_code: 'isracard',
              institution_name_he: 'ישראכרט',
              institution_name_en: 'Isracard',
              institution_type: 'credit_card',
              institution_logo_url: null,
            },
          ],
        };
      }

      if (text.includes('COALESCE(parent.id, cd.id) AS category_definition_id')) {
        return {
          rows: [
            {
              category_definition_id: 14,
              category: 'Transport',
              transaction_count: 3,
              total_amount: 500,
            },
          ],
        };
      }

      if (text.includes('GROUP BY t.vendor')) {
        return {
          rows: [
            {
              vendor: 'isracard',
              transaction_count: 3,
              total_amount: 1200,
              first_transaction: '2026-01-01',
              last_transaction: '2026-01-15',
              institution_id: 1,
              institution_vendor_code: 'isracard',
              institution_name_he: 'ישראכרט',
              institution_name_en: 'Isracard',
              institution_type: 'credit_card',
              institution_logo_url: null,
            },
          ],
        };
      }

      if (text.includes('FROM category_budgets cb')) {
        return {
          rows: [
            {
              category_definition_id: 14,
              category_name: 'Transport',
              period_type: 'monthly',
              budget_limit: 1200,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text.slice(0, 80)}`);
    });

    const result = await dataExportService.exportData({
      format: 'json',
      dataType: 'full',
      includeIncome: 'false',
      includeExpenses: 'false',
      includeInvestments: 'true',
      includeInstitutions: 'false',
      months: 1,
    });

    expect(transactionSql).not.toContain('t.price > 0');
    expect(transactionSql).not.toContain('t.price < 0');
    expect(transactionSql).not.toContain("category_type != 'investment'");

    expect(result.format).toBe('json');
    expect(result.contentType).toBe('application/json');
    expect(result.filename).toBe('clarify-export-full-2026-02-10.json');
    expect(result.body.success).toBe(true);
    expect(result.body.data.transactions).toHaveLength(1);
    expect(result.body.data.transactions[0].institution).toBeUndefined();
    expect(result.body.data.transactions[0].institution_id).toBeUndefined();
    expect(result.body.data.categories).toHaveLength(1);
    expect(result.body.data.vendors).toHaveLength(1);
    expect(result.body.data.budgets).toHaveLength(1);
    expect(result.body.data.exportInfo.filters).toMatchObject({
      categories: null,
      vendors: null,
      includeIncome: false,
      includeExpenses: false,
      includeInvestments: true,
      includeInstitutions: false,
    });
    expect(result.body.data.exportInfo.recordCounts).toEqual({
      transactions: 1,
      categories: 1,
      vendors: 1,
      budgets: 1,
    });
  });

  it('exports full CSV with section headers for each included dataset', async () => {
    databaseQueryMock.mockImplementation(async (sql: string) => {
      const text = String(sql);

      if (text.includes('ORDER BY t.date DESC, t.vendor, t.name')) {
        return {
          rows: [
            {
              date: '2026-01-15',
              vendor: 'Spotify',
              name: 'Spotify premium',
              price: -35,
              category: 'Music',
              parent_category: 'Leisure',
              type: 'card',
              status: 'posted',
              account_number: '9999',
              institution_id: 2,
              institution_vendor_code: 'spotify',
              institution_name_he: null,
              institution_name_en: 'Spotify',
              institution_type: 'merchant',
              institution_logo_url: null,
            },
          ],
        };
      }

      if (text.includes('COALESCE(parent.id, cd.id) AS category_definition_id')) {
        return {
          rows: [
            {
              category: 'Music',
              parent_category: 'Leisure',
              transaction_count: 1,
              total_amount: 35,
            },
          ],
        };
      }

      if (text.includes('GROUP BY t.vendor')) {
        return {
          rows: [
            {
              vendor: 'Spotify',
              transaction_count: 1,
              total_amount: 35,
              first_transaction: '2026-01-15',
              last_transaction: '2026-01-15',
              institution_id: 2,
              institution_vendor_code: 'spotify',
              institution_name_he: null,
              institution_name_en: 'Spotify',
              institution_type: 'merchant',
              institution_logo_url: null,
            },
          ],
        };
      }

      if (text.includes('FROM category_budgets cb')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${text.slice(0, 80)}`);
    });

    const result = await dataExportService.exportData({
      format: 'csv',
      dataType: 'full',
    });

    expect(result.filename).toBe('clarify-full-export-2026-02-10.csv');
    expect(result.body).toContain('=== TRANSACTIONS ===');
    expect(result.body).toContain('=== CATEGORIES SUMMARY ===');
    expect(result.body).toContain('=== VENDORS SUMMARY ===');
    expect(result.body).toContain('Institution,Institution Type');
  });

  it('supports query-utils overrides for date range, response, and error standardization', async () => {
    const customResolveDateRange = vi.fn(() => ({
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-01-31T23:59:59.000Z'),
    }));
    const customStandardizeResponse = vi.fn((data, meta) => ({
      success: true,
      custom: true,
      data,
      meta,
    }));
    const customStandardizeError = vi.fn((message: string, code?: string) => ({
      success: false,
      error: {
        code: `CUSTOM_${code || 'UNKNOWN'}`,
        message,
      },
    }));

    dataExportService.__setQueryUtils({
      resolveDateRange: customResolveDateRange,
      standardizeResponse: customStandardizeResponse,
      standardizeError: customStandardizeError,
    });

    await expect(
      dataExportService.exportData({ format: 'invalid-format' }),
    ).rejects.toMatchObject({
      error: {
        code: 'CUSTOM_INVALID_FORMAT',
      },
    });
    expect(customStandardizeError).toHaveBeenCalled();

    databaseQueryMock.mockResolvedValueOnce({ rows: [] });

    const result = await dataExportService.exportData({
      format: 'json',
      dataType: 'transactions',
      months: 1,
    });

    expect(customResolveDateRange).toHaveBeenCalledWith({
      startDate: undefined,
      endDate: undefined,
      months: 1,
    });
    expect(customStandardizeResponse).toHaveBeenCalled();
    expect(result.body.custom).toBe(true);
  });
});
