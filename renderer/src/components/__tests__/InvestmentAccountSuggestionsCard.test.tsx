import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import InvestmentAccountSuggestionsCard from '../InvestmentAccountSuggestionsCard';

const mockGet = vi.fn();
const mockPost = vi.fn();
const showNotification = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('../NotificationContext', () => ({
  useNotification: () => ({ showNotification }),
}));

const baseSuggestion = {
  categoryName: 'IBI Brokerage',
  suggestedAccountType: 'brokerage',
  suggestedInstitution: 'IBI',
  suggestedAccountName: 'IBI Brokerage',
  avgConfidence: 0.92,
  transactions: [
    {
      transactionIdentifier: 'txn-1',
      transactionVendor: 'IBI',
      transactionDate: '2024-10-10',
      transactionAmount: 5000,
      transactionName: 'IBI Deposit',
    },
    {
      transactionIdentifier: 'txn-2',
      transactionVendor: 'IBI',
      transactionDate: '2024-10-12',
      transactionAmount: 4500,
      transactionName: 'IBI Deposit 2',
    },
  ],
  totalAmount: 9500,
  transactionCount: 2,
  dateRange: {
    earliest: '2024-10-10',
    latest: '2024-10-12',
  },
};

const investmentAccountsResponse = {
  accounts: [
    {
      id: 101,
      account_name: 'IBI Brokerage Master',
      account_type: 'brokerage',
      institution: 'IBI',
      current_value: 200000,
      currency: 'ILS',
    },
  ],
};

const suggestionsResponse = {
  success: true,
  suggestions: [baseSuggestion],
};

const setupSuccessfulGetMocks = () => {
  mockGet.mockImplementation((endpoint: string) => {
    if (endpoint.startsWith('/api/investments/smart-suggestions')) {
      return Promise.resolve({ data: suggestionsResponse });
    }
    if (endpoint === '/api/investments/accounts') {
      return Promise.resolve({ data: investmentAccountsResponse });
    }
    return Promise.resolve({ data: {} });
  });
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  showNotification.mockReset();
  setupSuccessfulGetMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InvestmentAccountSuggestionsCard', () => {
  it('links suggestion transactions to an existing account', async () => {
    mockPost.mockResolvedValue({ ok: true });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const onSuggestionCreated = vi.fn();

    render(<InvestmentAccountSuggestionsCard onSuggestionCreated={onSuggestionCreated} />);

    await screen.findByText(/Smart Suggestions \(1\)/i);

    fireEvent.click(screen.getByRole('button', { name: /link/i }));
    const menuItem = await screen.findByText('IBI Brokerage Master');
    fireEvent.click(menuItem);

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(mockPost).toHaveBeenCalledWith('/api/investments/transaction-links', expect.objectContaining({
      transaction_identifier: 'txn-1',
      account_id: 101,
    }));
    expect(showNotification).toHaveBeenCalledWith('Successfully linked 2 transactions to account', 'success');
    expect(onSuggestionCreated).toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
  });

  it('dismisses a suggestion and hides the card', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as unknown as Response);

    render(<InvestmentAccountSuggestionsCard />);

    await screen.findByText(/Smart Suggestions \(1\)/i);

    const dismissButton = screen.getByLabelText(/dismiss suggestion/i);
    fireEvent.click(dismissButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(showNotification).toHaveBeenCalledWith('Suggestion dismissed', 'info');
    await waitFor(() => expect(screen.queryByText(/Smart Suggestions/i)).not.toBeInTheDocument());
  });

  it('notifies parent when create account is clicked', async () => {
    const onCreateAccountClick = vi.fn();
    render(<InvestmentAccountSuggestionsCard onCreateAccountClick={onCreateAccountClick} />);

    await screen.findByText(/Smart Suggestions \(1\)/i);

    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(onCreateAccountClick).toHaveBeenCalledWith(expect.objectContaining({
      suggestedAccountName: 'IBI Brokerage',
    }));
  });
});
