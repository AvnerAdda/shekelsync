import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionCategoryEditor from '@renderer/shared/modals/TransactionCategoryEditor';
import TransactionDetailModal from '@renderer/shared/modals/TransactionDetailModal';
import EditTransactionCategoryButton, { CATEGORY_UPDATED_EVENT } from '@renderer/shared/components/EditTransactionCategoryButton';

const { get, put, post, invalidate } = vi.hoisted(() => ({
  get: vi.fn(), put: vi.fn(), post: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get, put, post }, invalidateApiCache: invalidate }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get, put, post }, invalidateApiCache: invalidate }));
const translation = { t: (key: string, fallback?: string) => fallback || key, i18n: { language: 'en' } };
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));

const transaction = {
  identifier: 'bank/id 1', vendor: 'bank-a', name: 'Coffee shop', price: -35,
  category_definition_id: 1, category_type: 'expense', category_name: 'Food', parent_name: null,
  memo: 'Keep this note', tags: ['work'], date: '2026-09-20', processed_date: null,
  account_number: null, type: null, status: null,
};
const categories = [
  { id: 1, name: 'Food', name_en: 'Food', parent_id: null, category_type: 'expense' },
  { id: 2, name: 'Investments', parent_id: null, category_type: 'investment' },
  { id: 3, name: 'Funds', parent_id: 2, category_type: 'investment' },
  { id: 4, name: 'Index', parent_id: 3, category_type: 'investment' },
];
const url = '/api/transactions/bank%2Fid%201%7Cbank-a';

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) => ({ ok: true, data: path === '/api/categories/hierarchy'
    ? { categories } : path === '/api/transactions/tags' ? ['work'] : transaction }));
  put.mockResolvedValue({ ok: true, data: { success: true } });
  post.mockResolvedValue({ ok: true, data: { success: true } });
});
afterEach(() => vi.restoreAllMocks());

async function openEditor() {
  const user = userEvent.setup();
  render(<><EditTransactionCategoryButton transaction={transaction} /><TransactionCategoryEditor /></>);
  await user.click(screen.getByRole('button', { name: 'Edit category' }));
  await screen.findByRole('combobox', { name: 'Category' });
  return user;
}

async function chooseInvestment(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByRole('combobox', { name: 'Category' });
  await user.clear(input);
  await user.type(input, 'Index');
  await user.click(await screen.findByRole('option', { name: 'Investments › Funds › Index' }));
}

describe('shared transaction category editor', () => {
  it('edits only the selected transaction by default and refreshes affected views', async () => {
    const updated = vi.fn();
    const refresh = vi.fn();
    window.addEventListener(CATEGORY_UPDATED_EVENT, updated);
    window.addEventListener('dataRefresh', refresh);
    try {
      const user = await openEditor();
      expect(screen.getByRole('checkbox')).not.toBeChecked();
      expect(get).toHaveBeenCalledWith(url, { cacheMode: 'no-store' });
      await chooseInvestment(user);
      await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
      await waitFor(() => expect(put).toHaveBeenCalledWith(url, {
        category_definition_id: 4, category_type: 'investment', auto_categorized: false, confidence_score: 1,
      }));
      expect(post).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
      expect(updated.mock.calls[0][0].detail).toMatchObject({
        identifier: transaction.identifier, vendor: transaction.vendor,
        category_definition_id: 4, category_type: 'investment', category_name: 'Index', parent_name: 'Funds',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    } finally {
      window.removeEventListener(CATEGORY_UPDATED_EVENT, updated);
      window.removeEventListener('dataRefresh', refresh);
    }
  });

  it('creates a matching-name rule only when explicitly selected, using the target category type', async () => {
    const user = await openEditor();
    await chooseInvestment(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/categorization_rules/auto-create', {
      transactionName: 'Coffee shop', categoryDefinitionId: 4, categoryType: 'investment',
    }));
    expect(put).toHaveBeenCalledOnce();
  });

  it('keeps the editor open on a failed update and allows retry', async () => {
    put.mockResolvedValueOnce({ ok: false });
    const user = await openEditor();
    await chooseInvestment(user);
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update the category');
    expect(invalidate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('reports a partial save accurately when rule creation fails', async () => {
    post.mockResolvedValue({ ok: false });
    const user = await openEditor();
    await chooseInvestment(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByText(/The transaction was updated, but the rule could not be saved/)).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('supports retrying a failed load and cancellation without writes', async () => {
    get.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    render(<><EditTransactionCategoryButton transaction={transaction} /><TransactionCategoryEditor /></>);
    await user.click(screen.getByRole('button', { name: 'Edit category' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByRole('combobox');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not trigger the surrounding transaction row when editing', () => {
    const openTransaction = vi.fn();
    render(<div role="button" tabIndex={0} onClick={openTransaction} onKeyDown={openTransaction}><EditTransactionCategoryButton transaction={transaction} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit category' }));
    expect(openTransaction).not.toHaveBeenCalled();
  });

  it('updates the details category without losing unsaved notes', async () => {
    render(<TransactionDetailModal open onClose={vi.fn()} transaction={transaction} />);
    const memo = await screen.findByPlaceholderText('Add notes about this transaction...');
    fireEvent.change(memo, { target: { value: 'Unsaved note' } });
    act(() => window.dispatchEvent(new CustomEvent(CATEGORY_UPDATED_EVENT, {
      detail: { ...transaction, category_name: 'Index', parent_name: 'Funds', category_definition_id: 4, category_type: 'investment' },
    })));
    expect(await screen.findByText('Funds › Index')).toBeInTheDocument();
    expect(memo).toHaveValue('Unsaved note');
  });
});
