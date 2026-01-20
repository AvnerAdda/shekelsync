import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('better-sqlite3', () => {
  function FakeDatabase() {}
  FakeDatabase.prototype.pragma = () => {};
  FakeDatabase.prototype.prepare = () => ({
    run: () => {},
    get: () => undefined,
    all: () => [],
  });
  FakeDatabase.prototype.close = () => {};
  return FakeDatabase;
});

// Mock OpenAI to prevent browser environment detection error in tests
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test AI response' }, finish_reason: 'stop' }],
          usage: { total_tokens: 100 },
          model: 'gpt-4o-mini',
        }),
      },
    },
  }));
  return MockOpenAI;
});

const originalConsoleError = console.error;
const suppressedPatterns = [
  /Pairings list error:/,
  /Budgets list error:/,
  /Chat route error:/,
  /Data export error:/,
  /Dashboard analytics error:/,
  /Get category expenses error:/,
  /Investments suggest cost basis error:/,
  /Onboarding status error:/,
  /Failed to fetch pending suggestions count:/,
  /Failed to handle investment category assignment:/,
  /Notifications fetch error:/,
  /\[Bulk Scrape\] API error:/,
];

console.error = (...args: unknown[]) => {
  const firstArg = args[0];
  if (typeof firstArg === 'string' && suppressedPatterns.some((pattern) => pattern.test(firstArg))) {
    return;
  }
  originalConsoleError(...args);
};
