import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatementImportDialog from '../components/StatementImportDialog';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) },
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${value.toFixed(2)}` }),
}));

// Synthetic card export.
const CSV = [
  'תאריך עסקה,שם בית העסק,סכום חיוב',
  '05/03/2026,סופר לדוגמה,120.50',
  '06/03/2026,קפה,18',
  ',סה"כ,138.50',
].join('\n');

const previewResponse = {
  target: { vendor: 'max', nickname: 'Card', isBank: false, accountNumber: '0000', accountNumberOptions: ['0000'] },
  summary: { total: 2, new: 1, duplicates: 1, invalid: 0, firstDate: '2026-03-05', lastDate: '2026-03-06' },
  rows: [
    { index: 0, status: 'duplicate', match: { date: '2026-03-05', name: 'SUPER EXAMPLE', status: 'completed' } },
    { index: 1, status: 'new' },
  ],
};

function renderDialog() {
  const props = {
    open: true,
    account: { id: 9, nickname: 'Card', vendor: 'max' },
    isBank: false,
    onClose: vi.fn(),
    onImported: vi.fn(),
  };
  render(<StatementImportDialog {...props} />);
  return props;
}

async function uploadCsv() {
  fireEvent.change(screen.getByTestId('statement-file-input'), {
    target: { files: [new File([CSV], 'statement.csv', { type: 'text/csv' })] },
  });
  await screen.findByText('map.found {"count":2,"skipped":1}');
}

describe('StatementImportDialog', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('parses the file, flags duplicates on review and imports new rows plus ticked duplicates', async () => {
    postMock
      .mockResolvedValueOnce({ ok: true, status: 200, data: previewResponse })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { requested: 2, inserted: 2, skippedDuplicates: 0, invalid: 0 } });
    const props = renderDialog();

    await uploadCsv();
    // Card statements list purchases as positive; the ledger stores them as spending.
    expect(screen.getByText('₪-120.50')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'actions.check' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith('/api/statement-import/preview', {
      credentialId: 9,
      accountNumber: null,
      rows: [
        { date: '2026-03-05', description: 'סופר לדוגמה', amount: -120.5 },
        { date: '2026-03-06', description: 'קפה', amount: -18 },
      ],
    });

    expect(await screen.findByRole('button', { name: 'actions.import {"count":1}' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'review.duplicates {"count":1}' }));
    expect(screen.getByText('review.matches {"name":"SUPER EXAMPLE","date":"2026-03-05"}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'table.importAnyway' }));

    fireEvent.click(screen.getByRole('button', { name: 'actions.import {"count":2}' }));
    await waitFor(() => expect(props.onImported).toHaveBeenCalledWith({ requested: 2, inserted: 2, skippedDuplicates: 0, invalid: 0 }));
    expect(postMock).toHaveBeenLastCalledWith(
      '/api/statement-import/commit',
      expect.objectContaining({ credentialId: 9, accountNumber: '0000', includeDuplicateIndexes: [0] }),
      { timeoutMs: 120000 },
    );
    expect(screen.getByText('done.imported {"count":2}')).toBeInTheDocument();
  });

  it('shows the server error message for known codes', async () => {
    postMock.mockResolvedValueOnce({ ok: false, status: 400, data: { code: 'too_many_rows', error: 'x' } });
    renderDialog();

    await uploadCsv();
    fireEvent.click(screen.getByRole('button', { name: 'actions.check' }));

    expect(await screen.findByText('serverErrors.too_many_rows')).toBeInTheDocument();
  });

  it('reports a file that cannot be read', async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('statement-file-input'), {
      target: { files: [new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], 'broken.xlsx')] },
    });

    expect(await screen.findByText(/fileErrors\.(unreadable|empty)/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });
});
