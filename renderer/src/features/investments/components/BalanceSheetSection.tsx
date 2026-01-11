import React from 'react';
import { Box, Card, Chip, Grid, Skeleton, Typography, Alert } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import SchoolIcon from '@mui/icons-material/School';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { InvestmentBalanceSheetResponse } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface BalanceSheetSectionProps {
  data: InvestmentBalanceSheetResponse | null;
  loading: boolean;
  error?: Error | null;
}

function formatShortDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const BalanceSheetSection: React.FC<BalanceSheetSectionProps> = ({ data, loading, error }) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.balanceSheet' });

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  if (loading) {
    return (
      <Card sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Skeleton variant="circular" width={28} height={28} sx={{ mr: 2 }} />
          <Box sx={{ flexGrow: 1 }}>
            <Skeleton variant="text" width={220} height={26} />
            <Skeleton variant="text" width={320} height={18} />
          </Box>
        </Box>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Skeleton variant="text" width={120} height={18} />
            <Skeleton variant="text" width={240} height={48} />
          </Grid>
          <Grid item xs={12} md={8}>
            <Grid container spacing={2}>
              {[0, 1, 2, 3].map((idx) => (
                <Grid item xs={6} md={3} key={idx}>
                  <Skeleton variant="rounded" height={84} />
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
        {t('error')}
      </Alert>
    );
  }

  if (!data) return null;

  const headlineLabel = data.netWorth === null ? t('headline.assets') : t('headline.netWorth');
  const headlineValue = data.netWorth === null ? data.assets.total : data.netWorth;
  const headlineFormatted =
    data.netWorth === null
      ? formatCurrencyValue(headlineValue)
      : formatCurrency(headlineValue, { absolute: false, maximumFractionDigits: 0 });
  const updatedLabel =
    formatShortDate(data.assets.newestUpdateDate) || formatShortDate(data.generatedAt) || t('na');

  const pendingDebt = data.liabilities.pendingCreditCardDebt;
  const showDebtUnavailable = pendingDebt === null;

  const chips: Array<{ label: string; color?: 'default' | 'warning' | 'error' }> = [];
  if (data.netWorthStatus !== 'ok') {
    chips.push({ label: t('badges.partial'), color: 'warning' });
  }
  if (data.assets.currencies.hasMultiple) {
    chips.push({ label: t('badges.multiCurrency'), color: 'warning' });
  }
  if (data.missingValuationsCount > 0) {
    chips.push({ label: t('badges.missingValues', { count: data.missingValuationsCount }), color: 'warning' });
  }

  const bucketCard = (
    key: 'cash' | 'liquid' | 'restricted' | 'stability',
    {
      icon,
      label,
      color,
    }: { icon: React.ReactNode; label: string; color: string },
  ) => {
    const bucket = data.assets.buckets[key];
    const updated = formatShortDate(bucket.newestUpdateDate);

    return (
      <Card
        variant="outlined"
        sx={{
          p: 1.5,
          height: '100%',
          borderColor: alpha(color, 0.35),
          bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.08 : 0.04),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box sx={{ color }}>{icon}</Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            {label}
          </Typography>
        </Box>
        <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.1 }}>
          {formatCurrencyValue(bucket.totalValue)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('bucketMeta', {
            withValue: bucket.accountsWithValue,
            total: bucket.accountsCount,
          })}
          {updated ? ` • ${t('updated', { date: updated })}` : ''}
        </Typography>
      </Card>
    );
  };

  const liabilityCard = () => {
    const debtLabel =
      pendingDebt === null ? t('liabilities.unavailable') : `-${formatCurrencyValue(pendingDebt)}`;

    const debtColor = showDebtUnavailable ? theme.palette.text.secondary : theme.palette.error.main;

    const updated = formatShortDate(data.liabilities.lastCreditCardRepaymentDate);

    return (
      <Card
        variant="outlined"
        sx={{
          p: 1.5,
          height: '100%',
          borderColor: alpha(theme.palette.error.main, 0.35),
          bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.08 : 0.04),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box sx={{ color: theme.palette.error.main }}>
            <CreditCardIcon fontSize="small" />
          </Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            {t('liabilities.pendingCcDebt')}
          </Typography>
        </Box>
        <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.1, color: debtColor }}>
          {debtLabel}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {updated ? t('updated', { date: updated }) : t('liabilities.noBaseline')}
        </Typography>
      </Card>
    );
  };

  return (
    <Card sx={{ p: 3, mb: 2, borderRadius: 3, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
        <AccountBalanceWalletIcon sx={{ fontSize: 30, color: 'primary.main', mt: 0.25 }} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" fontWeight={800} sx={{ lineHeight: 1.15 }}>
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')} • {t('updated', { date: updatedLabel })}
          </Typography>
        </Box>

        {chips.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end' }}>
            {chips.map((chip) => (
              <Chip
                key={chip.label}
                label={chip.label}
                size="small"
                color={chip.color || 'default'}
                variant={chip.color ? 'filled' : 'outlined'}
              />
            ))}
          </Box>
        )}
      </Box>

      <Grid container spacing={2} alignItems="stretch">
        <Grid item xs={12} md={4}>
          <Typography variant="caption" color="text.secondary">
            {headlineLabel}
          </Typography>
          <Typography variant="h3" fontWeight={900} color="primary.main" sx={{ letterSpacing: -0.5 }}>
            {headlineFormatted}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('footnote')}
          </Typography>
        </Grid>

        <Grid item xs={12} md={8}>
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}>
              {bucketCard('cash', {
                icon: <AccountBalanceIcon fontSize="small" />,
                label: t('buckets.cash'),
                color: theme.palette.primary.main,
              })}
            </Grid>
            <Grid item xs={6} md={3}>
              {bucketCard('liquid', {
                icon: <ShowChartIcon fontSize="small" />,
                label: t('buckets.liquid'),
                color: theme.palette.info.main,
              })}
            </Grid>
            <Grid item xs={6} md={3}>
              {bucketCard('restricted', {
                icon: <SchoolIcon fontSize="small" />,
                label: t('buckets.restricted'),
                color: theme.palette.warning.main,
              })}
            </Grid>
            <Grid item xs={6} md={3}>
              {liabilityCard()}
            </Grid>
          </Grid>

          {(data.liabilities.pendingCreditCardDebtStatus !== 'ok' || data.assets.currencies.hasMultiple) && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {data.assets.currencies.hasMultiple
                  ? t('hints.multiCurrency', { currencies: data.assets.currencies.distinct.join(', ') })
                  : null}
                {data.assets.currencies.hasMultiple && data.liabilities.pendingCreditCardDebtStatus !== 'ok' ? ' • ' : null}
                {data.liabilities.pendingCreditCardDebtStatus !== 'ok' ? t('hints.pendingDebt') : null}
              </Typography>
            </Box>
          )}
        </Grid>
      </Grid>
    </Card>
  );
};

export default BalanceSheetSection;
