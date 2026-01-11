import React from 'react';
import { Box, Paper, Typography, Button, Alert, AlertTitle } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { format, subMonths } from 'date-fns';
import SummaryCards from './SummaryCards';
import { useDashboardFilters } from '../DashboardFiltersContext';
import { useTranslation } from 'react-i18next';

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
}

const DashboardSummarySection: React.FC<DashboardSummarySectionProps> = ({
  data,
  portfolioValue,
  liquidPortfolio,
  restrictedPortfolio,
  budgetUsage,
  breakdownData,
  hasBankAccounts,
  compareToLastMonth,
  onToggleCompare,
}) => {
  const { startDate, endDate } = useDashboardFilters();
  const { t } = useTranslation('translation', { keyPrefix: 'dashboard.summarySection' });
  const theme = useTheme();
  const hasAnyTransactions =
    (data?.summary?.totalIncome ?? 0) !== 0 ||
    (data?.summary?.totalExpenses ?? 0) !== 0 ||
    (data?.summary?.netInvestments ?? 0) !== 0 ||
    (data?.summary?.totalCapitalReturns ?? 0) !== 0;

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
          topCategories={
            breakdownData['expense'] && Array.isArray(breakdownData['expense']?.breakdowns)
              ? breakdownData['expense'].breakdowns.slice(0, 3).map((cat: any) => ({
                  name: cat.name,
                  amount: cat.value,
                }))
              : data.summary.totalExpenses > 0
              ? [{ name: t('fallbackCategory'), amount: data.summary.totalExpenses }]
              : []
          }
          categoryCount={
            breakdownData['expense'] && Array.isArray(breakdownData['expense']?.breakdowns)
              ? breakdownData['expense'].breakdowns.length
              : 0
          }
        />
      </Box>

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
