export interface PortfolioBreakdownItem {
  name: string;
  value: number;
  percentage: number;
  category: string;
}

export interface InvestmentSummaryTotals {
  totalPortfolioValue?: number;
  liquid?: { totalValue?: number };
  restricted?: { totalValue?: number };
}

export interface InvestmentBreakdownEntry {
  category: string;
  name?: string;
  type?: string;
  totalValue: number;
}

export interface InvestmentSummaryResponse {
  summary?: InvestmentSummaryTotals | null;
  breakdown?: InvestmentBreakdownEntry[] | null;
}

export interface InvestmentData {
  summary: {
    totalMovement: number;
    investmentOutflow: number;
    investmentInflow: number;
    netInvestments: number;
    totalCount: number;
  };
  byCategory: Array<{
    name: string;
    name_en: string;
    name_fr?: string;
    total: number;
    count: number;
    outflow: number;
    inflow: number;
  }>;
  timeline: Array<{
    month: string;
    outflow: number;
    inflow: number;
    net: number;
    count: number;
  }>;
  transactions: Array<{
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    category_name?: string;
    category_name_en?: string;
    category_name_fr?: string;
    parent_name?: string;
    parent_name_en?: string;
    parent_name_fr?: string;
    account_number?: string;
  }>;
}

export interface PortfolioHistoryPoint {
  date: string;
  currentValue: number;
  costBasis: number;
  gainLoss?: number;
}

export interface InvestmentAccountAsset {
  asset_name: string;
  asset_type?: string;
  units?: number;
  current_value?: number;
  cost_basis?: number;
}

export interface InvestmentAccountSummary {
  id: number;
  account_name: string;
  account_type: string;
  institution?: string | null;
  investment_category?: string | null;
  currency: string;
  current_value: number;
  cost_basis: number;
  as_of_date?: string | null;
  current_value_explicit?: number | null;
  account_value_history?: PortfolioHistoryPoint[];
  assets?: InvestmentAccountAsset[];
}

export interface PortfolioBreakdownGroup {
  type: string;
  name: string;
  name_he: string;
  totalValue: number;
  totalCost: number;
  count: number;
  percentage: number;
  accounts: InvestmentAccountSummary[];
}

export interface PortfolioSummary {
  summary: {
    totalPortfolioValue: number;
    totalCostBasis: number;
    unrealizedGainLoss: number;
    roi: number;
    totalAccounts: number;
    accountsWithValues: number;
    newestUpdateDate: string | null;
    liquid: {
      totalValue: number;
      totalCost: number;
      unrealizedGainLoss: number;
      roi: number;
      accountsCount: number;
    };
    restricted: {
      totalValue: number;
      totalCost: number;
      unrealizedGainLoss: number;
      roi: number;
      accountsCount: number;
    };
  };
  breakdown: PortfolioBreakdownGroup[];
  timeline: PortfolioHistoryPoint[];
  accounts: InvestmentAccountSummary[];
  liquidAccounts: InvestmentAccountSummary[];
  restrictedAccounts: InvestmentAccountSummary[];
}

export interface PortfolioHistoryResponse {
  history?: PortfolioHistoryPoint[];
  accounts?: Array<{
    accountId: number;
    history?: PortfolioHistoryPoint[];
  }>;
}

// Pikadon (Term Deposit) Types

export interface PikadonHolding {
  id: number;
  account_id: number;
  account_name: string;
  account_type?: string;
  institution?: string;
  currency?: string;
  cost_basis: number;
  current_value: number;
  interest_earned: number;
  interest_rate: number | null;
  as_of_date: string;
  maturity_date: string | null;
  status: 'active' | 'matured' | 'rolled_over';
  deposit_transaction_id: string | null;
  deposit_transaction_vendor: string | null;
  return_transaction_id: string | null;
  return_transaction_vendor: string | null;
  parent_pikadon_id: number | null;
  notes?: string;
}

export interface PikadonSummary {
  total_count: number;
  active_count: number;
  matured_count: number;
  rolled_over_count: number;
  active_principal: number;
  total_principal: number;
  total_interest_earned: number;
  avg_interest_rate: number;
}

export interface UpcomingMaturity {
  id: number;
  account_name: string;
  cost_basis: number;
  current_value: number;
  maturity_date: string;
}

export interface PikadonSummaryResponse {
  summary: PikadonSummary;
  upcoming_maturities: UpcomingMaturity[];
}

export interface PikadonMaturityBreakdown {
  id: number;
  account_name: string;
  institution?: string;
  deposit_date: string;
  maturity_date: string;
  status: 'matured' | 'rolled_over';
  // Core breakdown
  principal_returned: number;
  interest_earned: number;
  total_return: number;
  // Rollover info
  is_rolled_over: boolean;
  child_pikadon_id: number | null;
  new_deposit: number | null;
  interest_reinvested: number | null;
  interest_withdrawn: number;
}

export interface PikadonMaturityBreakdownResponse {
  maturities: PikadonMaturityBreakdown[];
  totals: {
    total_principal_returned: number;
    total_interest_earned: number;
    total_return: number;
    total_new_deposits: number;
    total_interest_reinvested: number;
    total_interest_withdrawn: number;
    count: number;
  };
}

export interface PikadonRolloverResult {
  rollover: {
    old_pikadon_id: number;
    new_pikadon_id: number;
    old_principal: number;
    interest_earned: number;
    return_amount: number;
    new_principal: number;
    interest_reinvested: number;
    interest_withdrawn: number;
  };
  old_pikadon: PikadonHolding;
  new_pikadon: PikadonHolding;
}

export interface PikadonChainSummary {
  chain_length: number;
  original_principal: number;
  current_principal: number;
  total_interest_earned: number;
  principal_growth: number;
}

export interface PikadonChainResponse {
  chain: (PikadonHolding & { is_current?: boolean })[];
  summary: PikadonChainSummary;
}

export interface RolloverSuggestion {
  original_deposit: {
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    account_number?: string;
  };
  original_deposit_amount: number;
  return_transaction: {
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    account_number?: string;
  };
  return_amount: number;
  interest_earned: number;
  potential_rollovers: Array<{
    new_deposit_transaction: {
      identifier: string;
      vendor: string;
      date: string;
      name: string;
      price: number;
      account_number?: string;
    };
    new_deposit_amount: number;
    new_deposit_date: string;
    days_after_return: number;
    interest_reinvested: number;
    interest_withdrawn: number;
    confidence: number;
  }>;
  best_rollover: {
    new_deposit_transaction: {
      identifier: string;
      vendor: string;
      date: string;
      name: string;
      price: number;
      account_number?: string;
    };
    new_deposit_amount: number;
    new_deposit_date: string;
    days_after_return: number;
    interest_reinvested: number;
    interest_withdrawn: number;
    confidence: number;
  } | null;
}

export interface PikadonDetectResponse {
  suggestions: Array<{
    deposit_transaction: {
      identifier: string;
      vendor: string;
      date: string;
      name: string;
      price: number;
      account_number?: string;
    };
    deposit_amount: number;
    deposit_date: string;
    potential_returns: Array<{
      return_transaction: {
        identifier: string;
        vendor: string;
        date: string;
        name: string;
        price: number;
        account_number?: string;
      };
      return_amount: number;
      interest_earned: number;
      interest_rate: number;
      confidence: number;
    }>;
    best_match: {
      return_transaction: {
        identifier: string;
        vendor: string;
        date: string;
        name: string;
        price: number;
        account_number?: string;
      };
      return_amount: number;
      interest_earned: number;
      interest_rate: number;
      confidence: number;
    } | null;
  }>;
  rollover_suggestions: RolloverSuggestion[];
  unmatched_deposits: number;
  unmatched_returns: number;
  orphan_returns: Array<{
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    account_number?: string;
  }>;
}

// Event-based auto-detection types
export interface PikadonTransaction {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  account_number?: string;
  amount?: number;
}

export interface PikadonMaturityEvent {
  date: string;
  principal_returned: number;
  interest_earned: number;
  tax_paid: number;
  net_received: number;
  rolled_over: boolean;
  new_deposit_amount: number;
  cash_flow: number;
  transactions: PikadonTransaction[];
  deposit_transactions: PikadonTransaction[];
  return_transactions: PikadonTransaction[];
  interest_transactions: PikadonTransaction[];
  tax_transactions: PikadonTransaction[];
}

export interface PikadonDepositEvent {
  date: string;
  amount: number;
  name: string;
  transaction: PikadonTransaction;
  type: 'recurring' | 'liquid' | 'fixed_term' | 'variable' | 'other';
}

export interface PikadonChain {
  start_deposit: PikadonDepositEvent;
  maturity_event: PikadonMaturityEvent;
  rollover_deposit: PikadonDepositEvent | null;
  interest_earned: number;
  tax_paid: number;
  net_gain: number;
}

export interface PikadonAutoDetectResponse {
  maturity_events: PikadonMaturityEvent[];
  deposit_events: PikadonDepositEvent[];
  chains: PikadonChain[];
  active_deposits: PikadonDepositEvent[];
  totals: {
    total_interest_earned: number;
    total_tax_paid: number;
    total_principal_returned: number;
    maturity_count: number;
    active_deposits: PikadonDepositEvent[];
    total_active_principal: number;
  };
}

export interface PikadonAutoSetupResponse {
  created: number;
  message?: string;
  details?: Array<{
    id: number;
    type: 'matured' | 'active_rollover' | 'active_standalone';
    amount: number;
    interest?: number;
    date: string;
    parent_id?: number;
  }>;
  totals?: {
    total_interest_earned: number;
    total_tax_paid: number;
    total_principal_returned: number;
    maturity_count: number;
    active_deposits: PikadonDepositEvent[];
    total_active_principal: number;
  };
}
