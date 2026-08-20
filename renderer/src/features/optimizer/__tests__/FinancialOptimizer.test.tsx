import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FinancialOptimizerV1 as FinancialOptimizer } from '../components/FinancialOptimizer';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();
let mockMaskAmounts = false;

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('@app/contexts/ChatbotPermissionsContext', () => ({
  MODEL_TIERS: {
    light: { model: 'gpt-4o-mini', label: 'Light' },
    normal: { model: 'gpt-4o', label: 'Normal' },
    heavy: { model: 'gpt-4.1', label: 'Heavy' },
  },
  useChatbotPermissions: () => ({
    hasOpenAiApiKey: true,
    openAiApiKey: 'sk-test',
    chatModelTier: 'light',
  }),
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: mockMaskAmounts,
    formatCurrency: (value: number, options?: { showSign?: boolean }) => {
      if (mockMaskAmounts) return '₪***';
      const prefix = options?.showSign && value > 0 ? '+' : '';
      return `${prefix}₪${value}`;
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string; count?: number }) => {
      if (typeof options === 'string') return options;
      if (options?.defaultValue) {
        return options.defaultValue.replace('{{count}}', String(options.count ?? ''));
      }
      return _key;
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

const statusPayload = {
  facts: [
    {
      factKey: 'start.location',
      section: 'start',
      label: 'Bills location',
      value: 'Tel Aviv',
      valueText: 'Tel Aviv',
      status: 'detected',
      source: 'detected',
      confidence: 0.8,
      inputType: 'text',
      persisted: false,
    },
  ],
  detectedFacts: [],
  questions: [
    {
      factKey: 'preferences.hassle_tolerance',
      section: 'constraints',
      label: 'Hassle tolerance',
      prompt: 'How much hassle?',
      inputType: 'select',
      options: ['low', 'medium', 'high'],
    },
  ],
  missingFields: ['preferences.hassle_tolerance'],
  progress: { totalQuestions: 1, resolvedQuestions: 0, unresolvedQuestions: 1 },
  latestRun: null,
  recommendations: [],
  isStale: false,
};

const recommendation = {
  id: 12,
  runId: 4,
  smartActionItemId: 31,
  title: 'Review streaming subscriptions',
  section: 'subscriptions',
  rationale: 'One service appears underused.',
  evidence: ['Subscriptions: ₪240'],
  estimatedMonthlyImpact: 120,
  hassleLevel: 'low',
  confidence: 0.82,
  nextAction: 'Cancel one unused service.',
  caveat: null,
  status: 'active',
  userNote: null,
  realizedMonthlySavings: null,
  snoozedUntil: null,
  completedAt: null,
  createdAt: '2026-08-02 09:00:00',
  updatedAt: '2026-08-02 09:00:00',
};

describe('FinancialOptimizer', { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockPost.mockReset();
    mockMaskAmounts = false;
    mockGet.mockResolvedValue({ ok: true, data: statusPayload });
    mockPut.mockResolvedValue({ ok: true, data: { facts: [] } });
    mockPost.mockResolvedValue({ ok: true, data: {} });
  });

  it('opens from the Optimizator FAB and confirms a detected fact', async () => {
    const user = userEvent.setup();
    mockPut.mockResolvedValue({
      ok: true,
      data: {
        facts: [{
          ...statusPayload.facts[0],
          status: 'confirmed',
          persisted: true,
        }],
      },
    });
    render(<FinancialOptimizer />);

    const launcher = screen.getByLabelText('Optimizator');
    expect(launcher).toHaveClass('MuiFab-circular');
    expect(launcher).not.toHaveClass('MuiFab-extended');
    await user.click(launcher);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/optimizer/status');
    });
    expect(screen.getByRole('progressbar', { name: 'Profile readiness' })).toHaveAttribute('aria-valuenow', '0');
    expect(await screen.findByText('Bills location')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/api/optimizer/facts', {
        facts: [
          expect.objectContaining({
            factKey: 'start.location',
            status: 'confirmed',
            value: 'Tel Aviv',
          }),
        ],
      });
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('skips a quiz question', async () => {
    const user = userEvent.setup();
    mockPut.mockResolvedValue({
      ok: true,
      data: {
        facts: [{
          ...statusPayload.questions[0],
          value: null,
          valueText: null,
          status: 'skipped',
          source: 'user',
          confidence: 1,
          persisted: true,
        }],
      },
    });
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));
    await screen.findByText('Bills location');

    await user.click(screen.getByRole('tab', { name: /^questions$/i }));
    await screen.findByText('Hassle tolerance');
    await user.click(screen.getByRole('button', { name: /skip/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/api/optimizer/facts', {
        facts: [
          expect.objectContaining({
            factKey: 'preferences.hassle_tolerance',
            status: 'skipped',
            value: null,
          }),
        ],
      });
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('All essential questions are resolved.')).toBeInTheDocument();
  });

  it('does not save an empty quiz answer as resolved', async () => {
    const user = userEvent.setup();
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));
    await screen.findByText('Bills location');

    await user.click(screen.getByRole('tab', { name: /^questions$/i }));
    await screen.findByText('Hassle tolerance');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Enter an answer, skip it, or mark it unknown.')).toBeInTheDocument();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('does not retry status forever after a load failure', async () => {
    const user = userEvent.setup();
    mockGet.mockRejectedValue(new Error('Network unavailable'));
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));

    expect(await screen.findByText('Network unavailable')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty review edit and reloads status when reopened', async () => {
    const user = userEvent.setup();
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));
    await screen.findByText('Bills location');
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const input = screen.getByRole('textbox', { name: 'Bills location' });
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Enter an answer, skip it, or mark it unknown.')).toBeInTheDocument();
    expect(mockPut).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^close$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByLabelText('Optimizator'));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('sends the resolved locale when generating a plan', async () => {
    const user = userEvent.setup();
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));
    await screen.findByText('Bills location');
    await user.click(screen.getByRole('tab', { name: /^plan$/i }));
    await user.click(screen.getByRole('button', { name: /generate action plan/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/optimizer/generate', expect.objectContaining({
        locale: 'en',
        model: 'gpt-4o-mini',
      }));
    });
  });

  it('honors the global amount mask for detected currency facts', async () => {
    const user = userEvent.setup();
    mockMaskAmounts = true;
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        ...statusPayload,
        facts: [{
          ...statusPayload.facts[0],
          factKey: 'income.monthly_take_home',
          label: 'Monthly take-home income',
          value: 22_000,
          valueText: '₪22,000',
          inputType: 'currency',
        }],
      },
    });
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));

    expect(await screen.findByText('₪***')).toBeInTheDocument();
    expect(screen.queryByText('₪22,000')).not.toBeInTheDocument();
  });

  it('records the realized result when an action is completed', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      ok: true,
      data: { ...statusPayload, recommendations: [recommendation] },
    });
    mockPut.mockResolvedValue({
      ok: true,
      data: {
        recommendation: {
          ...recommendation,
          status: 'done',
          userNote: 'Cancelled after checking usage',
          realizedMonthlySavings: 95,
          completedAt: '2026-08-02 10:00:00',
        },
      },
    });
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));
    await user.click(await screen.findByRole('tab', { name: /^plan$/i }));
    await screen.findByText('Review streaming subscriptions');
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    await user.type(screen.getByRole('spinbutton', { name: /actual monthly savings/i }), '95');
    await user.type(screen.getByRole('textbox', { name: /^note$/i }), 'Cancelled after checking usage');
    await user.click(screen.getByRole('button', { name: /save outcome/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/api/optimizer/recommendations/12/status', {
        status: 'done',
        userNote: 'Cancelled after checking usage',
        realizedMonthlySavings: 95,
      });
    });
    expect(await screen.findByText('Realized: ₪95')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('loads plan history only when its tab is opened', async () => {
    const user = userEvent.setup();
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/api/optimizer/history?limit=20') {
        return {
          ok: true,
          data: {
            runs: [{
              id: 8,
              runUuid: 'run-8',
              status: 'complete',
              promptVersion: 'optimizer-v1',
              model: 'gpt-4o-mini',
              generatedAt: '2026-08-02T10:00:00.000Z',
              errorMessage: null,
              recommendationCount: 3,
              activeCount: 1,
              doneCount: 2,
              dismissedCount: 0,
              estimatedMonthlyImpact: 320,
              realizedMonthlySavings: 185,
            }],
          },
        };
      }
      return { ok: true, data: statusPayload };
    });
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));
    await screen.findByText('Bills location');
    expect(mockGet).not.toHaveBeenCalledWith('/api/optimizer/history?limit=20');

    await user.click(screen.getByRole('tab', { name: /^history$/i }));

    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('3 actions')).toBeInTheDocument();
    expect(screen.getByText('+₪185')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/api/optimizer/history?limit=20');
  });
});
