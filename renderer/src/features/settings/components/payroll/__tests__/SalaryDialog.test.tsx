import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SalaryDialog from '../SalaryDialog';
import { PayrollMemberView, PayrollSetup, SalaryCandidate } from '../payroll-model';

const apiGet = vi.fn();
const apiPut = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${Math.round(value)}` }),
}));

const setup: PayrollSetup = {
  members: [],
  accounts: [
    { id: 7, account_name: 'Harel Pension', account_type: 'pension', institution: 'Harel' },
    { id: 8, account_name: 'Clal KH', account_type: 'provident', institution: 'Clal' },
  ],
  defaults: {
    plans: {
      pension: { employee_pct: 6, employer_pct: 6.5, salary_cap: null },
      severance: { employee_pct: 0, employer_pct: 6, salary_cap: null },
      keren_hishtalmut: { employee_pct: 2.5, employer_pct: 7.5, salary_cap: 15712 },
    },
    preferredAccountTypes: { pension: ['pension'], severance: ['pension'], keren_hishtalmut: ['provident'] },
  },
};

const emptyView: PayrollMemberView = {
  member: 'self',
  displayName: 'Avner',
  available: true,
  employment: null,
  plans: [],
  breakdown: { items: [], totals: { employee: 0, employer: 0, total: 0 } },
};

const candidates: SalaryCandidate[] = [
  {
    key: 'hapoalim|111|משכורת אינטל',
    name: 'משכורת אינטל 10/26',
    vendor: 'hapoalim',
    vendorNickname: 'Main',
    accountNumber: '111',
    match: { salary_match_pattern: 'משכורת אינטל', salary_match_vendor: 'hapoalim', salary_match_account_number: '111' },
    monthCount: 3,
    depositCount: 3,
    medianAmount: 18100,
    lastDate: '2026-10-01',
    looksLikeSalary: true,
    claimedBy: null,
  },
  {
    key: 'leumi|222|wix com ltd',
    name: 'WIX COM LTD',
    vendor: 'leumi',
    vendorNickname: null,
    accountNumber: '222',
    match: { salary_match_pattern: 'wix com ltd', salary_match_vendor: 'leumi', salary_match_account_number: '222' },
    monthCount: 2,
    depositCount: 2,
    medianAmount: 14000,
    lastDate: '2026-10-10',
    looksLikeSalary: false,
    claimedBy: 'spouse',
  },
];

function renderDialog(onSaved = vi.fn()) {
  render(
    <SalaryDialog
      open
      view={emptyView}
      setup={setup}
      memberLabel="Avner"
      memberLabels={{ self: 'Avner', spouse: 'Dana' }}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

describe('SalaryDialog', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    apiGet.mockResolvedValue({ ok: true, data: { candidates } });
  });

  it('previews monthly contributions from the gross salary', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('dialog.gross'), { target: { value: '20000' } });
    expect(screen.getByTestId('payroll-preview').textContent)
      .toContain('"total":"₪5271","employee":"₪1593","employer":"₪3678"');
    expect(within(screen.getByTestId('payroll-plan-keren_hishtalmut')).getByText(/₪1571/)).toBeTruthy();
  });

  it('suggests the unclaimed salary deposit and saves the full payload', async () => {
    apiPut.mockResolvedValue({ ok: true, data: { ...emptyView, employment: { id: 1 } } });
    const { onSaved } = renderDialog();
    await waitFor(() => expect(screen.getByText(/משכורת אינטל 10\/26/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText('dialog.employer'), { target: { value: 'Intel' } });
    fireEvent.change(screen.getByLabelText('dialog.gross'), { target: { value: '20000' } });
    fireEvent.click(screen.getByText('dialog.save'));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [url, body] = apiPut.mock.calls[0];
    expect(url).toBe('/api/payroll/self');
    expect(body).toMatchObject({
      employer_name: 'Intel',
      gross_monthly: 20000,
      salary_match_pattern: 'משכורת אינטל',
      salary_match_vendor: 'hapoalim',
      salary_match_account_number: '111',
    });
    expect(body.plans.map((plan: any) => [plan.kind, plan.account_id, plan.is_active])).toEqual([
      ['pension', 7, 1],
      ['severance', 7, 1],
      ['keren_hishtalmut', 8, 1],
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('cannot save without a gross salary', () => {
    renderDialog();
    expect((screen.getByText('dialog.save').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables deposits already linked to the other member', async () => {
    renderDialog();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'dialog.deposit' }));
    const claimed = await screen.findByRole('option', { name: /WIX COM LTD/ });
    expect(claimed.getAttribute('aria-disabled')).toBe('true');
    expect(claimed.textContent).toContain('"member":"Dana"');
  });

  it('shows the server error when saving fails', async () => {
    apiPut.mockResolvedValue({ ok: false, statusText: 'Bad Request', data: { error: 'gross_monthly must be a number' } });
    renderDialog();
    fireEvent.change(screen.getByLabelText('dialog.gross'), { target: { value: '20000' } });
    fireEvent.click(screen.getByText('dialog.save'));
    expect(await screen.findByText(/gross_monthly must be a number/)).toBeTruthy();
  });

  it('shows when the keren hishtalmut becomes withdrawable and saves the opening date', async () => {
    apiPut.mockResolvedValue({ ok: true, data: emptyView });
    renderDialog();
    const opened = screen.getByLabelText('dialog.openedDate');
    fireEvent.change(opened, { target: { value: '2019-07-15' } });
    expect(screen.getByTestId('payroll-opened-date').textContent).toContain('2025');
    fireEvent.change(screen.getByLabelText('dialog.gross'), { target: { value: '20000' } });
    fireEvent.click(screen.getByText('dialog.save'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const kh = apiPut.mock.calls[0][1].plans.find((plan: any) => plan.kind === 'keren_hishtalmut');
    expect(kh).toMatchObject({ opened_date: '2019-07-15' });
    expect(kh).not.toHaveProperty('withdrawable_from');
  });
});
