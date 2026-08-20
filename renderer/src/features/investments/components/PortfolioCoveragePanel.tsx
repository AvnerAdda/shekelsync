import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Skeleton,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type {
  InvestmentAccountSummary,
  InvestmentBalanceSheetResponse,
  PortfolioSummary,
} from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface PortfolioCoveragePanelProps {
  portfolioData: PortfolioSummary | null;
  balanceSheet: InvestmentBalanceSheetResponse | null;
  unlinkedTransactionCount?: number;
  loading: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onManageAccounts?: (itemId: CoverageItem['id'], accountId?: number) => void;
}

interface CoverageItem {
  id: 'missingValuations' | 'staleValuations' | 'missingCurrency' | 'unlinkedTransactions';
  count: number;
  accounts: InvestmentAccountSummary[];
}

const MAX_VISIBLE_ACCOUNT_NAMES = 3;

function daysSince(dateValue?: string | null): number | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24));
}

function hasRecordedValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

export function getPortfolioCoverageItems(
  portfolioData: PortfolioSummary,
  balanceSheet: InvestmentBalanceSheetResponse | null,
  unlinkedTransactionCount = 0,
): CoverageItem[] {
  const accounts = portfolioData.accounts || [];
  const recordedValueFor = (account: InvestmentAccountSummary) =>
    account.native_current_value !== undefined
      ? account.native_current_value
      : account.current_value;
  const missingValuationAccounts = accounts.filter(
    (account) => !hasRecordedValue(recordedValueFor(account)) || !account.as_of_date,
  );
  const staleValuationAccounts = accounts.filter((account) => {
    const age = daysSince(account.as_of_date);
    return hasRecordedValue(recordedValueFor(account)) && age !== null && age > 30;
  });
  const missingCurrencyAccounts = accounts.filter(
    (account) => typeof account.currency !== 'string' || account.currency.trim().length === 0,
  );

  return [
    {
      id: 'missingValuations',
      count: Math.max(balanceSheet?.missingValuationsCount || 0, missingValuationAccounts.length),
      accounts: missingValuationAccounts,
    },
    {
      id: 'staleValuations',
      count: staleValuationAccounts.length,
      accounts: staleValuationAccounts,
    },
    {
      id: 'missingCurrency',
      count: missingCurrencyAccounts.length,
      accounts: missingCurrencyAccounts,
    },
    {
      id: 'unlinkedTransactions',
      count: Math.max(Number(unlinkedTransactionCount) || 0, 0),
      accounts: [],
    },
  ];
}

const PortfolioCoveragePanel: React.FC<PortfolioCoveragePanelProps> = ({
  portfolioData,
  balanceSheet,
  unlinkedTransactionCount = 0,
  loading,
  error = null,
  onRetry,
  onManageAccounts,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.coverage' });

  if (loading && !portfolioData) {
    return (
      <Paper sx={{ p: 2.5, height: '100%' }}>
        <Skeleton variant="text" width={180} height={30} />
        <Skeleton variant="text" width={260} height={18} sx={{ mb: 2 }} />
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={86} />
          ))}
        </Box>
      </Paper>
    );
  }

  if (!portfolioData) {
    return (
      <Paper sx={{ p: 2.5, height: '100%' }}>
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
          {t('title')}
        </Typography>
        {error ? (
          <Alert
            severity="warning"
            action={onRetry ? (
              <Button color="inherit" size="small" onClick={onRetry}>
                {t('actions.retry')}
              </Button>
            ) : undefined}
          >
            {t('error')}
          </Alert>
        ) : (
          <Typography sx={{ color: 'text.secondary' }}>{t('empty')}</Typography>
        )}
      </Paper>
    );
  }

  const items = getPortfolioCoverageItems(portfolioData, balanceSheet, unlinkedTransactionCount);
  const issueCount = items.reduce((sum, item) => sum + item.count, 0);
  const issueTone = issueCount === 0 ? theme.palette.success.main : theme.palette.warning.main;

  const renderAffectedAccounts = (item: CoverageItem) => {
    if (item.count === 0) {
      return t('complete');
    }

    if (item.id === 'unlinkedTransactions') {
      return t('transactionsAffected', { count: item.count });
    }

    const visibleNames = item.accounts
      .slice(0, MAX_VISIBLE_ACCOUNT_NAMES)
      .map((account) => account.account_name)
      .filter(Boolean);
    const unnamedCount = Math.max(item.count - visibleNames.length, 0);

    if (visibleNames.length === 0) {
      return t('affectedCount', { count: item.count });
    }

    const names = visibleNames.join(', ');
    return unnamedCount > 0
      ? t('affectedWithMore', { names, count: unnamedCount })
      : t('affected', { names });
  };

  return (
    <Paper sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('title')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('subtitle')}
          </Typography>
        </Box>
        <Chip
          icon={issueCount === 0 ? <CheckCircleOutlineIcon /> : <WarningAmberIcon />}
          label={issueCount === 0 ? t('complete') : t('issues', { count: issueCount })}
          sx={{
            fontWeight: 700,
            color: issueTone,
            borderColor: alpha(issueTone, 0.4),
            bgcolor: alpha(issueTone, 0.1),
          }}
          variant="outlined"
        />
      </Box>

      {error && (
        <Alert
          severity="warning"
          action={onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              {t('actions.retry')}
            </Button>
          ) : undefined}
        >
          {t('staleError')}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 1.25 }}>
        {items.map((item) => {
          const hasIssue = item.count > 0;
          const tone = hasIssue ? theme.palette.warning.main : theme.palette.success.main;

          return (
            <Box
              key={item.id}
              sx={{
                p: 1.5,
                borderRadius: 2,
                border: `1px solid ${alpha(tone, 0.35)}`,
                bgcolor: alpha(tone, 0.06),
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t(`items.${item.id}.label`)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {t(`items.${item.id}.hint`)}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={hasIssue ? item.count : t('complete')}
                  color={hasIssue ? 'warning' : 'success'}
                  variant="outlined"
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'center', mt: 1 }}>
                <Typography variant="caption" sx={{ color: hasIssue ? 'text.primary' : 'text.secondary' }}>
                  {renderAffectedAccounts(item)}
                </Typography>
                {hasIssue && onManageAccounts && (
                  <Button
                    size="small"
                    onClick={() => onManageAccounts(item.id, item.accounts[0]?.id)}
                    sx={{ flexShrink: 0 }}
                  >
                    {item.id === 'unlinkedTransactions'
                      ? t('actions.reviewTransactions')
                      : t('actions.reviewAccounts')}
                  </Button>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

export default PortfolioCoveragePanel;
