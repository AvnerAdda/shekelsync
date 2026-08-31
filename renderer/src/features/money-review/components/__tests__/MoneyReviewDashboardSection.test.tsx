import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MoneyReviewDashboardSection from '../MoneyReviewDashboardSection';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('@renderer/features/notifications/NotificationContext', () => ({
  useNotification: () => ({ showNotification: vi.fn() }),
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${value}` }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        title: 'Money Review',
        'dashboard.reviewAll': 'Review all',
        'dashboard.previous': 'Previous',
        'dashboard.next': 'Next',
        'dashboard.caughtUp': "You're all caught up",
        'dashboard.caughtUpDescription': 'Nothing needs attention.',
        'dashboard.loadError': 'Review unavailable.',
        'detail.close': 'Close item',
        'detail.whyTitle': 'Why this appeared',
        'detail.explanations.data': 'This affects local data accuracy.',
        'detail.priorityTitle': 'Why it is prioritized',
        'detail.priorityDescription': 'Priority explanation',
        'detail.sources.local': 'Calculated from local data.',
        'actions.retry': 'Try again',
        'actions.start': 'Start',
        'actions.done': 'Done',
        'actions.snooze': 'Snooze',
        'actions.more': 'More actions',
        loading: 'Loading Money Review',
        'item.nextUp': 'Next up',
        'priority.high': 'High priority',
      };
      if (key === 'dashboard.summary') return `${values?.count} items · ~${values?.minutes} min`;
      if (key === 'dashboard.minutes') return `~${values?.count} min`;
      if (key === 'dashboard.impact') return `${values?.amount} potential`;
      if (key === 'dashboard.openItem') return `Review ${values?.title}`;
      if (key === 'timeScope.rollingDays') return `Last ${values?.count} days`;
      if (key === 'timeScope.rollingRange') return `${values?.count}-day window · ${values?.start}–${values?.end}`;
      if (key.startsWith('groups.')) return key.includes('.data.') ? 'Fix the data' : key;
      return translations[key] || key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../pages/MoneyReviewPage', () => ({
  default: ({ initialResponse, onClose }: { initialResponse?: { items: unknown[] } | null; onClose?: () => void }) => (
    <div>
      <h1 id="money-review-title">Money Review</h1>
      <div>Full review queue: {initialResponse ? initialResponse.items.length : 'loading'}</div>
      <button type="button" onClick={onClose}>Close review</button>
    </div>
  ),
}));

const response = {
  success: true,
  generatedAt: '2026-08-27T08:00:00.000Z',
  summary: {
    open: 1,
    snoozed: 0,
    completed: 0,
    estimatedMinutes: 1,
    potentialImpact: 250,
    byGroup: { data: 1, cash: 0, improve: 0 },
  },
  items: [{
    id: 41,
    source: 'notification',
    sourceKey: 'stale-sync',
    group: 'data',
    actionType: 'refresh',
    severity: 'high',
    title: 'Refresh one account',
    description: 'Bring the latest transactions into your review.',
    status: 'active',
    detectedAt: '2026-08-27T08:00:00.000Z',
    updatedAt: '2026-08-27T08:00:00.000Z',
    snoozedUntil: null,
    potentialImpact: 250,
    confidence: 0.9,
    priority: 90,
    primaryAction: null,
    metadata: {
      timeScope: {
        kind: 'rolling_days',
        days: 7,
        start: '2026-08-21',
        end: '2026-08-27',
      },
    },
  }],
};

describe('MoneyReviewDashboardSection', () => {
  beforeEach(() => {
    document.body.dataset.appReady = 'true';
    mockGet.mockReset();
    mockPut.mockReset();
    mockPost.mockReset();
    mockGet.mockResolvedValue({ ok: true, data: response });
  });

  it('shows open work in a horizontal preview and opens the selected item in a modal', async () => {
    render(
      <MemoryRouter>
        <MoneyReviewDashboardSection />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Refresh one account')).toBeInTheDocument();
    expect(screen.getByTestId('money-review-carousel')).toBeInTheDocument();
    expect(screen.getByText('1 items · ~1 min')).toBeInTheDocument();
    expect(screen.getByText('7-day window · Aug 21, 2026–Aug 27, 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review Refresh one account' }));

    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByRole('heading', { name: 'Refresh one account' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Why this appeared');
    expect(dialog).toHaveTextContent('7-day window · Aug 21, 2026–Aug 27, 2026');
    expect(dialog).not.toHaveTextContent('Full review queue');

    fireEvent.click(screen.getByRole('button', { name: 'Close item' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Review all' }));
    expect(await screen.findByText('Full review queue: 1')).toBeInTheDocument();
  }, 10_000);

  it('collapses to a quiet success row when no actions are open', async () => {
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        ...response,
        summary: { ...response.summary, open: 0, estimatedMinutes: 0 },
        items: [{ ...response.items[0], status: 'resolved' }],
      },
    });

    render(
      <MemoryRouter>
        <MoneyReviewDashboardSection />
      </MemoryRouter>,
    );

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.queryByTestId('money-review-carousel')).not.toBeInTheDocument();
  });

  it('shows a compact retry state when the review service is unavailable', async () => {
    mockGet.mockResolvedValue({ ok: false, data: null });

    render(
      <MemoryRouter>
        <MoneyReviewDashboardSection />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Review unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByTestId('money-review-carousel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review all' }));
    expect(await screen.findByText('Full review queue: loading')).toBeInTheDocument();
  });
});
