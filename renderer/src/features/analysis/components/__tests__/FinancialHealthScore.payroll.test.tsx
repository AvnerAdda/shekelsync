import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FinancialHealthScore from '../FinancialHealthScore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      (options && typeof options === 'object' && !('defaultValue' in (options as object))
        ? `${key} ${JSON.stringify(options)}`
        : key),
  }),
}));
vi.mock('@renderer/contexts/ThemeContext', () => ({ useThemeMode: () => ({ setHealthScore: vi.fn() }) }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${Math.round(value).toLocaleString('en-US')}` }),
}));
vi.mock('../HealthScoreTrendModal', () => ({ default: () => null }));

const breakdown = { savingsScore: 82, diversityScore: 70, impulseScore: 64, runwayScore: 90 };

describe('FinancialHealthScore payroll savings', () => {
  it('notes the payroll share under the savings score', () => {
    render(
      <FinancialHealthScore
        data={{ overallHealthScore: 78, healthBreakdown: breakdown, healthScoreMeta: { meta: { payrollSavings: 12392 } } }}
      />,
    );
    expect(screen.getByTestId('health-payroll-savings').textContent)
      .toBe('metrics.savings.payrollIncluded {"amount":"₪12,392"}');
  });

  it('shows nothing extra without payroll savings', () => {
    render(<FinancialHealthScore data={{ overallHealthScore: 78, healthBreakdown: breakdown }} />);
    expect(screen.queryByTestId('health-payroll-savings')).toBeNull();
  });
});
