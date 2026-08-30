import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MoneyReviewPage from '../pages/MoneyReviewPage';

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
const showNotification = vi.fn();
const translate = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => {
  if (key === 'updatedAt') return `Updated at ${options?.time}`;
  if (key === 'item.minutes') return `~${options?.count} min`;
  if (key === 'filters.all') return `All · ${options?.count}`;
  if (key === 'filters.group') return `${options?.name} · ${options?.count}`;
  if (key === 'filters.showing') return `Showing ${options?.count}`;
  const translations: Record<string, string> = {
    eyebrow: 'Your action plan',
    title: 'Money Review',
    subtitle: 'Prioritized review',
    'summary.open': 'items to review',
    'summary.minutes': 'estimated minutes',
    'summary.impact': 'potential impact',
    'groups.data.title': 'Fix the data',
    'groups.data.description': 'Keep data trustworthy',
    'groups.improve.title': 'Improve your plan',
    'groups.improve.description': 'Work through challenges',
    'groups.cash.title': 'Protect your cash',
    'groups.cash.description': 'Review cash risks',
    'priority.high': 'High priority',
    'actions.refresh': 'Refresh review',
    'actions.reviewNext': 'Review next',
    'actions.done': 'Done',
    'actions.snooze': 'Snooze',
    'actions.dismiss': 'Dismiss',
    'actions.more': 'More actions',
    'item.nextUp': 'Next up',
    'snooze.month': 'One month',
    'snooze.monthHint': 'Bring it back next month',
    'tabs.open': `Open (${options?.count})`,
    'tabs.snoozed': `Snoozed (${options?.count})`,
    'tabs.completed': `Completed (${options?.count})`,
    'empty.open.title': "You're all caught up",
    'empty.open.description': 'No open actions',
  };
  return translations[key] || key;
});

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${value}` }),
}));

vi.mock('@app/contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    status: { completedSteps: { firstScrape: true } },
    getPageAccessStatus: () => ({ isLocked: false, requiredStep: '', reason: '' }),
  }),
}));

vi.mock('@renderer/features/notifications/NotificationContext', () => ({
  useNotification: () => ({ showNotification }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

const reviewItem = {
  id: 11,
  source: 'notification',
  sourceKey: 'money_review:notification:uncategorized_transactions',
  group: 'data',
  actionType: 'optimization_low_confidence',
  severity: 'high',
  title: 'Transactions need categorization',
  description: '12 transactions need review',
  status: 'active',
  detectedAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  snoozedUntil: null,
  potentialImpact: 0,
  confidence: 0.9,
  priority: 87,
  primaryAction: null,
  metadata: {},
};

function response(items = [reviewItem]) {
  return {
    success: true,
    generatedAt: '2026-08-24T00:00:00.000Z',
    summary: {
      open: items.length,
      snoozed: 0,
      completed: 0,
      estimatedMinutes: items.length,
      potentialImpact: 0,
      byGroup: { data: items.length, cash: 0, improve: 0 },
    },
    items,
  };
}

describe('Money Review page', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    post.mockReset();
    showNotification.mockReset();
    get.mockResolvedValue({ ok: true, data: response() });
  });

  it('renders a prioritized review queue', async () => {
    render(<MemoryRouter><MoneyReviewPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Money Review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fix the data', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Transactions need categorization')).toBeInTheDocument();
    expect(screen.getByText('High priority')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/money-review', { cacheMode: 'no-store' });
  });

  it('reuses the dashboard response when Review all opens', async () => {
    render(
      <React.StrictMode>
        <MemoryRouter>
          <MoneyReviewPage presentation="dialog" initialResponse={response()} />
        </MemoryRouter>
      </React.StrictMode>,
    );

    expect(await screen.findByText('Transactions need categorization')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('completes an item and updates the visible queue', async () => {
    put.mockResolvedValue({
      ok: true,
      data: { success: true, item: { ...reviewItem, status: 'resolved' } },
    });
    render(<MemoryRouter><MoneyReviewPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/api/money-review/items/11/status', { status: 'resolved' });
    });
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it('routes challenges to their owning flow without bypassing quest lifecycle rules', async () => {
    get.mockResolvedValue({
      ok: true,
      data: response([{
        ...reviewItem,
        id: 18,
        group: 'improve',
        actionType: 'quest_savings_target',
        title: 'Save more this month',
        primaryAction: { label: 'View challenge', action: 'view_quests', params: {} },
      }]),
    });
    render(<MemoryRouter><MoneyReviewPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'View challenge' }));

    expect(put).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('offers meaningful snooze periods instead of a single fixed delay', async () => {
    put.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        item: { ...reviewItem, status: 'snoozed', snoozedUntil: '2026-09-24T00:00:00.000Z' },
      },
    });
    render(<MemoryRouter><MoneyReviewPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Snooze' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /One month/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/api/money-review/items/11/status', {
        status: 'snoozed',
        snoozePreset: '1_month',
      });
    });
  });

  it('filters the queue by review area', async () => {
    get.mockResolvedValue({
      ok: true,
      data: response([
        reviewItem,
        {
          ...reviewItem,
          id: 12,
          group: 'cash',
          title: 'Budget needs attention',
          actionType: 'budget_overrun',
        },
      ]),
    });
    render(<MemoryRouter><MoneyReviewPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Protect your cash · 1' }));

    expect(screen.getByText('Budget needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Transactions need categorization')).not.toBeInTheDocument();
  });
});
