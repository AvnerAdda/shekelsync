import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FinancialOptimizer from '../components/FinancialOptimizer';

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
    render(<FinancialOptimizer />);

    await user.click(screen.getByLabelText('Optimizator'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/optimizer/status');
    });
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
  });

  it('skips a quiz question', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: 'Optimizator' }));
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
});
