import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RealEstateAccountMergeDialog from '../RealEstateAccountMergeDialog';
import en from '@renderer/i18n/locales/en.json';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { post } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, values?: { value?: string }) => {
      const text = (en.accountsModal.realEstateMerge as Record<string, string>)[key];
      return text.replace('{{value}}', values?.value || '');
    },
  }),
}));

const accounts = [
  { id: 9, account_type: 'real_estate', account_name: 'נדל"ן', currency: 'ILS', current_value: 500000 },
  { id: 10, account_type: 'real_estate', account_name: 'נדל"ן', currency: 'ILS', current_value: 1250.25 },
  { id: 11, account_type: 'real_estate', account_name: 'נדל"ן', currency: 'ILS', current_value: 2500.75 },
  { id: 12, account_type: 'real_estate', account_name: 'Other property', currency: 'USD', current_value: 5000 },
];

describe('real estate account merge dialog', () => {
  beforeEach(() => post.mockReset());

  it('previews the total and merges the selected entries into the keeper', async () => {
    post.mockResolvedValue({ ok: true });
    const onMerged = vi.fn();
    render(<RealEstateAccountMergeDialog account={accounts[0]} accounts={accounts} onClose={vi.fn()} onMerged={onMerged} />);
    expect(screen.getByText('Combined current value: ILS 503,751')).toBeInTheDocument();
    expect(screen.queryByText(/Other property/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Merge accounts' }));
    await waitFor(() => expect(onMerged).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/investments/accounts/merge', {
      target_account_id: 9, source_account_ids: [10, 11],
    });
  });

  it('updates the preview and prevents merging with no sources', () => {
    render(<RealEstateAccountMergeDialog account={accounts[0]} accounts={accounts} onClose={vi.fn()} onMerged={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')[0]).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByText('Combined current value: ILS 502,500.75')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox')[2]);
    expect(screen.getByRole('button', { name: 'Merge accounts' })).toBeDisabled();
  });

  it('keeps the dialog open on validation failure', async () => {
    post.mockResolvedValue({ ok: false, data: { error: 'Keep the account with the property profile' } });
    const onMerged = vi.fn();
    render(<RealEstateAccountMergeDialog account={accounts[0]} accounts={accounts} onClose={vi.fn()} onMerged={onMerged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Merge accounts' }));
    expect(await screen.findByText('Keep the account with the property profile')).toBeInTheDocument();
    expect(onMerged).not.toHaveBeenCalled();
  });
});
