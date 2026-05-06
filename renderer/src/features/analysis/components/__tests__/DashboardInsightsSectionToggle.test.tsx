import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardInsightsSectionToggle from '../DashboardInsightsSectionToggle';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      switch (key) {
        case 'title':
          return 'Start with the essentials';
        case 'subtitle':
          return 'Keep the first scan focused and open deeper interpretation only when needed.';
        case 'show':
          return 'Show deeper insights';
        case 'hide':
          return 'Hide deeper insights';
        case 'count':
          return `${options?.count} extra cards`;
        default:
          return key;
      }
    },
  }),
}));

describe('DashboardInsightsSectionToggle', () => {
  it('renders the collapsed summary state and toggles expansion', () => {
    const onToggle = vi.fn();

    const { rerender } = render(
      <DashboardInsightsSectionToggle
        expanded={false}
        insightCount={2}
        onToggle={onToggle}
        sectionId="analysis-dashboard-deeper-insights"
      />,
    );

    expect(screen.getByText('Start with the essentials')).toBeInTheDocument();
    expect(screen.getByText('2 extra cards')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show deeper insights' }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <DashboardInsightsSectionToggle
        expanded
        insightCount={2}
        onToggle={onToggle}
        sectionId="analysis-dashboard-deeper-insights"
      />,
    );

    expect(screen.getByRole('button', { name: 'Hide deeper insights' })).toHaveAttribute('aria-expanded', 'true');
  });
});