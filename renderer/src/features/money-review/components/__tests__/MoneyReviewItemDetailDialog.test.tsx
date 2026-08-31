import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MoneyReviewItem } from '../../types';
import MoneyReviewItemDetailDialog from '../MoneyReviewItemDetailDialog';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${value}` }),
}));

vi.mock('@renderer/features/financial-truth/useFinancialTruth', () => ({
  useFinancialTruth: () => ({ busy: false, error: null, lastCorrection: null, revert: vi.fn() }),
}));

vi.mock('@renderer/features/financial-truth/FinancialCorrectionDialog', () => ({
  default: ({ open, onApplied }: { open: boolean; onApplied?: () => void }) => open ? (
    <button type="button" onClick={() => onApplied?.()}>Apply mocked correction</button>
  ) : null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'detail.close': 'Close item',
        'detail.whyTitle': 'Why this appeared',
        'detail.priorityTitle': 'Why it is prioritized',
        'detail.priorityDescription': 'Priority details',
        'detail.priorityAria': `Priority ${options?.score}`,
        'groups.cash.title': 'Protect your cash',
        'priority.high': 'High priority',
        'financialTruth.notAccurate': 'Not accurate',
      };
      return labels[key] || key;
    },
  }),
}));

const item: MoneyReviewItem = {
  id: 41,
  source: 'subscription',
  sourceKey: 'money_review:subscription:41',
  group: 'cash',
  actionType: 'fixed_recurring_change',
  severity: 'high',
  title: 'Cloud charge changed',
  description: 'The recurring charge increased.',
  status: 'active',
  detectedAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  snoozedUntil: null,
  potentialImpact: 12,
  confidence: 0.9,
  priority: 82,
  primaryAction: null,
  metadata: {
    source: 'subscription',
    patternId: 9,
    correctionCapabilities: ['suppress_pattern', 'override_pattern'],
    data: { detected_amount: 52, detected_frequency: 'monthly' },
  },
};

describe('MoneyReviewItemDetailDialog', () => {
  it('resolves the originating review item after a financial correction is applied', async () => {
    const onClose = vi.fn();
    const onUpdateStatus = vi.fn().mockResolvedValue(true);
    render(
      <MoneyReviewItemDetailDialog
        open
        item={item}
        loading={false}
        busy={false}
        onClose={onClose}
        onPrimaryAction={vi.fn()}
        onUpdateStatus={onUpdateStatus}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not accurate' }));
    fireEvent.click(await screen.findByText('Apply mocked correction'));

    await waitFor(() => expect(onUpdateStatus).toHaveBeenCalledWith(item, 'resolved'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
