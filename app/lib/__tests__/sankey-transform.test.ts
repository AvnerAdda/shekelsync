import { describe, expect, it } from 'vitest';
import transformToSankeyData, { SankeyDataPoint } from '../sankey-transform';

const baseIncome = (overrides: Partial<SankeyDataPoint>): SankeyDataPoint => ({
  name: 'Income',
  value: 0,
  type: 'income',
  color: '#10b981',
  count: 1,
  ...overrides,
});

const baseExpense = (overrides: Partial<SankeyDataPoint>): SankeyDataPoint => ({
  name: 'Expense',
  value: -100,
  type: 'expense',
  color: '#ef4444',
  count: 1,
  ...overrides,
});

const baseInvestment = (overrides: Partial<SankeyDataPoint>): SankeyDataPoint => ({
  name: 'Investment',
  value: -100,
  type: 'investment',
  color: '#3b82f6',
  count: 1,
  ...overrides,
});

describe('transformToSankeyData', () => {
  it('returns no flow when data is empty or zero-valued', () => {
    const result = transformToSankeyData([]);

    expect(result.hasFlow).toBe(false);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].name).toBe('Total Income');
    expect(result.links).toHaveLength(0);
  });

  it('groups excess expense categories under "Other Expenses"', () => {
    const data: SankeyDataPoint[] = [
      baseIncome({ name: 'Salary', value: 5000 }),
      baseExpense({ name: 'Rent', value: -1800, count: 2 }),
      baseExpense({ name: 'Groceries', value: -600, count: 15 }),
      baseExpense({ name: 'Utilities', value: -400, count: 5 }),
      baseExpense({ name: 'Transportation', value: -300, count: 10 }),
      baseExpense({ name: 'Dining Out', value: -250, count: 6 }),
      baseExpense({ name: 'Entertainment', value: -120, count: 3 }),
    ];

    const result = transformToSankeyData(data);

    const otherExpensesNodeIndex = result.nodes.findIndex((node) => node.name === 'Other Expenses');
    expect(otherExpensesNodeIndex).toBeGreaterThan(-1);

    const otherExpensesNode = result.nodes[otherExpensesNodeIndex];
    expect(otherExpensesNode?.value).toBeCloseTo(370); // Dining Out + Entertainment
    expect(otherExpensesNode?.count).toBe(9); // 6 + 3

    const otherExpenseLink = result.links.find((link) => link.target === otherExpensesNodeIndex);
    expect(otherExpenseLink).toBeDefined();
    expect(otherExpenseLink?.value).toBeCloseTo(370);
  });

  it('groups excess investment categories under "Other Investments"', () => {
    const data: SankeyDataPoint[] = [
      baseIncome({ name: 'Salary', value: 8000 }),
      baseInvestment({ name: 'ETF', value: -1200, count: 2 }),
      baseInvestment({ name: 'Retirement', value: -900, count: 1 }),
      baseInvestment({ name: 'Crypto', value: -400, count: 4 }),
      baseInvestment({ name: 'Savings', value: -300, count: 2 }),
      baseInvestment({ name: 'Stocks', value: -250, count: 3 }),
    ];

    const result = transformToSankeyData(data);

    const otherInvestmentsIndex = result.nodes.findIndex((node) => node.name === 'Other Investments');
    expect(otherInvestmentsIndex).toBeGreaterThan(-1);

    const otherInvestmentsNode = result.nodes[otherInvestmentsIndex];
    expect(otherInvestmentsNode?.value).toBeCloseTo(250);
    expect(otherInvestmentsNode?.count).toBe(3);

    const otherInvestmentLink = result.links.find((link) => link.target === otherInvestmentsIndex);
    expect(otherInvestmentLink).toBeDefined();
    expect(otherInvestmentLink?.value).toBeCloseTo(250);
  });
});
