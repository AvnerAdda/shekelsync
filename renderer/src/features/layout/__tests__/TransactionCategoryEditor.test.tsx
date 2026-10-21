import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancePrivacyProvider, useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import TransactionDeleteDialog from '@renderer/shared/modals/TransactionDeleteDialog';
import DeleteTransactionButton, { TRANSACTION_DELETED_EVENT, OPEN_TRANSACTION_DELETE_EVENT } from '@renderer/shared/components/DeleteTransactionButton';
import TransactionActions from '@renderer/shared/components/TransactionActions';
import TransactionCategoryEditor from '@renderer/shared/modals/TransactionCategoryEditor';
import TransactionDetailModal from '@renderer/shared/modals/TransactionDetailModal';
import EditTransactionCategoryButton, { CATEGORY_UPDATED_EVENT } from '@renderer/shared/components/EditTransactionCategoryButton';

const { get, put, post, remove, invalidate } = vi.hoisted(() => ({
  get: vi.fn(), put: vi.fn(), post: vi.fn(), remove: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get, put, post, delete: remove }, invalidateApiCache: invalidate }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get, put, post, delete: remove }, invalidateApiCache: invalidate }));
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
  window.localStorage.removeItem('finance-mask-amounts');
  get.mockImplementation(async (path: string) => ({ ok: true, data: path === '/api/categories/hierarchy'
    ? { categories } : path === '/api/transactions/tags' ? ['work'] : transaction }));
  put.mockResolvedValue({ ok: true, data: { success: true } });
  post.mockResolvedValue({ ok: true, data: { success: true } });
  remove.mockResolvedValue({ ok: true, data: { success: true } });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem('finance-mask-amounts');
});

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


async function openDelete() {
  const user = userEvent.setup();
  render(<FinancePrivacyProvider locale="en"><TransactionActions transaction={transaction} /><TransactionDeleteDialog /></FinancePrivacyProvider>);
  await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
  await screen.findByText(transaction.name);
  return user;
}

describe('shared transaction deletion', () => {
  it('masks amounts when privacy is enabled and reacts to privacy changes while open', async () => {
    window.localStorage.setItem('finance-mask-amounts', 'true');
    function PrivacyControl() {
      const { toggleMaskAmounts } = useFinancePrivacy();
      return <button onClick={toggleMaskAmounts}>Toggle amount privacy</button>;
    }
    const user = userEvent.setup();
    render(
      <FinancePrivacyProvider locale="en">
        <PrivacyControl />
        <TransactionActions transaction={transaction} />
        <TransactionDeleteDialog />
      </FinancePrivacyProvider>,
    );
    const privacyControl = screen.getByRole('button', { name: 'Toggle amount privacy' });
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await screen.findByText(transaction.name);
    expect(screen.getByText('-₪***')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('35');

    fireEvent.click(privacyControl);
    expect(screen.getByText('-₪35.00')).toBeInTheDocument();
    fireEvent.click(privacyControl);
    expect(screen.getByText('-₪***')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('35');
    expect(remove).not.toHaveBeenCalled();
  });

  it('confirms the exact transaction, deletes once, and refreshes the affected views', async () => {
    const deleted = vi.fn();
    const refresh = vi.fn();
    window.addEventListener(TRANSACTION_DELETED_EVENT, deleted);
    window.addEventListener('dataRefresh', refresh);
    try {
      const user = await openDelete();
      expect(get).toHaveBeenCalledWith(url, { cacheMode: 'no-store' });
      expect(screen.getByText('2026-09-20 · bank-a')).toBeInTheDocument();
      expect(screen.getByText(/35[.,]00/)).toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Delete', exact: true }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(remove).toHaveBeenCalledExactlyOnceWith(url);
      expect(invalidate).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
      expect(deleted.mock.calls[0][0].detail).toEqual({ identifier: transaction.identifier, vendor: transaction.vendor });
    } finally {
      window.removeEventListener(TRANSACTION_DELETED_EVENT, deleted);
      window.removeEventListener('dataRefresh', refresh);
    }
  });

  it.each(['cancel', 'escape', 'backdrop', 'enter'])('cancels with %s without deleting anything', async action => {
    const user = await openDelete();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    if (action === 'cancel') await user.click(screen.getByRole('button', { name: 'Cancel' }));
    else if (action === 'escape') await user.keyboard('{Escape}');
    else if (action === 'enter') await user.keyboard('{Enter}');
    else {
      const backdrop = screen.getByRole('dialog').parentElement!;
      fireEvent.mouseDown(backdrop);
      fireEvent.click(backdrop);
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(remove).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('keeps failed deletions open and supports an explicit retry', async () => {
    remove.mockResolvedValueOnce({ ok: false });
    const user = await openDelete();
    await user.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete the transaction');
    expect(invalidate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('blocks deletion until the transaction loads and lets a failed load retry', async () => {
    get.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    render(<FinancePrivacyProvider locale="en"><DeleteTransactionButton transaction={transaction} /><TransactionDeleteDialog /></FinancePrivacyProvider>);
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the transaction');
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(transaction.name);
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('prevents duplicate writes, dismissal, and target replacement while deletion is pending', async () => {
    let complete!: (value: { ok: boolean }) => void;
    remove.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const user = await openDelete();
    const button = screen.getByRole('button', { name: 'Delete', exact: true });
    fireEvent.click(button);
    fireEvent.click(button);
    act(() => window.dispatchEvent(new CustomEvent(OPEN_TRANSACTION_DELETE_EVENT, { detail: { identifier: 'other', vendor: 'other-bank' } })));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(remove).toHaveBeenCalledExactlyOnceWith(url);
    await act(async () => complete({ ok: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not open the surrounding row on mouse or keyboard interaction', () => {
    const openRow = vi.fn();
    render(<div role="button" tabIndex={0} onClick={openRow} onKeyDown={openRow}><DeleteTransactionButton transaction={transaction} /></div>);
    const button = screen.getByRole('button', { name: 'Delete transaction' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });
    expect(openRow).not.toHaveBeenCalled();
  });

  it('closes transaction details only when their exact transaction is deleted', async () => {
    const close = vi.fn();
    render(<TransactionDetailModal open onClose={close} transaction={transaction} />);
    await screen.findByPlaceholderText('Add notes about this transaction...');
    act(() => window.dispatchEvent(new CustomEvent(TRANSACTION_DELETED_EVENT, { detail: { identifier: transaction.identifier, vendor: 'another-bank' } })));
    expect(close).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new CustomEvent(TRANSACTION_DELETED_EVENT, { detail: transaction })));
    expect(close).toHaveBeenCalledOnce();
  });
});
