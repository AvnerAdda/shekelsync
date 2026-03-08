import React from 'react';
import { Box, Typography, Button, Alert, AlertTitle } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SummaryCards from './SummaryCards';
import { useTranslation } from 'react-i18next';
import type { CurrentMonthPairingGapResponse } from '@renderer/types/accounts';
import {
  buildDashboardTopCategories,
  getDashboardCategoryCount,
  hasDashboardSummaryActivity,
} from './dashboard-summary-helpers';

interface DashboardSummarySectionProps {
  data: any;
  portfolioValue: number | null;
  liquidPortfolio: any[];
  restrictedPortfolio: any[];
  budgetUsage: any;
  breakdownData: Record<string, any>;
  hasBankAccounts: boolean | null;
  compareToLastMonth: boolean;
  onToggleCompare: () => void;
  pairingGap?: CurrentMonthPairingGapResponse | null;
  pairingGapLoading?: boolean;
  isCurrentMonthWindow?: boolean;
  pairingGapExpensesBase?: number | null;
}

const DashboardSummarySection: React.FC<DashboardSummarySectionProps> = ({
  data,
  portfolioValue,
  liquidPortfolio,
  restrictedPortfolio,
  budgetUsage,
  breakdownData,
  hasBankAccounts,
  compareToLastMonth: _compareToLastMonth,
  onToggleCompare: _onToggleCompare,
  pairingGap,
  pairingGapLoading = false,
  isCurrentMonthWindow = false,
  pairingGapExpensesBase = null,
}) => {
  const { t } = useTranslation('translation', { keyPrefix: 'dashboard.summarySection' });
  const theme = useTheme();
  const hasAnyTransactions = hasDashboardSummaryActivity(data?.summary);
  const missingAmount = Number(pairingGap?.totals?.missingAmount || 0);
  const totalExpensesBase = Number(pairingGapExpensesBase ?? data?.summary?.totalExpenses ?? 0);
  const missingPercentage = totalExpensesBase > 0
    ? Math.round((missingAmount / totalExpensesBase) * 1000) / 10
    : 0;
  const shouldShowPairingGapAlert = isCurrentMonthWindow && !pairingGapLoading && missingAmount > 2;
  const formattedMissingAmount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(missingAmount);

  const handleOpenAccounts = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openAccountsModal'));
    }
  };

  return (
    <>
      <Box sx={{ mb: 4 }}>
        <SummaryCards
          totalIncome={data.summary.totalIncome}
          totalCapitalReturns={data.summary.totalCapitalReturns}
          totalExpenses={data.summary.totalExpenses}
          netInvestments={data.summary.netInvestments}
          currentBankBalance={data.summary.currentBankBalance}
          monthStartBankBalance={data.summary.monthStartBankBalance}
          pendingExpenses={data.summary.pendingExpenses}
          pendingCount={data.summary.pendingCount}
          portfolioValue={portfolioValue ?? 0}
          portfolioGains={undefined}
          monthlyPortfolioChange={undefined}
          assetBreakdown={[...liquidPortfolio, ...restrictedPortfolio].map(item => ({
            name: item.name,
            value: item.value,
            percentage: item.percentage,
          }))}
          budgetUsage={budgetUsage}
          monthlyAverage={undefined}
          topCategories={buildDashboardTopCategories(
            breakdownData,
            data.summary.totalExpenses,
            t('fallbackCategory'),
          )}
          categoryCount={getDashboardCategoryCount(breakdownData)}
        />
      </Box>

      {shouldShowPairingGapAlert && (
        <Alert
          severity="warning"
          sx={{
            mb: 3,
            borderRadius: 3,
            backgroundColor: alpha(theme.palette.warning.main, 0.12),
            border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
            '& .MuiAlert-icon': {
              color: theme.palette.warning.main,
            },
          }}
          action={(
            <Button
              size="small"
              color="warning"
              variant="outlined"
              onClick={handleOpenAccounts}
            >
              {t('pairingGap.action', { defaultValue: 'Open Accounts' })}
            </Button>
          )}
        >
          <AlertTitle sx={{ fontWeight: 600 }}>
            {t('pairingGap.title', { defaultValue: 'Missing credit card transactions detected' })}
          </AlertTitle>
          <Typography variant="body2">
            {t('pairingGap.description', {
              defaultValue: 'Missing {{amount}} this month ({{percent}}% of expenses). Open Account Pairing, inspect unmatched accounts, and run Recovery Sync (100 days).',
              amount: formattedMissingAmount,
              percent: missingPercentage,
            })}
          </Typography>
        </Alert>
      )}

      {data.summary.totalIncome === 0 && !hasAnyTransactions && hasBankAccounts !== null && (
        <Alert 
          severity="info" 
          icon={<InfoOutlinedIcon />} 
          sx={{ 
            mb: 3,
            borderRadius: 3,
            backgroundColor: alpha(theme.palette.info.main, 0.1),
            border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
            backdropFilter: 'blur(12px)',
            '& .MuiAlert-icon': {
              color: theme.palette.info.main
            }
          }}
        >
          <AlertTitle sx={{ fontWeight: 600 }}>{t('noIncomeTitle')}</AlertTitle>
          {hasBankAccounts === false ? (
            <Typography variant="body2">
              {t('noIncomeAddAccounts')}
            </Typography>
          ) : (
            <Typography variant="body2">
              {t('noIncomeDetected')}
            </Typography>
          )}
        </Alert>
      )}
    </>
  );
};

export default DashboardSummarySection;
