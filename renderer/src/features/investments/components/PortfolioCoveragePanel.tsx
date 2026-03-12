import React from 'react';
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Skeleton,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { PortfolioSummary, InvestmentBalanceSheetResponse } from '@renderer/types/investments';

interface PortfolioCoveragePanelProps {
  portfolioData: PortfolioSummary | null;
  balanceSheet: InvestmentBalanceSheetResponse | null;
  loading: boolean;
}

function daysSince(dateValue?: string | null): number | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const PortfolioCoveragePanel: React.FC<PortfolioCoveragePanelProps> = ({
  portfolioData,
  balanceSheet,
  loading,
}) => {
  const theme = useTheme();

  if (loading) {
    return (
      <Paper sx={{ p: 2.5, height: '100%' }}>
        <Skeleton variant="text" width={180} height={30} />
        <Skeleton variant="text" width={260} height={18} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={12} sx={{ mb: 2.5 }} />
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={68} />
          ))}
        </Box>
      </Paper>
    );
  }

  if (!portfolioData || !balanceSheet) {
    return (
      <Paper sx={{ p: 2.5, height: '100%' }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Portfolio Coverage
        </Typography>
        <Typography color="text.secondary">
          Coverage metrics will appear once investment accounts are available.
        </Typography>
      </Paper>
    );
  }

  const accounts = portfolioData.accounts || [];
  const staleValuations = accounts.filter((account) => {
    const age = daysSince(account.as_of_date);
    return age !== null && age > 30;
  }).length;
  const missingCurrencies = accounts.filter((account) => !account.currency).length;
  const missingHoldings = accounts.filter(
    (account) =>
      (!Array.isArray(account.assets) || account.assets.length === 0)
      && !account.as_of_date
      && (account.current_value_explicit === null || account.current_value_explicit === undefined),
  ).length;
  const missingValuations = balanceSheet.missingValuationsCount || 0;

  const score = clamp(
    100
      - missingValuations * 14
      - staleValuations * 10
      - missingCurrencies * 8
      - missingHoldings * 8,
    0,
    100,
  );

  const statusTone =
    score >= 85
      ? theme.palette.success.main
      : score >= 65
        ? theme.palette.warning.main
        : theme.palette.error.main;

  const items = [
    {
      label: 'Missing valuations',
      value: missingValuations,
      hint: 'Accounts without a recent balance snapshot.',
    },
    {
      label: 'Stale valuations',
      value: staleValuations,
      hint: 'Accounts whose latest valuation is older than 30 days.',
    },
    {
      label: 'Missing currency metadata',
      value: missingCurrencies,
      hint: 'Accounts without a base currency make totals less trustworthy.',
    },
    {
      label: 'Accounts missing holdings',
      value: missingHoldings,
      hint: 'Accounts with no valuation and no holdings detail yet.',
    },
  ];

  return (
    <Paper sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Portfolio Coverage
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Measures how complete and reviewable your investment data is.
          </Typography>
        </Box>
        <Chip
          label={`${score}%`}
          sx={{
            fontWeight: 700,
            color: statusTone,
            borderColor: alpha(statusTone, 0.4),
            bgcolor: alpha(statusTone, 0.1),
          }}
          variant="outlined"
        />
      </Box>

      <Box>
        <LinearProgress
          variant="determinate"
          value={score}
          sx={{
            height: 10,
            borderRadius: 999,
            bgcolor: alpha(statusTone, 0.12),
            '& .MuiLinearProgress-bar': {
              borderRadius: 999,
              bgcolor: statusTone,
            },
          }}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 1.25 }}>
        {items.map((item) => (
          <Box
            key={item.label}
            sx={{
              p: 1.5,
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
              bgcolor: alpha(theme.palette.background.default, 0.5),
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>
              <Typography variant="body2" fontWeight={600}>
                {item.label}
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                {item.value}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {item.hint}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default PortfolioCoveragePanel;
