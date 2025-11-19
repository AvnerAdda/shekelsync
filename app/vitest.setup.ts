import '@testing-library/jest-dom';

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
