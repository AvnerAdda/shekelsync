import { describe, it, expect, vi } from 'vitest';

const { createSandbox, validateSQL, validateJS } = require('../code-sandbox.js');

describe('code-sandbox', () => {
  describe('validateSQL', () => {
    it('rejects empty SQL input', () => {
      expect(validateSQL()).toEqual({
        isValid: false,
        error: 'SQL query is required',
      });
    });

    it('accepts safe SELECT and CTE queries', () => {
      expect(validateSQL('SELECT * FROM transactions')).toEqual({ isValid: true });
      expect(
        validateSQL('WITH monthly AS (SELECT 1 AS value) SELECT * FROM monthly'),
      ).toEqual({ isValid: true });
    });

    it('rejects non-read-only, dangerous, and multi-statement SQL', () => {
      expect(validateSQL('UPDATE transactions SET price = 1')).toEqual({
        isValid: false,
        error: 'Only SELECT queries are allowed',
      });

      expect(validateSQL('SELECT update FROM some_table')).toEqual({
        isValid: false,
        error: 'Query contains forbidden keywords',
      });

      expect(validateSQL('SELECT 1; SELECT 2')).toEqual({
        isValid: false,
        error: 'Multiple statements are not allowed',
      });
    });
  });

  describe('validateJS', () => {
    it('rejects empty code and dangerous JS patterns', () => {
      expect(validateJS('')).toEqual({
        isValid: false,
        error: 'Code is required',
      });

      const bad = validateJS('return require("fs").readFileSync("/etc/passwd");');
      expect(bad.isValid).toBe(false);
      expect(bad.error).toContain('forbidden pattern');
    });

    it('accepts safe JavaScript', () => {
      expect(validateJS('return 2 + 2;')).toEqual({ isValid: true });
    });
  });

  describe('createSandbox', () => {
    it('executes valid SQL and returns row counts for arrays', async () => {
      const dbQuery = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const sandbox = createSandbox(dbQuery);

      const result = await sandbox.executeSQL('SELECT id FROM txns');
      expect(result).toEqual({
        success: true,
        data: [{ id: 1 }, { id: 2 }],
        rowCount: 2,
      });
      expect(dbQuery).toHaveBeenCalledWith('SELECT id FROM txns');
    });

    it('returns rowCount=0 for non-array SQL results and handles SQL failures', async () => {
      const dbQuery = vi
        .fn()
        .mockResolvedValueOnce({ total: 5 })
        .mockRejectedValueOnce(new Error('db down'));
      const sandbox = createSandbox(dbQuery);

      const objectResult = await sandbox.executeSQL('SELECT total FROM summary');
      expect(objectResult).toEqual({
        success: true,
        data: { total: 5 },
        rowCount: 0,
      });

      const failingResult = await sandbox.executeSQL('SELECT 1');
      expect(failingResult).toEqual({
        success: false,
        error: 'Query error: db down',
      });
    });

    it('blocks invalid SQL from execution', async () => {
      const dbQuery = vi.fn();
      const sandbox = createSandbox(dbQuery);

      const result = await sandbox.executeSQL('DELETE FROM transactions');
      expect(result).toEqual({
        success: false,
        error: 'Only SELECT queries are allowed',
      });
      expect(dbQuery).not.toHaveBeenCalled();
    });

    it('executes safe JavaScript using helper utilities and isolates input data', async () => {
      const sandbox = createSandbox(async () => []);
      const input = {
        values: [10, 20, 30],
        items: [
          { type: 'expense', amount: 20 },
          { type: 'income', amount: 100 },
          { type: 'expense', amount: 5 },
        ],
      };

      const result = await sandbox.executeCode(
        `
          data.values.push(40);
          return {
            total: sum(data.values),
            average: round(avg(data.values), 2),
            minimum: min(data.values),
            maximum: max(data.values),
            groupedKeys: Object.keys(groupBy(data.items, 'type')).sort(),
            sortedAmounts: sortBy(data.items, 'amount', true).map((item) => item.amount),
            growth: round(calculateGrowthRate(100, 125), 2),
            compound: round(calculateCompoundGrowth(1000, 10, 2), 2),
          };
        `,
        input,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        total: 100,
        average: 25,
        minimum: 10,
        maximum: 40,
        groupedKeys: ['expense', 'income'],
        sortedAmounts: [100, 20, 5],
        growth: 25,
        compound: 1210,
      });

      expect(input.values).toEqual([10, 20, 30]);
    });

    it('handles utility edge cases and execution-level JS errors', async () => {
      const sandbox = createSandbox(async () => []);

      const edgeCase = await sandbox.executeCode(
        `
          return {
            sum: sum(null),
            avg: avg([]),
            min: min([]),
            max: max(null),
            groupBy: groupBy(null, 'type'),
            sortBy: sortBy(null, 'amount'),
            growth: calculateGrowthRate(0, 50),
          };
        `,
      );

      expect(edgeCase).toEqual({
        success: true,
        result: {
          sum: 0,
          avg: 0,
          min: 0,
          max: 0,
          groupBy: {},
          sortBy: [],
          growth: 0,
        },
      });

      const thrownInCode = await sandbox.executeCode('throw new Error("boom from vm");');
      expect(thrownInCode).toEqual({
        success: false,
        error: 'boom from vm',
      });
    });

    it('rejects dangerous JS, handles syntax errors, and enforces timeout', async () => {
      const sandbox = createSandbox(async () => []);

      const forbidden = await sandbox.executeCode('return process.env.SECRET;');
      expect(forbidden.success).toBe(false);
      expect(forbidden.error).toContain('forbidden pattern');

      const syntax = await sandbox.executeCode('const = 1;');
      expect(syntax).toEqual({
        success: false,
        error: expect.stringContaining('Execution error:'),
      });

      const timeout = await sandbox.executeCode('while (true) {}', {}, { timeout: 10 });
      expect(timeout).toEqual({
        success: false,
        error: 'Calculation took too long. Try a simpler operation.',
      });
    });

    it('provides no-op dispose', () => {
      const sandbox = createSandbox(async () => []);
      expect(() => sandbox.dispose()).not.toThrow();
    });
  });
});
