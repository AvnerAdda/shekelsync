import type {
  InvestmentCategoryKey,
  InvestmentHoldingsPositionRow,
  InvestmentHoldingsRowKind,
  InvestmentPosition,
  PortfolioSummary,
} from '@renderer/types/investments';
import { normalizeInvestmentCategory } from './portfolio-categories';

export type InvestmentHoldingsRowFilter = 'all' | InvestmentHoldingsRowKind;

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPositionRow(position: InvestmentPosition): InvestmentHoldingsPositionRow {
  const currentValue = toNullableNumber(position.current_value);
  const basisValue = toNullableNumber(position.open_cost_basis);

  return {
    rowId: `position-${position.id}`,
    rowKind: 'position',
    status: currentValue === null ? 'needs_valuation' : 'valued',
    accountId: Number(position.account_id),
    name: position.position_name || position.account_name || 'Position',
    accountName: position.account_name || 'Unknown account',
    category: normalizeInvestmentCategory(position.investment_category),
    itemType: position.asset_type || position.account_type || 'position',
    currency: position.currency || null,
    currentValue,
    basisValue,
    unrealizedPnL:
      currentValue !== null && basisValue !== null ? currentValue - basisValue : null,
    displayDate: position.updated_at || position.opened_at || null,
    rawDate: position.updated_at || position.opened_at || null,
    institution: position.institution ?? null,
  };
}

function buildFallbackHoldingRow(portfolio: PortfolioSummary, accountId: number): InvestmentHoldingsPositionRow | null {
  const account = (portfolio.accounts || []).find((item) => Number(item.id) === Number(accountId));
  if (!account) {
    return null;
  }

  const currentValue = toNullableNumber(account.current_value);
  const basisValue = toNullableNumber(account.cost_basis);
  const assets = Array.isArray(account.assets) ? account.assets : [];
  const singleAsset = assets.length === 1 ? assets[0] : null;

  return {
    rowId: `holding-${account.id}`,
    rowKind: 'holding',
    status: currentValue === null ? 'needs_valuation' : 'valued',
    accountId: Number(account.id),
    name: singleAsset?.asset_name || account.account_name,
    accountName: account.account_name,
    category: normalizeInvestmentCategory(account.investment_category),
    itemType: singleAsset?.asset_type || account.account_type || 'holding',
    currency: account.currency || null,
    currentValue,
    basisValue,
    unrealizedPnL:
      currentValue !== null && basisValue !== null ? currentValue - basisValue : null,
    displayDate: account.as_of_date || null,
    rawDate: account.as_of_date || null,
    institution: account.institution ?? null,
  };
}

export function buildHybridHoldingsPositionRows(
  portfolio: PortfolioSummary | null | undefined,
  positions: InvestmentPosition[] | null | undefined,
): InvestmentHoldingsPositionRow[] {
  if (!portfolio) {
    return [];
  }

  const openPositions = Array.isArray(positions)
    ? positions.filter((position) => position.status !== 'closed')
    : [];
  const positionAccountIds = new Set(openPositions.map((position) => Number(position.account_id)));

  const positionRows = openPositions.map(buildPositionRow);
  const holdingRows = (portfolio.accounts || [])
    .filter((account) => !positionAccountIds.has(Number(account.id)))
    .map((account) => buildFallbackHoldingRow(portfolio, Number(account.id)))
    .filter((row): row is InvestmentHoldingsPositionRow => row !== null);

  return sortHybridHoldingsPositionRows([...positionRows, ...holdingRows]);
}

export function filterHybridHoldingsPositionRows(
  rows: InvestmentHoldingsPositionRow[],
  options: {
    search: string;
    category: 'all' | InvestmentCategoryKey;
    rowKind: InvestmentHoldingsRowFilter;
  },
): InvestmentHoldingsPositionRow[] {
  const searchValue = options.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (options.category !== 'all' && row.category !== options.category) {
      return false;
    }

    if (options.rowKind !== 'all' && row.rowKind !== options.rowKind) {
      return false;
    }

    if (!searchValue) {
      return true;
    }

    return [
      row.name,
      row.accountName,
      row.itemType,
      row.currency,
      row.category,
    ].some((value) => String(value || '').toLowerCase().includes(searchValue));
  });
}

export function sortHybridHoldingsPositionRows(
  rows: InvestmentHoldingsPositionRow[],
): InvestmentHoldingsPositionRow[] {
  return [...rows].sort((left, right) => {
    const leftValue = left.currentValue ?? Number.NEGATIVE_INFINITY;
    const rightValue = right.currentValue ?? Number.NEGATIVE_INFINITY;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }

    const leftDate = left.rawDate ? new Date(left.rawDate).getTime() : 0;
    const rightDate = right.rawDate ? new Date(right.rawDate).getTime() : 0;
    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return left.name.localeCompare(right.name);
  });
}
