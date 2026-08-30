import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FinancialOptimizerV2 from '../components/FinancialOptimizerV2';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();
const mockToggleMask = vi.fn();

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('@app/contexts/ChatbotPermissionsContext', () => ({
  useChatbotPermissions: () => ({ hasOpenAiApiKey: true, openAiApiKey: 'sk-test' }),
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: false,
    toggleMaskAmounts: mockToggleMask,
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

const groupKeys = ['household', 'cash_flow', 'banking', 'investments', 'real_estate'] as const;
const groupTitles = ['Household & eligibility', 'Cash flow, spending & subscriptions', 'Banking, cards, cash & debt signals', 'Investments, deposits & retirement', 'Real estate, rent & mortgage'];
const groupSourceRoutes = [
  { path: '/settings', hash: '#profile' },
  { path: '/analysis', search: '?tab=spending' },
  { path: '/settings', hash: '#sync' },
  { path: '/investments', search: '?tab=holdings' },
  { path: '/investments', search: '?tab=real-estate' },
] as const;

function statusPayload(ready = false) {
  return {
    success: true,
    feature: { name: 'optimizerV2', enabled: true, version: 2 },
    review: {
      groups: groupKeys.map((key, index) => ({
        key,
        title: groupTitles[index],
        facts: [{ key: `${key}.fact`, label: index === 1 ? 'Recurring monthly income baseline' : 'Status', value: index === 1 ? 24_000 : 'Recorded', kind: index === 1 ? 'currency' : 'text', source: index === 1 ? 'completed transactions → Income → Salary' : index === 0 ? 'user_profile' : 'database', asOf: null, sensitive: index === 1 }],
        provenance: [index === 0 ? 'user_profile' : 'database'], recorded: true, stale: false, freshnessDays: null,
        fingerprint: `fingerprint-${key}`, sourceRoute: groupSourceRoutes[index],
        status: ready ? 'confirmed' : 'pending', confirmedAt: null, confirmationExpiresAt: null,
      })),
      ready,
      resolvedCount: ready ? 5 : 0,
      totalCount: 5,
      period: { startDate: '2025-08-01', endDate: '2026-07-31', completedMonths: 12 },
    },
    scopeOptions: ['general', 'spending_subscriptions', 'banking_cards', 'cash_deposits', 'investments_retirement', 'real_estate_mortgage'],
    defaults: { primary: 'general', extras: [], change: 'negotiate_only', effort: 'low', liquidity: 'no_lockup', selectedProviders: [] },
    providers: { banking: ['Bank A'], subscriptions: ['Service A'], investments: [], all: ['Bank A', 'Service A'] },
    latestRun: null,
    history: [],
  };
}

const candidate = {
  id: 7,
  runId: 9,
  actionId: 'optv2_test',
  smartActionItemId: null,
  scope: 'banking_cards',
  provider: null,
  product: null,
  title: 'Compare observed banking fees',
  rationale: 'Completed transactions contain fee signals.',
  nextAction: 'Open the official comparison.',
  caveat: null,
  eligibility: { status: 'matched', matchedFacts: [], failedFacts: [], missingConditions: [], answers: {} },
  benefits: { oneTime: { low: 0, high: 0 }, monthly: { low: 10, high: 30 }, annual: { low: 0, high: 0 } },
  score: 81,
  confidence: 'high',
  effort: 'low',
  evidence: ['Observed completed-transaction fees'],
  sourceUrls: ['https://boi.org.il/example'],
  retrievedAt: '2026-08-20T00:00:00Z',
  validUntil: null,
  reverifyRequired: false,
  lifecycleState: 'candidate',
  feedbackCode: null,
  feedbackReasons: [],
  outcomeBand: null,
  snoozePreset: null,
  dismissReason: null,
  sourceVerifiedAt: null,
  createdAt: '2026-08-20 00:00:00',
  updatedAt: '2026-08-20 00:00:00',
};

describe('FinancialOptimizerV2', { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockPost.mockReset();
    mockToggleMask.mockReset();
    mockGet.mockResolvedValue({ ok: true, data: statusPayload(false) });
  });

  it('renders all five review groups with selection-only controls', async () => {
    const user = userEvent.setup();
    render(<FinancialOptimizerV2 />);

    await user.click(screen.getByRole('button', { name: 'Open Optimizator' }));
    await screen.findByText('Household & eligibility');

    for (const title of groupTitles) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText('Recurring monthly income baseline')).toBeInTheDocument();
    expect(screen.queryByText('user_profile')).not.toBeInTheDocument();
    expect(screen.queryByText('completed transactions → Income → Salary')).not.toBeInTheDocument();

    await user.hover(screen.getByText('Household & eligibility'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sources: user_profile');
    await user.unhover(screen.getByText('Household & eligibility'));

    await user.hover(screen.getByText('Recurring monthly income baseline'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Source: completed transactions → Income → Salary');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('opens a valid owning area from Correct source fact for all five review groups', async () => {
    const user = userEvent.setup();
    const navigationEvents: Array<{ path: string; search?: string; hash?: string }> = [];
    const handleNavigate = (event: Event) => {
      navigationEvents.push((event as CustomEvent<{ path: string; search?: string; hash?: string }>).detail);
    };
    window.addEventListener('navigateTo', handleNavigate);
    render(<FinancialOptimizerV2 />);

    try {
      for (let index = 0; index < groupTitles.length; index += 1) {
        await act(async () => {
          window.dispatchEvent(new CustomEvent('openOptimizerDrawer'));
        });
        const heading = await screen.findByText(groupTitles[index]);
        const card = heading.closest('.MuiPaper-root');
        expect(card).not.toBeNull();
        await user.click(within(card as HTMLElement).getByRole('button', { name: 'Correct source fact' }));
        expect(navigationEvents.at(-1)).toEqual(groupSourceRoutes[index]);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      }
    } finally {
      window.removeEventListener('navigateTo', handleNavigate);
    }
  });

  it('confirms a fingerprinted review group', async () => {
    const user = userEvent.setup();
    const confirmed = statusPayload(false).review.groups[0];
    mockPut.mockResolvedValue({ ok: true, data: { success: true, group: { ...confirmed, status: 'confirmed' } } });
    render(<FinancialOptimizerV2 />);

    await user.click(screen.getByRole('button', { name: 'Open Optimizator' }));
    const confirmButtons = await screen.findAllByRole('button', { name: 'Confirm' });
    await user.click(confirmButtons[0]);

    expect(mockPut).toHaveBeenCalledWith('/api/optimizer/v2/review-groups/household', {
      status: 'confirmed',
      fingerprint: 'fingerprint-household',
    });
  });

  it('generates candidates and creates a Smart Action only after Add to plan', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ ok: true, data: statusPayload(true) });
    const run = {
      id: 9, runUuid: 'run-9', status: 'complete',
      scope: statusPayload(true).defaults,
      checkedAreas: ['banking_cards'], sourceMetadata: [], researchStatus: 'complete',
      scoreVersion: 'optimizer-v2-score-1', openaiModel: 'gpt-5.4-mini', errors: [],
      generatedAt: '2026-08-20 00:00:00', candidates: [candidate],
    };
    mockPost.mockResolvedValue({ ok: true, data: { success: true, run } });
    mockPut.mockResolvedValue({ ok: true, data: { candidate: { ...candidate, smartActionItemId: 41, lifecycleState: 'added' } } });
    render(<FinancialOptimizerV2 />);

    await user.click(screen.getByRole('button', { name: 'Open Optimizator' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to Scope' }));
    await user.click(screen.getByRole('button', { name: 'Generate actions' }));
    await screen.findByText('Compare observed banking fees');

    expect(mockPut).not.toHaveBeenCalledWith(expect.stringContaining('/recommendations/'), expect.anything());
    await user.click(screen.getByRole('button', { name: 'Add to plan' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/api/optimizer/v2/recommendations/7/status', { status: 'added' }));
  });
});
