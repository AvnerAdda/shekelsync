import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const getClientMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();

let duplicatePatternsService: any;

beforeEach(async () => {
  vi.resetModules();

  queryMock.mockReset();
  getClientMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();

  // Mock sql-dialect before importing the service
  vi.doMock('../../../lib/sql-dialect.js', () => ({
    dialect: { useSqlite: true },
  }));

  duplicatePatternsService = (await import('../duplicate-patterns.js')).default;
  duplicatePatternsService.__setDatabase({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  duplicatePatternsService.__resetDatabase?.();
  vi.clearAllMocks();
});

describe('duplicate-patterns service', () => {
  const mockClient = {
    query: clientQueryMock,
    release: releaseMock,
  };

  beforeEach(() => {
    getClientMock.mockResolvedValue(mockClient);
  });

  describe('listPatterns', () => {
    it('returns patterns when table exists', async () => {
      clientQueryMock
        // Table exists check (SQLite)
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        // Override column check (SQLite)
        .mockResolvedValueOnce({ rows: [{ sql: 'CREATE TABLE duplicate_patterns (id, override_category_definition_id)' }] })
        // Pattern query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              pattern_name: 'Fee Pattern',
              pattern_regex: 'עמלה|fee',
              description: 'Bank fees',
              match_type: 'name',
              is_user_defined: false,
              is_auto_learned: true,
              is_active: true,
              confidence: 0.95,
              match_count: 50,
              last_matched_at: '2025-01-01T12:00:00Z',
              override_category_definition_id: 10,
              override_category_name: 'Bank Fees',
            },
          ],
        });

      const result = await duplicatePatternsService.listPatterns();

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].pattern_name).toBe('Fee Pattern');
      expect(result.patterns[0].confidence).toBe(0.95);
      expect(releaseMock).toHaveBeenCalled();
    });

    it('excludes inactive patterns by default', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ sql: 'CREATE TABLE duplicate_patterns (id)' }] })
        .mockResolvedValueOnce({ rows: [] });

      await duplicatePatternsService.listPatterns();

      const queryCall = clientQueryMock.mock.calls[2][0];
      expect(queryCall).toContain('is_active = true');
    });

    it('includes inactive patterns when requested', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ sql: 'CREATE TABLE duplicate_patterns (id)' }] })
        .mockResolvedValueOnce({ rows: [] });

      await duplicatePatternsService.listPatterns({ includeInactive: 'true' });

      const queryCall = clientQueryMock.mock.calls[2][0];
      expect(queryCall).not.toContain('WHERE dp.is_active = true');
    });

    it('throws 500 when table does not exist', async () => {
      clientQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      await expect(duplicatePatternsService.listPatterns()).rejects.toMatchObject({
        status: 500,
        message: 'Pattern detection not available. Run migration first.',
      });
    });

    it('releases client even on error', async () => {
      clientQueryMock.mockRejectedValue(new Error('Database error'));

      await expect(duplicatePatternsService.listPatterns()).rejects.toThrow();
      expect(releaseMock).toHaveBeenCalled();
    });
  });

  describe('createPattern', () => {
    it('creates new pattern successfully', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Table exists
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            pattern_name: 'New Pattern',
            pattern_regex: 'new.*',
            is_active: true,
          }],
        }); // Insert (validateOverrideCategory skips query when no category passed)

      const result = await duplicatePatternsService.createPattern({
        patternName: 'New Pattern',
        patternRegex: 'new.*',
        matchType: 'name',
      });

      expect(result.message).toBe('Pattern created successfully');
      expect(result.pattern.id).toBe(1);
      expect(result.pattern.pattern_name).toBe('New Pattern');
      expect(releaseMock).toHaveBeenCalled();
    });

    it('throws 400 for missing pattern name', async () => {
      await expect(
        duplicatePatternsService.createPattern({
          patternRegex: 'test.*',
          matchType: 'name',
        } as any)
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 for invalid regex', async () => {
      await expect(
        duplicatePatternsService.createPattern({
          patternName: 'Bad Pattern',
          patternRegex: '[invalid(regex',
          matchType: 'name',
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 for missing match type', async () => {
      await expect(
        duplicatePatternsService.createPattern({
          patternName: 'Test Pattern',
          patternRegex: 'test.*',
        } as any)
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('updatePattern', () => {
    it('updates pattern successfully', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Table exists
        .mockResolvedValueOnce({
          rows: [{ id: 1, pattern_name: 'New Name', is_active: true }],
        }); // Update result

      const result = await duplicatePatternsService.updatePattern({
        id: 1,
        patternName: 'New Name',
      });

      expect(result.message).toBe('Pattern updated successfully');
      expect(result.pattern.pattern_name).toBe('New Name');
    });

    it('throws 400 for missing pattern ID', async () => {
      await expect(
        duplicatePatternsService.updatePattern({ patternName: 'Test' })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Pattern ID required',
      });
    });

    it('throws 404 for non-existent pattern', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        duplicatePatternsService.updatePattern({ id: 999, patternName: 'Test' })
      ).rejects.toMatchObject({
        status: 404,
      });
    });

    it('validates regex when updating', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, pattern_name: 'Test', is_active: true }],
        });

      await expect(
        duplicatePatternsService.updatePattern({ id: 1, patternRegex: '[invalid(' })
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('deletePattern', () => {
    it('deletes pattern successfully', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Table exists
        .mockResolvedValueOnce({
          rows: [{ id: 1, pattern_name: 'Test', is_user_defined: true }],
        }) // Fetch existing
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }); // Delete

      const result = await duplicatePatternsService.deletePattern({ id: 1 });

      expect(result.message).toBe('Pattern deleted successfully');
    });

    it('throws 400 for missing pattern ID', async () => {
      await expect(
        duplicatePatternsService.deletePattern({})
      ).rejects.toMatchObject({
        status: 400,
        message: 'Pattern ID required',
      });
    });

    it('throws 404 for non-existent pattern', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(duplicatePatternsService.deletePattern({ id: 999 })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('releases client even on error', async () => {
      clientQueryMock.mockRejectedValue(new Error('Database error'));

      await expect(duplicatePatternsService.deletePattern({ id: 1 })).rejects.toThrow();
      expect(releaseMock).toHaveBeenCalled();
    });
  });

  describe('createPattern additional tests', () => {
    it('creates pattern with override category', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Table exists
        .mockResolvedValueOnce({ rows: [{ id: 10, name: 'Fees', category_type: 'expense' }] }) // Category validation
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            pattern_name: 'Fee Pattern',
            pattern_regex: 'עמלה',
            override_category_definition_id: 10,
            is_active: true,
          }],
        });

      const result = await duplicatePatternsService.createPattern({
        patternName: 'Fee Pattern',
        patternRegex: 'עמלה',
        matchType: 'name',
        overrideCategoryDefinitionId: 10,
      });

      expect(result.pattern.override_category_definition_id).toBe(10);
    });

    it('creates pattern with description', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            pattern_name: 'Test',
            pattern_regex: 'test',
            description: 'Test description',
            is_active: true,
          }],
        });

      const result = await duplicatePatternsService.createPattern({
        patternName: 'Test',
        patternRegex: 'test',
        matchType: 'name',
        description: 'Test description',
      });

      expect(result.pattern.description).toBe('Test description');
    });

    it('throws 400 for non-expense override category', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Table exists
        .mockResolvedValueOnce({ rows: [{ id: 10, name: 'Income', category_type: 'income' }] }); // Non-expense category

      await expect(
        duplicatePatternsService.createPattern({
          patternName: 'Test',
          patternRegex: 'test',
          matchType: 'name',
          overrideCategoryDefinitionId: 10,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Override category must be an expense category',
      });
    });

    it('throws 404 for non-existent override category', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Table exists
        .mockResolvedValueOnce({ rows: [] }); // Category not found

      await expect(
        duplicatePatternsService.createPattern({
          patternName: 'Test',
          patternRegex: 'test',
          matchType: 'name',
          overrideCategoryDefinitionId: 999,
        })
      ).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('updatePattern additional tests', () => {
    it('updates pattern description', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, pattern_name: 'Test', description: 'Updated', is_active: true }],
        });

      const result = await duplicatePatternsService.updatePattern({
        id: 1,
        description: 'Updated',
      });

      expect(result.pattern.description).toBe('Updated');
    });

    it('updates pattern is_active status', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, pattern_name: 'Test', is_active: false }],
        });

      const result = await duplicatePatternsService.updatePattern({
        id: 1,
        isActive: false,
      });

      expect(result.pattern.is_active).toBe(false);
    });

    it('updates pattern confidence threshold', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, pattern_name: 'Test', confidence: 0.8, is_active: true }],
        });

      const result = await duplicatePatternsService.updatePattern({
        id: 1,
        confidence: 0.8,
      });

      expect(result.pattern.confidence).toBe(0.8);
    });

    it('throws 400 when no fields to update', async () => {
      clientQueryMock.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      await expect(
        duplicatePatternsService.updatePattern({ id: 1 })
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('listPatterns additional tests', () => {
    it('filters by user defined only', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ sql: 'CREATE TABLE duplicate_patterns (id)' }] })
        .mockResolvedValueOnce({ rows: [] });

      await duplicatePatternsService.listPatterns({ userDefinedOnly: 'true' });

      const queryCall = clientQueryMock.mock.calls[2][0];
      expect(queryCall).toContain('is_user_defined = true');
    });

    it('handles missing override column gracefully', async () => {
      clientQueryMock
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        // Return table schema without override column
        .mockResolvedValueOnce({ rows: [{ sql: 'CREATE TABLE duplicate_patterns (id, pattern_name)' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              pattern_name: 'Test',
              pattern_regex: 'test',
              is_active: true,
            },
          ],
        });

      const result = await duplicatePatternsService.listPatterns();

      expect(result.patterns).toHaveLength(1);
    });
  });
});
