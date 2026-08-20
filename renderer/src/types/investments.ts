export interface PortfolioBreakdownItem {
  name: string;
  value: number;
  percentage: number;
  category: string;
}

export type InvestmentCategoryKey = 'cash' | 'liquid' | 'illiquid' | 'restricted' | 'stability' | 'other';
export type InvestmentInstitution = string | Record<string, unknown> | null;

export interface InvestmentSummaryTotals {
  totalPortfolioValue?: number | null;
  liquid?: { totalValue?: number | null };
  illiquid?: { totalValue?: number | null };
  restricted?: { totalValue?: number | null };
}

export interface InvestmentBreakdownEntry {
  category: string;
  name?: string;
  type?: string;
  totalValue: number | null;
}

export interface InvestmentSummaryResponse {
  summary?: InvestmentSummaryTotals | null;
  breakdown?: InvestmentBreakdownEntry[] | null;
  categoryBuckets?: Partial<Record<InvestmentCategoryKey, PortfolioCategoryBucket>> | null;
  accounts?: InvestmentAccountSummary[] | null;
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
  id?: number;
  account_id?: number;
  asset_symbol?: string | null;
  asset_name: string;
  asset_type?: string;
  units?: number;
  average_cost?: number | null;
  current_price?: number | null;
  current_value?: number;
  cost_basis?: number;
  currency?: string | null;
  valuation_date?: string | null;
  updated_at?: string | null;
  status?: string | null;
}

export interface InvestmentAccountSummary {
  id: number;
  account_name: string;
  account_type: string;
  institution?: InvestmentInstitution;
  investment_category?: InvestmentCategoryKey | null;
  currency: string;
  current_value: number | null;
  cost_basis: number | null;
  native_currency?: string | null;
  native_current_value?: number | null;
  native_cost_basis?: number | null;
  base_currency?: string | null;
  fx_status?: 'exact' | 'prior' | 'identity' | 'missing' | 'stale' | null;
  fx_rate?: number | null;
  fx_rate_date?: string | null;
  as_of_date?: string | null;
  current_value_explicit?: number | null;
  account_value_history?: PortfolioHistoryPoint[];
  assets?: InvestmentAccountAsset[];
}

export interface PortfolioBreakdownGroup {
  type: string;
  name: string;
  name_he: string;
  totalValue: number | null;
  totalCost: number | null;
  count: number;
  percentage: number | null;
  valuationComplete?: boolean;
  costBasisComplete?: boolean;
  accounts: InvestmentAccountSummary[];
}

export interface PortfolioCategoryBucket {
  totalValue: number | null;
  totalCost: number | null;
  unrealizedGainLoss: number | null;
  roi: number | null;
  accountsCount: number;
  valuationComplete?: boolean;
  costBasisComplete?: boolean;
  accounts: InvestmentAccountSummary[];
}

export interface PortfolioSummary {
  summary: {
    totalPortfolioValue: number | null;
    totalCostBasis: number | null;
    unrealizedGainLoss: number | null;
    roi: number | null;
    totalAccounts: number;
    accountsWithValues: number;
    newestUpdateDate: string | null;
    liquid: {
      totalValue: number | null;
      totalCost: number | null;
      unrealizedGainLoss: number | null;
      roi: number | null;
      accountsCount: number;
    };
    illiquid: {
      totalValue: number | null;
      totalCost: number | null;
      unrealizedGainLoss: number | null;
      roi: number | null;
      accountsCount: number;
    };
    restricted: {
      totalValue: number | null;
      totalCost: number | null;
      unrealizedGainLoss: number | null;
      roi: number | null;
      accountsCount: number;
    };
  };
  categoryBuckets: Record<InvestmentCategoryKey, PortfolioCategoryBucket>;
  breakdown: PortfolioBreakdownGroup[];
  timeline: PortfolioHistoryPoint[];
  accounts: InvestmentAccountSummary[];
  liquidAccounts: InvestmentAccountSummary[];
  illiquidAccounts: InvestmentAccountSummary[];
  restrictedAccounts: InvestmentAccountSummary[];
  fx?: {
    baseCurrency: string;
    complete: boolean;
    valuationComplete: boolean;
    costBasisComplete: boolean;
    missingCount: number;
    nativeTotals: Array<{ currency: string; total: number; count: number }>;
    convertedSubtotal: number;
    costBasisNativeTotals?: Array<{ currency: string; total: number; count: number }>;
    costBasisConvertedSubtotal?: number;
    valuation?: {
      complete: boolean;
      missingCount: number;
      nativeTotals: Array<{ currency: string; total: number; count: number }>;
      convertedSubtotal: number;
    };
    costBasis?: {
      complete: boolean;
      missingCount: number;
      nativeTotals: Array<{ currency: string; total: number; count: number }>;
      convertedSubtotal: number;
    };
  } | null;
}

export interface PortfolioHistoryResponse {
  history?: PortfolioHistoryPoint[];
  accounts?: Array<{
    accountId: number;
    history?: PortfolioHistoryPoint[];
  }>;
  fx?: {
    baseCurrency: string;
    complete: boolean;
    missingCount: number;
    missing?: Array<{
      accountId: number;
      date: string;
      currency: string;
      status: string;
    }>;
  } | null;
}

export interface InvestmentBalanceSheetAccount {
  id: number;
  accountName: string;
  accountType: string;
  investmentCategory: string | null;
  currency: string | null;
  currentValue: number | null;
  asOfDate: string | null;
}

export interface InvestmentBalanceSheetBucket {
  totalValue: number | null;
  convertedSubtotal?: number;
  fxComplete?: boolean;
  missingFxCount?: number;
  accountsCount: number;
  accountsWithValue: number;
  missingValueCount: number;
  newestUpdateDate: string | null;
  accounts?: InvestmentBalanceSheetAccount[];
}

export interface InvestmentBalanceSheetResponse {
  generatedAt: string;
  assets: {
    total: number | null;
    convertedSubtotal?: number;
    newestUpdateDate: string | null;
    buckets: {
      cash: InvestmentBalanceSheetBucket;
      liquid: InvestmentBalanceSheetBucket;
      illiquid: InvestmentBalanceSheetBucket;
      restricted: InvestmentBalanceSheetBucket;
      stability: InvestmentBalanceSheetBucket;
      other: InvestmentBalanceSheetBucket;
    };
    currencies: {
      distinct: string[];
      hasMultiple: boolean;
    };
    nativeTotals?: Array<{ currency: string; total: number; count: number }>;
  };
  liabilities: {
    pendingCreditCardDebt: number | null;
    pendingCreditCardDebtStatus: 'ok' | 'no_pairings' | 'missing_repayment_baseline';
    lastCreditCardRepaymentDate: string | null;
    creditCardVendorCount: number;
    manual?: InvestmentLiability[];
    manualTotal?: number | null;
    total?: number | null;
    nativeTotals?: Array<{ currency: string; total: number; count: number }>;
    convertedSubtotal?: number;
  };
  netWorth: number | null;
  netWorthStatus: 'ok' | 'partial';
  missingValuationsCount: number;
  baseCurrency?: string;
  fx?: {
    complete: boolean;
    missingCount: number;
    convertedSubtotal?: number;
    assets?: {
      complete: boolean;
      missingCount: number;
      convertedSubtotal: number;
      nativeTotals: Array<{ currency: string; total: number; count: number }>;
    };
    liabilities?: {
      complete: boolean;
      missingCount: number;
      convertedSubtotal: number;
      nativeTotals: Array<{ currency: string; total: number; count: number }>;
    };
  };
}

export interface InvestmentLiability {
  id: number;
  liability_name: string;
  liability_type: 'loan' | 'credit_line' | 'tax' | 'other';
  balance: number;
  currency: string;
  interest_rate: number | null;
  monthly_payment: number | null;
  as_of_date: string;
  included_in_net_worth: boolean;
  notes?: string | null;
  is_active: boolean;
}

export interface InvestmentAllocationTarget {
  scope: 'exclude_real_estate' | 'all';
  category: InvestmentCategoryKey;
  targetPercentage: number;
  updatedAt: string | null;
}

export interface InvestmentAllocationTargetsResponse {
  scope: 'exclude_real_estate' | 'all';
  configured: boolean;
  totalPercentage: number;
  targets: InvestmentAllocationTarget[];
}

export interface InvestmentFxRate {
  rateDate: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: string;
}

export interface InvestmentFxSettingsResponse {
  baseCurrency: string;
  rates: InvestmentFxRate[];
}

export interface InvestmentBenchmarkPoint {
  date: string;
  value: number;
}

export interface InvestmentBenchmark {
  id: number;
  name: string;
  currency: string;
  isTotalReturn: boolean;
  source: string;
  sourceVersion: string | null;
  isDefault: boolean;
  points?: InvestmentBenchmarkPoint[];
}

export interface RealEstateOverviewProperty {
  accountId: number;
  accountName: string;
  currency: string;
  city: string | null;
  neighborhood: string | null;
  propertyType: string;
  ownershipPercentage: number;
  propertyMarketValue: number | null;
  ownedPropertyValue: number | null;
  netEquity: number | null;
  totalMortgageBalance: number;
  ownedMortgageBalance: number;
  monthlyMortgagePayment: number | null;
  mortgageInterestRate: number | null;
  mortgageTermYears: number | null;
  loanToValue: number | null;
  equityRatio: number | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  valueChange: number | null;
  valueChangePercent: number | null;
  monthlyRent: number | null;
  annualExpenses: number | null;
  monthlyCashFlow: number | null;
  annualDebtService: number | null;
  debtServiceCoverage: number | null;
  valuationMethod: string | null;
  confidence: string | null;
  lastValuationDate: string | null;
  scenarioConservative: number | null;
  scenarioBase: number | null;
  scenarioOptimistic: number | null;
  hasProfile: boolean;
}

export interface RealEstateOverviewResponse {
  generatedAt: string;
  valuationSource: 'manual_simulator';
  marketCompsAvailable: boolean;
  summary: {
    propertyCount: number;
    propertyMarketValue: number;
    ownedPropertyValue: number;
    netEquity: number;
    totalMortgageBalance: number;
    ownedMortgageBalance: number;
    monthlyMortgagePayment: number;
    monthlyRent: number;
    monthlyCashFlow: number;
    missingProfiles: number;
    averageLoanToValue: number | null;
    equityRatio: number | null;
  };
  properties: RealEstateOverviewProperty[];
}

export interface InvestmentPerformanceTimelinePoint {
  date: string;
  currentValue: number;
  costBasis: number;
  contributions: number;
  withdrawals: number;
  capitalReturns: number;
  income: number;
  fees: number;
  taxes?: number;
  dividends?: number;
  interest?: number;
  valueChange: number;
  marketMove: number;
  netFlow: number;
}

export interface InvestmentPerformanceResponse {
  range: string;
  startDate: string | null;
  endDate: string | null;
  requestedStartDate?: string | null;
  baseCurrency?: string | null;
  fx?: PortfolioHistoryResponse['fx'];
  flowCoverage?: {
    linkedTransactionCount: number;
    includedLinkedTransactionCount: number;
    duplicateLinkedTransactionCount: number;
    positionEventCount: number;
    duplicatePositionEventCount?: number;
    missingFxCount: number;
  };
  startValue: number | null;
  endValue: number | null;
  valueChange: number | null;
  netFlows: {
    contributions: number;
    withdrawals: number;
    netContributions: number;
  };
  capitalReturns: number;
  income: number;
  fees: number;
  taxes?: number;
  dividends?: number;
  interest?: number;
  marketMove: number | null;
  twr: number | null;
  mwr: number | null;
  method?: string;
  metricSemantics?: {
    outputField: string;
    isTrueTwr: boolean;
    description: string;
  };
  quality?: 'observed' | 'estimated' | 'unavailable';
  confidence?: {
    level: string;
    score: number | null;
    reasons: string[];
    historyPoints: number;
    actualValuationPoints: number | null;
    cashFlowDays: number;
    flowBoundaryCoverage: number | null;
  };
  attribution?: {
    returnBasis?: 'gross_of_linked_fees_and_taxes' | string;
    formula?: string;
    realizedGainGross: number | null;
    realizedGainNet: number | null;
    realizedStatus: string;
    unrealizedGain: number | null;
    unrealizedStatus: string;
    [key: string]: unknown;
  };
  timeline: InvestmentPerformanceTimelinePoint[];
}

export interface InvestmentPosition {
  id: number;
  account_id: number;
  account_name?: string;
  account_type?: string;
  investment_category?: InvestmentCategoryKey | null;
  institution?: InvestmentInstitution;
  position_name: string;
  asset_symbol?: string | null;
  /** Compatibility alias returned by the canonical positions API. */
  symbol?: string | null;
  asset_type?: string | null;
  currency: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at?: string | null;
  units?: number;
  average_cost?: number | null;
  current_price?: number | null;
  valuation_date?: string | null;
  source?: string;
  legacy_asset_id?: number | null;
  original_cost_basis: number;
  open_cost_basis: number;
  /** Compatibility alias returned by the canonical positions API. */
  cost_basis?: number;
  current_value?: number | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface InvestmentPositionsResponse {
  positions: InvestmentPosition[];
}

export type InvestmentHoldingsRowKind = 'position' | 'holding' | 'reconciliation';
export type InvestmentHoldingsRowStatus = 'valued' | 'needs_valuation';
export type InvestmentReconciliationState = 'remainder' | 'unavailable';

export interface InvestmentHoldingsPositionRow {
  rowId: string;
  rowKind: InvestmentHoldingsRowKind;
  status: InvestmentHoldingsRowStatus;
  accountId: number;
  name: string;
  accountName: string;
  category: InvestmentCategoryKey;
  itemType: string;
  currency: string | null;
  currentValue: number | null;
  basisValue: number | null;
  unrealizedPnL: number | null;
  displayDate: string | null;
  rawDate: string | null;
  institution?: InvestmentInstitution;
  position?: InvestmentPosition;
  symbol?: string | null;
  units?: number | null;
  currentPrice?: number | null;
  reconciliationState?: InvestmentReconciliationState;
  reconciliationReason?: 'missing_values' | 'currency_mismatch' | null;
}

export type InvestmentPositionEventType =
  | 'deposit'
  | 'buy'
  | 'sell'
  | 'capital_return'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'tax'
  | 'valuation'
  | 'rollover';

export interface InvestmentPositionEvent {
  id: number;
  position_id: number;
  event_type: InvestmentPositionEventType;
  effective_date: string;
  amount?: number | null;
  principal_amount?: number | null;
  income_amount?: number | null;
  fee_amount?: number | null;
  tax_amount?: number | null;
  proceeds_amount?: number | null;
  disposed_cost_basis?: number | null;
  realized_gain_loss?: number | null;
  reinvested?: boolean;
  deducted_from_position?: boolean;
  units?: number | null;
  current_price?: number | null;
  current_value?: number | null;
  close_action?: 'keep_open' | 'partial_close' | 'full_close' | null;
  linked_transaction_identifier?: string | null;
  linked_transaction_vendor?: string | null;
  notes?: string | null;
}

export interface InvestmentPositionMutationRequest {
  id?: number;
  account_id: number;
  position_name: string;
  asset_symbol?: string | null;
  asset_type?: string | null;
  currency: string;
  units: number;
  average_cost?: number | null;
  current_price?: number | null;
  valuation_date?: string | null;
  notes?: string | null;
}

export interface InvestmentPositionEventRequest {
  position_id: number;
  event_type: Extract<
    InvestmentPositionEventType,
    'buy' | 'sell' | 'dividend' | 'interest' | 'fee' | 'tax' | 'valuation'
  >;
  effective_date: string;
  principal_amount?: number;
  income_amount?: number;
  fee_amount?: number;
  tax_amount?: number;
  proceeds_amount?: number;
  disposed_cost_basis?: number;
  units?: number;
  current_price?: number;
  current_value?: number;
  reinvested?: boolean;
  deducted_from_position?: boolean;
  close_action?: 'keep_open' | 'partial_close' | 'full_close';
  notes?: string | null;
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

export interface PikadonDetailsInput {
  maturity_date: string;
  interest_rate?: number | null;
  notes?: string | null;
}

export interface PendingPikadonSetup {
  account_id: number;
  account_name?: string | null;
  transaction_identifier: string;
  transaction_vendor: string;
  principal: number;
  deposit_date: string;
  transaction_name: string | null;
}

export interface PikadonListResponse {
  pikadon: PikadonHolding[];
  pending_setup: PendingPikadonSetup[];
}

export interface PikadonDetailsRequiredResponse {
  error: 'pikadon_details_required';
  pikadonCandidate: PendingPikadonSetup;
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
