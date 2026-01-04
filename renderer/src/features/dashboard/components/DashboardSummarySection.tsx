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

      <Paper sx={{ 
        p: 3, 
        mb: 3,
        borderRadius: 4,
        backgroundColor: theme.palette.mode === 'dark' ? 'rgba(30, 30, 30, 0.6)' : 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.05)}`,
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ 
              background: `linear-gradient(135deg, ${theme.palette.text.primary} 0%, ${alpha(theme.palette.text.primary, 0.7)} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {format(startDate, 'MMMM yyyy')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.85rem', mt: 0.5, display: 'block' }}>
              {t('periodLabel', {
                start: format(startDate, 'MMM dd'),
                end: format(endDate, 'MMM dd, yyyy'),
              })}
            </Typography>
          </Box>
          <Button
            variant={compareToLastMonth ? 'contained' : 'outlined'}
            size="small"
            onClick={onToggleCompare}
            startIcon={<ShowChartIcon />}
            sx={{
              borderRadius: 2,
              px: 2,
              py: 1,
              textTransform: 'none',
              fontWeight: 600,
              ...(compareToLastMonth ? {
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}`,
              } : {
                borderColor: alpha(theme.palette.divider, 0.2),
                color: theme.palette.text.primary,
                '&:hover': {
                  borderColor: theme.palette.primary.main,
                  backgroundColor: alpha(theme.palette.primary.main, 0.05),
                }
              })
            }}
          >
            {compareToLastMonth ? t('compare.on') : t('compare.off')}
          </Button>
        </Box>
        {compareToLastMonth && (
          <Alert 
            severity="info" 
            sx={{ 
              mt: 2,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.info.main, 0.05),
              border: `1px solid ${alpha(theme.palette.info.main, 0.1)}`,
            }}
          >
            <AlertTitle sx={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('comparison.title')}</AlertTitle>
            <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
              {t('comparison.description', {
                current: format(startDate, 'MMMM'),
                previous: format(subMonths(startDate, 1), 'MMMM'),
              })}
            </Typography>
          </Alert>
        )}
      </Paper>
    </>
  );
};

export default DashboardSummarySection;
