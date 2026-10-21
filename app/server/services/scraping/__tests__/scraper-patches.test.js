// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createScraper, CompanyTypes } = require('israeli-bank-scrapers-core');
const navigation = require('israeli-bank-scrapers-core/lib/helpers/navigation');
const elements = require('israeli-bank-scrapers-core/lib/helpers/elements-interactions');
const fetching = require('israeli-bank-scrapers-core/lib/helpers/fetch');

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('installed bank scraper patches', () => {
  it('waits for Discount SPA navigation and accepts the upstream retail3 landing route', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigation, 'waitForNavigation').mockResolvedValue(undefined);
    const scraper = createScraper({ companyId: CompanyTypes.discount });
    scraper.page = {
      url: vi.fn()
        .mockReturnValueOnce('https://start.telebank.co.il/login/')
        .mockReturnValue('https://start.telebank.co.il/apollo/retail3/'),
    };

    const completed = vi.fn();
    const navigationDone = scraper.getLoginOptions({}).postAction().then(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(completed).toHaveBeenCalledOnce();
    await navigationDone;
  });

  async function fetchMizrahiBalance(rows, fields = {}) {
    vi.spyOn(elements, 'waitUntilElementFound').mockResolvedValue(undefined);
    vi.spyOn(fetching, 'fetchPostWithinPage').mockResolvedValue({
      header: { success: true },
      body: { table: { rows }, fields },
    });
    const scraper = createScraper({
      companyId: CompanyTypes.mizrahi,
      startDate: new Date('2026-09-01T00:00:00Z'),
    });
    scraper.page = {
      waitForSelector: async () => {},
      $eval: async () => {},
      $: async () => ({ getProperty: async () => ({ jsonValue: async () => 'test-account' }) }),
      waitForRequest: async () => ({ postData: () => '{"table":{}}', headers: () => ({}) }),
    };
    scraper.getPendingTransactions = async () => [];
    return (await scraper.fetchAccount()).balance;
  }

  it('uses the latest valid Mizrahi row balance instead of sentinel or stale field values', async () => {
    const row = (date, balance) => ({
      RecTypeSpecified: true,
      MC02PeulaTaaEZ: date,
      MC02YitraEZ: balance,
      MC02SchumEZ: 10,
    });
    const balance = await fetchMizrahiBalance([
      row('2026-09-03T12:00:00', '₪ 1,234.56'),
      row('2026-09-02T12:00:00', 900),
      row('2026-09-04T12:00:00', Number.MAX_VALUE),
    ], { Yitra: 800 });
    expect(balance).toBe(1234.56);
  });

  it('preserves a zero balance and supports the lowercase fallback field', async () => {
    expect(await fetchMizrahiBalance([], { yitra: '0.00' })).toBe(0);
  });
});
