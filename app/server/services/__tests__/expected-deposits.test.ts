import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findMissingDeposits } = require('../analytics/expected-deposits.js');

const SPOUSE = {
  id: 2,
  member: 'spouse',
  employer_name: 'Gan Dalia',
  salary_match_pattern: 'בנק לאומי משכורת',
  salary_match_vendor: 'discount',
  salary_match_account_number: '0162490242',
};

const salary = (date: string, price = 7029) => ({
  identifier: `s-${date}`,
  vendor: 'discount',
  account_number: '0162490242',
  date: `${date}T00:00:00.000Z`,
  name: 'בנק לאומי משכורת',
  price,
});

const SALARY_HISTORY = [
  salary('2026-07-08'),
  salary('2026-08-08'),
  salary('2026-09-09', 9044),
  salary('2026-10-05'),
];

const INCOME_CATEGORY = 10;
const INVESTMENT_CATEGORY = 20;
const categoryTypes = new Map([[INCOME_CATEGORY, 'income'], [INVESTMENT_CATEGORY, 'investment']]);

const pattern = (overrides: Record<string, unknown>) => ({
  id: 7,
  displayName: 'הפקדה לפיקדון מפתח',
  normalizedName: 'הפקדה לפיקדון מפתח',
  direction: 'expense',
  categoryDefinitionId: INVESTMENT_CATEGORY,
  frequency: 'monthly',
  amount: 100,
  confidence: 0.97,
  occurrenceCount: 6,
  lastSeenDate: '2026-10-10',
  nextExpectedDate: '2026-11-10',
  source: 'detected',
  state: 'active',
  vendor: 'discount',
  corrections: [],
  ...overrides,
});

const coverage = (date: string) => new Map([['discount', date]]);

describe('expected deposits', () => {
  it('reports a salary that missed its usual day once the bank has data past it', () => {
    const { missing } = findMissingDeposits({
      today: '2026-11-20',
      employments: [SPOUSE],
      salaryDeposits: SALARY_HISTORY,
      vendorCoverage: coverage('2026-11-19'),
    });

    expect(missing).toEqual([
      expect.objectContaining({
        kind: 'salary',
        key: 'salary:2:2026-11',
        name: 'Gan Dalia',
        searchText: 'בנק לאומי משכורת',
        expectedDate: '2026-11-08',
        // Latest recent payday (9th) plus the grace days.
        deadline: '2026-11-11',
        expectedAmount: 7029,
        lastReceivedDate: '2026-10-05',
      }),
    ]);
  });

  it('waits while the usual payday window is open or the bank has not synced past it', () => {
    const base = { employments: [SPOUSE], salaryDeposits: SALARY_HISTORY };
    expect(findMissingDeposits({ ...base, today: '2026-11-10', vendorCoverage: coverage('2026-11-10') }).missing).toEqual([]);
    expect(findMissingDeposits({ ...base, today: '2026-11-20', vendorCoverage: coverage('2026-11-08') }).missing).toEqual([]);
  });

  it('counts a salary paid early at the end of the previous month', () => {
    const { missing } = findMissingDeposits({
      today: '2026-11-20',
      employments: [SPOUSE],
      // November's salary landed on October 30th.
      salaryDeposits: [...SALARY_HISTORY, salary('2026-10-30')],
      vendorCoverage: coverage('2026-11-19'),
    });
    expect(missing).toEqual([]);
  });

  it('reports an overdue regular investment deposit and owns its pattern', () => {
    const { missing, trackedPatternIds } = findMissingDeposits({
      today: '2026-11-20',
      patterns: [pattern({})],
      categoryTypes,
      vendorCoverage: coverage('2026-11-19'),
    });

    expect([...trackedPatternIds]).toEqual([7]);
    expect(missing).toEqual([
      expect.objectContaining({
        kind: 'investment',
        key: 'pattern:7:2026-11-10',
        patternId: 7,
        expectedDate: '2026-11-10',
        daysLate: 10,
        expectedAmount: 100,
      }),
    ]);
  });

  it('ignores loose, lapsed, and salary-rule income patterns', () => {
    const { missing, trackedPatternIds } = findMissingDeposits({
      today: '2026-11-20',
      employments: [SPOUSE],
      salaryDeposits: SALARY_HISTORY,
      patterns: [
        pattern({ id: 1, confidence: 0.45 }),
        pattern({ id: 2, lastSeenDate: '2026-07-01', nextExpectedDate: '2026-08-01' }),
        pattern({
          id: 3,
          direction: 'income',
          categoryDefinitionId: INCOME_CATEGORY,
          displayName: 'בנק לאומי משכורת',
          nextExpectedDate: '2026-11-05',
        }),
      ],
      categoryTypes,
      vendorCoverage: coverage('2026-11-10'),
    });

    expect([...trackedPatternIds]).toEqual([]);
    // The salary itself is still not missing: its deadline (Nov 11) is after the data (Nov 10).
    expect(missing).toEqual([]);
  });

  it('reports a regular non-salary income such as a government allowance', () => {
    const { missing } = findMissingDeposits({
      today: '2026-11-30',
      patterns: [pattern({
        id: 43,
        direction: 'income',
        categoryDefinitionId: INCOME_CATEGORY,
        displayName: 'ביטוח לאומי - ילדים',
        amount: 115,
        lastSeenDate: '2026-10-18',
        nextExpectedDate: '2026-11-18',
      })],
      categoryTypes,
      vendorCoverage: coverage('2026-11-29'),
    });
    expect(missing).toEqual([expect.objectContaining({ kind: 'income', key: 'pattern:43:2026-11-18' })]);
  });
});
