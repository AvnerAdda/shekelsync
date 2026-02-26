import React from 'react';
import { Box, Card, Grid, Typography, Skeleton, useTheme } from '@mui/material';
import {
  AccountBalance as AccountIcon,
  ShowChart as StockIcon,
  School as SchoolIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioSummary } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import {
  formatSignedCurrencyValue,
  formatSignedPercent,
  hasPortfolioAccounts,
} from './investments-summary-helpers';

interface InvestmentsSummarySectionProps {
  portfolioData: PortfolioSummary | null;
  loading: boolean;
}

const InvestmentsSummarySection: React.FC<InvestmentsSummarySectionProps> = ({
  portfolioData,
  loading,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.summary' });

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  if (loading) {
    return (
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: 180, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Skeleton variant="circular" width={24} height={24} sx={{ mr: 1 }} />
              <Skeleton variant="text" width={150} height={20} />
            </Box>
            <Skeleton variant="text" width={200} height={48} sx={{ mb: 2 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Box>
                <Skeleton variant="text" width={60} height={16} />
                <Skeleton variant="text" width={80} height={20} />
              </Box>
              <Box>
                <Skeleton variant="text" width={80} height={16} />
                <Skeleton variant="text" width={70} height={20} />
              </Box>
            </Box>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3.5 }}>
          <Card sx={{ height: 180, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Skeleton variant="circular" width={24} height={24} sx={{ mr: 1 }} />
              <Skeleton variant="text" width={120} height={20} />
            </Box>
            <Skeleton variant="text" width={120} height={48} sx={{ mb: 1 }} />
            <Skeleton variant="text" width={100} height={16} />
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3.5 }}>
          <Card sx={{ height: 180, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Skeleton variant="circular" width={24} height={24} sx={{ mr: 1 }} />
              <Skeleton variant="text" width={130} height={20} />
            </Box>
            <Skeleton variant="text" width={100} height={48} sx={{ mb: 1 }} />
            <Skeleton variant="text" width={120} height={16} />
          </Card>
        </Grid>
      </Grid>
    );
  }

  if (!hasPortfolioAccounts(portfolioData)) {
    return null;
  }

  const summary = portfolioData.summary;

  return (
    <Box>
      {/* Overall Portfolio Summary */}
      <Card sx={{ p: 3, mb: 3, bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <AccountIcon sx={{ mr: 2, fontSize: 28, color: 'primary.main' }} />
          <Box>
            <Typography variant="h5" fontWeight="bold">
              {t('overall.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('overall.accounts', { count: summary.accountsWithValues })} •{' '}
              {t('overall.updated', {
                date: summary.newestUpdateDate
                  ? new Date(summary.newestUpdateDate).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : t('overall.na'),
              })}
            </Typography>
          </Box>
        </Box>
        <Grid container spacing={3}>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('overall.totalValue')}
            </Typography>
            <Typography variant="h4" fontWeight="bold" color="primary.main">
              {formatCurrencyValue(summary.totalPortfolioValue)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('overall.totalCost')}
            </Typography>
            <Typography variant="h5" fontWeight="medium">
              {formatCurrencyValue(summary.totalCostBasis)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('overall.unrealized')}
            </Typography>
            <Typography
              variant="h5"
              fontWeight="medium"
              color={summary.unrealizedGainLoss >= 0 ? 'success.main' : 'error.main'}
            >
              {formatSignedCurrencyValue(summary.unrealizedGainLoss, formatCurrencyValue)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('overall.roi')}
            </Typography>
            <Typography
              variant="h5"
              fontWeight="medium"
              color={summary.roi >= 0 ? 'success.main' : 'error.main'}
            >
              {formatSignedPercent(summary.roi, 2)}
            </Typography>
          </Grid>
        </Grid>
      </Card>

      {/* Liquid & Restricted - Side by Side on large screens */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          {/* Liquid Investments Section */}
          <Card sx={{ p: 3, height: '100%', border: '2px solid', borderColor: 'info.light' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <StockIcon sx={{ mr: 2, fontSize: 28, color: 'info.main' }} />
              <Box>
                <Typography variant="h5" fontWeight="bold" color="info.main">
                  {t('liquid.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('liquid.subtitle', { count: summary.liquid.accountsCount })}
                </Typography>
              </Box>
            </Box>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('liquid.currentValue')}
                </Typography>
                <Typography variant="h4" fontWeight="bold" color="info.main">
                  {formatCurrencyValue(summary.liquid.totalValue)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('liquid.unrealized')}
                </Typography>
                <Typography
                  variant="h6"
                  fontWeight="medium"
                  color={
                    summary.liquid.unrealizedGainLoss >= 0 ? 'success.main' : 'error.main'
                  }
                >
                  {formatSignedCurrencyValue(
                    summary.liquid.unrealizedGainLoss,
                    formatCurrencyValue,
                  )}
                </Typography>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          {/* Restricted Long-term Savings Section */}
          <Card sx={{ p: 3, height: '100%', border: '2px solid', borderColor: 'warning.light' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <SchoolIcon sx={{ mr: 2, fontSize: 28, color: 'warning.main' }} />
              <Box>
                <Typography variant="h5" fontWeight="bold" color="warning.main">
                  {t('restricted.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('restricted.subtitle', {
                    count: summary.restricted.accountsCount,
                  })}
                </Typography>
              </Box>
            </Box>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('restricted.currentValue')}
                </Typography>
                <Typography variant="h4" fontWeight="bold" color="warning.main">
                  {formatCurrencyValue(summary.restricted.totalValue)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('restricted.unrealized')}
                </Typography>
                <Typography
                  variant="h6"
                  fontWeight="medium"
                  color={
                    summary.restricted.unrealizedGainLoss >= 0
                      ? 'success.main'
                      : 'error.main'
                  }
                >
                  {formatSignedCurrencyValue(
                    summary.restricted.unrealizedGainLoss,
                    formatCurrencyValue,
                  )}
                </Typography>
              </Grid>
            </Grid>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default InvestmentsSummarySection;
