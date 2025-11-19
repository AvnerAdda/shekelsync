import React from 'react';
import { Box, Paper, Typography, Button, Alert, AlertTitle } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { format, subMonths } from 'date-fns';
import SummaryCards from './SummaryCards';
import { useDashboardFilters } from '../DashboardFiltersContext';

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

  return (
    <>
      <Box sx={{ mb: 4 }}>
        <SummaryCards
          totalIncome={data.summary.totalIncome}
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
              ? [{ name: 'Total Expenses', amount: data.summary.totalExpenses }]
              : []
          }
          categoryCount={
            breakdownData['expense'] && Array.isArray(breakdownData['expense']?.breakdowns)
              ? breakdownData['expense'].breakdowns.length
              : 0
          }
        />
      </Box>

      {data.summary.totalIncome === 0 && hasBankAccounts !== null && (
        <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 3 }}>
          <AlertTitle>No Income Detected</AlertTitle>
          {hasBankAccounts === false ? (
            <Typography variant="body2">
              To track your income automatically, please add your bank account credentials.
              This will enable automatic income tracking and provide a complete financial overview.
            </Typography>
          ) : (
            <Typography variant="body2">
              We haven&apos;t detected any income transactions in the selected period.
              If you&apos;re expecting income data, please verify your most recent bank scrape was successful
              or run a new scrape to update your transactions.
            </Typography>
          )}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h6">{format(startDate, 'MMMM yyyy')}</Typography>
            <Typography variant="caption" color="text.secondary">
              Current month: {format(startDate, 'MMM dd')} - {format(endDate, 'MMM dd, yyyy')}
            </Typography>
          </Box>
          <Button
            variant={compareToLastMonth ? 'contained' : 'outlined'}
            size="small"
            onClick={onToggleCompare}
            startIcon={<ShowChartIcon />}
          >
            {compareToLastMonth ? 'Comparing to Last Month' : 'Compare to Last Month'}
          </Button>
        </Box>
        {compareToLastMonth && (
          <Alert severity="info" sx={{ mt: 2 }}>
            <AlertTitle>Comparison Mode (Coming Soon)</AlertTitle>
            <Typography variant="body2">
              {`Month-over-month comparison view is under development. This will show side-by-side metrics comparing ${format(
                startDate,
                'MMMM'
              )} with ${format(subMonths(startDate, 1), 'MMMM')}.`}
            </Typography>
          </Alert>
        )}
      </Paper>
    </>
  );
};

export default DashboardSummarySection;
