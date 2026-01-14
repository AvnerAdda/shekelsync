import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../chat.js');

const getClientMock = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

let chatService: any;

beforeAll(async () => {
  const module = await modulePromise;
  chatService = module.default ?? module;
});

beforeEach(() => {
  getClientMock.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();

  getClientMock.mockResolvedValue(mockClient);

  chatService.__setDatabase?.({
    query: vi.fn(),
    getClient: getClientMock,
  });
});

afterEach(() => {
  chatService.__resetDatabase?.();
});

describe('chat service', () => {

  describe('processMessage', () => {
    const setupDefaultMocks = () => {
      mockClient.query
        // Summary query
        .mockResolvedValueOnce({
          rows: [{
            transaction_count: 100,
            total_income: 30000,
            total_expenses: 20000,
          }],
        })
        // Categories query
        .mockResolvedValueOnce({
          rows: [
            { category: 'Food', total: 5000, count: 50 },
            { category: 'Transport', total: 3000, count: 30 },
            { category: 'Entertainment', total: 2000, count: 20 },
          ],
        })
        // Recent transactions query
        .mockResolvedValueOnce({
          rows: [
            { name: 'Grocery Store', price: -150, date: '2025-01-01', parent_category: 'Food' },
            { name: 'Bus Fare', price: -20, date: '2025-01-02', parent_category: 'Transport' },
          ],
        })
        // Merchants query
        .mockResolvedValueOnce({
          rows: [
            { merchant_name: 'SuperMarket', visit_count: 10, total_spent: 2000 },
            { merchant_name: 'Gas Station', visit_count: 5, total_spent: 1500 },
          ],
        });
    };

    it('returns response with metadata for valid message', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'Hello' });

      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata.model).toBe('placeholder-v1');
      expect(result.metadata.contextIncluded.transactions).toBe(100);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('throws 400 error when message is missing', async () => {
      await expect(chatService.processMessage({})).rejects.toMatchObject({
        status: 400,
        message: 'Message is required',
      });
    });

    it('throws 400 error when message is not a string', async () => {
      await expect(
        chatService.processMessage({ message: 123 as any })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Message is required',
      });
    });

    it('handles Hebrew monthly spending question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'כמה הוצאתי החודש?' });

      expect(result.response).toContain('סיכום ההוצאות');
      expect(result.response).toContain('פילוח לפי קטגוריות');
    });

    it('handles Hebrew top category question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'מה הקטגוריה עם הכי הרבה הוצאות?' });

      expect(result.response).toContain('הקטגוריה עם ההוצאה הגבוהה');
      expect(result.response).toContain('Food');
    });

    it('handles Hebrew savings question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'איך אני יכול לחסוך?' });

      expect(result.response).toContain('רעיונות לחיסכון');
    });

    it('handles Hebrew anomalies question with no anomalies', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ transaction_count: 100, total_income: 30000, total_expenses: 20000 }],
        })
        .mockResolvedValueOnce({
          rows: [{ category: 'Food', total: 5000, count: 50 }],
        })
        .mockResolvedValueOnce({
          rows: [
            { name: 'Small Purchase', price: -50, date: '2025-01-01', parent_category: 'Food' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await chatService.processMessage({ message: 'יש לי הוצאות חריגות?' });

      expect(result.response).toContain('לא מצאתי הוצאות חריגות');
    });

    it('handles Hebrew anomalies question with large expenses', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ transaction_count: 100, total_income: 30000, total_expenses: 20000 }],
        })
        .mockResolvedValueOnce({
          rows: [{ category: 'Food', total: 5000, count: 50 }],
        })
        .mockResolvedValueOnce({
          rows: [
            { name: 'Large Purchase', price: -5000, date: '2025-01-01', parent_category: 'Electronics' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await chatService.processMessage({ message: 'יש חריגות בהוצאות?' });

      expect(result.response).toContain('הוצאות חריגות');
      expect(result.response).toContain('Large Purchase');
    });

    it('handles Hebrew income question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'מה ההכנסה שלי?' });

      expect(result.response).toContain('הכנסות מול הוצאות');
    });

    it('handles Hebrew comparison question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'תן לי השוואה בין קטגוריות' });

      expect(result.response).toContain('השוואת הוצאות');
    });

    it('handles Hebrew merchants question', async () => {
      setupDefaultMocks();

      // Use "איפה הוצאתי" without "הכי הרבה" to avoid matching topCategory pattern first
      const result = await chatService.processMessage({ message: 'איפה הוצאתי כסף?' });

      expect(result.response).toContain('הספקים שבהם הוצאת');
    });

    it('handles Hebrew trends question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'מה המגמות שלי?' });

      expect(result.response).toContain('המגמות הכספיות');
    });

    it('returns default response for unrecognized questions', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'some random message' });

      expect(result.response).toContain('היי');
      expect(result.response).toContain('הוצאות חודשיות');
    });

    it('handles empty categories gracefully for top category question', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ transaction_count: 0, total_income: 0, total_expenses: 0 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await chatService.processMessage({ message: 'מה הקטגוריה הגדולה?' });

      expect(result.response).toContain('לא מצאתי מספיק נתונים');
    });

    it('handles empty merchants gracefully', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ transaction_count: 10, total_income: 5000, total_expenses: 3000 }],
        })
        .mockResolvedValueOnce({
          rows: [{ category: 'Food', total: 3000, count: 10 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await chatService.processMessage({ message: 'באילו חנויות הוצאתי?' });

      expect(result.response).toContain('לא מצאתי עסקאות');
    });

    it('releases client even on database error', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'));

      await expect(
        chatService.processMessage({ message: 'Hello' })
      ).rejects.toThrow();

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('preserves status code from service errors', async () => {
      const error = new Error('Custom error') as any;
      error.status = 403;
      mockClient.query.mockRejectedValue(error);

      await expect(
        chatService.processMessage({ message: 'Hello' })
      ).rejects.toMatchObject({
        status: 403,
      });
    });

    it('wraps unknown errors with status 500', async () => {
      mockClient.query.mockRejectedValue(new Error('Unknown error'));

      await expect(
        chatService.processMessage({ message: 'Hello' })
      ).rejects.toMatchObject({
        status: 500,
        message: 'Failed to process chat message',
      });
    });
  });
});
