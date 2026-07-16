import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Grid,
  Paper,
  Skeleton,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import PaymentsIcon from '@mui/icons-material/Payments';
import PercentIcon from '@mui/icons-material/Percent';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import EditIcon from '@mui/icons-material/Edit';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { RealEstateOverviewProperty, RealEstateOverviewResponse } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface RealEstateOverviewSectionProps {
  refreshSignal?: number;
  onEditProperty?: (accountId: number) => void;
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '-';
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const RealEstateOverviewSection: React.FC<RealEstateOverviewSectionProps> = ({
  refreshSignal = 0,
  onEditProperty,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [data, setData] = React.useState<RealEstateOverviewResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    apiClient.get<RealEstateOverviewResponse>('/api/investments/real-estate/overview')
      .then((response) => {
        if (!active) return;
        if (!response.ok) {
          throw new Error(response.statusText || t('errors.loadFailed', 'Failed to load real estate overview'));
        }
        setData(response.data as RealEstateOverviewResponse);
      })
      .catch((loadError) => {
        if (!active) return;
        console.error('Failed to load real estate overview:', loadError);
        setError(loadError instanceof Error
          ? loadError.message
          : t('errors.loadFailed', 'Failed to load real estate overview'));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [refreshSignal, t]);

  const money = React.useCallback((value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  }, [formatCurrency, maskAmounts]);

  if (loading) {
    return (
      <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Grid container spacing={2}>
          {[0, 1, 2, 3].map((item) => (
            <Grid key={item} size={{ xs: 12, sm: 6, lg: 3 }}>
              <Skeleton variant="rounded" height={132} />
            </Grid>
          ))}
        </Grid>
        <Skeleton variant="rounded" height={360} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert role="tabpanel" severity="warning" sx={{ borderRadius: 2 }}>
        {error}
      </Alert>
    );
  }

  const properties = data?.properties || [];
  const summary = data?.summary;

  if (!data || properties.length === 0 || !summary) {
    return (
      <Paper role="tabpanel" sx={{ p: 4, textAlign: 'center' }}>
        <HomeWorkIcon sx={{ fontSize: 56, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" sx={{
          fontWeight: 700
        }}>
          {t('empty.title', 'No real estate assets yet')}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 1,
            mb: 3
          }}>
          {t('empty.description', 'Add a real estate investment account and save simulator details to track equity and mortgage exposure.')}
        </Typography>
      </Paper>
    );
  }

  const kpis = [
    {
      label: t('kpis.marketValue', 'Property market value'),
      value: money(summary.propertyMarketValue),
      hint: t('hints.marketValue', 'Current simulator value before debt'),
      icon: <HomeWorkIcon fontSize="small" />,
      color: theme.palette.primary.main,
    },
    {
      label: t('kpis.netEquity', 'Net equity'),
      value: money(summary.netEquity),
      hint: t('hints.netEquity', 'Owned value minus mortgage share'),
      icon: <QueryStatsIcon fontSize="small" />,
      color: theme.palette.success.main,
    },
    {
      label: t('kpis.mortgage', 'Mortgage balance'),
      value: money(summary.totalMortgageBalance),
      hint: t('hints.mortgage', 'Total mortgage balance entered'),
      icon: <AccountBalanceIcon fontSize="small" />,
      color: theme.palette.warning.main,
    },
    {
      label: t('kpis.monthlyPayment', 'Monthly payment'),
      value: money(summary.monthlyMortgagePayment),
      hint: t('hints.monthlyPayment', 'Total monthly mortgage payment'),
      icon: <PaymentsIcon fontSize="small" />,
      color: theme.palette.info.main,
    },
    {
      label: t('kpis.loanToValue', 'Loan to value'),
      value: formatPercent(summary.averageLoanToValue),
      hint: t('hints.loanToValue', 'Mortgage divided by property value'),
      icon: <PercentIcon fontSize="small" />,
      color: theme.palette.secondary.main,
    },
  ];

  const renderProperty = (property: RealEstateOverviewProperty) => {
    const location = [property.city, property.neighborhood].filter(Boolean).join(' / ')
      || t('property.unknownLocation', 'Location not set');
    const monthlyCashFlow = property.monthlyCashFlow;
    const cashFlowColor = monthlyCashFlow === null
      ? theme.palette.text.secondary
      : monthlyCashFlow >= 0
        ? theme.palette.success.main
        : theme.palette.error.main;

    return (
      <Card
        key={property.accountId}
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 2,
          borderColor: alpha(theme.palette.divider, 0.7),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{
              fontWeight: 800
            }}>
              {property.accountName}
            </Typography>
            <Typography variant="body2" noWrap sx={{
              color: "text.secondary"
            }}>
              {location}
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{
              flexWrap: "wrap",
              justifyContent: "flex-end"
            }}>
            <Chip
              size="small"
              label={property.confidence || t('property.noConfidence', 'draft')}
              variant="outlined"
            />
            <Button
              size="small"
              startIcon={<EditIcon />}
              onClick={() => onEditProperty?.(property.accountId)}
            >
              {t('actions.edit', 'Edit')}
            </Button>
          </Stack>
        </Box>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.marketValue', 'Market value')}
            </Typography>
            <Typography variant="body1" sx={{
              fontWeight: 800
            }}>
              {money(property.propertyMarketValue)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.netEquity', 'Net equity')}
            </Typography>
            <Typography variant="body1" sx={{
              fontWeight: 800
            }}>
              {money(property.netEquity)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.mortgage', 'Mortgage')}
            </Typography>
            <Typography variant="body1" sx={{
              fontWeight: 800
            }}>
              {money(property.totalMortgageBalance)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.payment', 'Payment')}
            </Typography>
            <Typography variant="body1" sx={{
              fontWeight: 800
            }}>
              {money(property.monthlyMortgagePayment)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.ownership', 'Ownership')}
            </Typography>
            <Typography variant="body2" sx={{
              fontWeight: 700
            }}>
              {formatPercent(property.ownershipPercentage)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.loanToValue', 'LTV')}
            </Typography>
            <Typography variant="body2" sx={{
              fontWeight: 700
            }}>
              {formatPercent(property.loanToValue)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.cashFlow', 'Monthly cash flow')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 800,
                color: cashFlowColor
              }}>
              {money(monthlyCashFlow)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('property.updated', 'Valuation date')}
            </Typography>
            <Typography variant="body2" sx={{
              fontWeight: 700
            }}>
              {formatDate(property.lastValuationDate)}
            </Typography>
          </Grid>
        </Grid>
      </Card>
    );
  };

  return (
    <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Alert severity="info" sx={{ borderRadius: 2 }}>
        {t('marketDataNotice', 'Valuation is currently based on your saved simulator assumptions. Comparable sale data by address/type is not connected yet.')}
      </Alert>
      <Grid container spacing={2}>
        {kpis.map((kpi) => (
          <Grid key={kpi.label} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Paper
              sx={{
                p: 2,
                height: '100%',
                border: `1px solid ${alpha(kpi.color, 0.25)}`,
                bgcolor: alpha(kpi.color, theme.palette.mode === 'dark' ? 0.08 : 0.04),
              }}
              elevation={0}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: kpi.color, mb: 1 }}>
                {kpi.icon}
                <Typography variant="caption" sx={{
                  fontWeight: 800
                }}>
                  {kpi.label}
                </Typography>
              </Box>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 900,
                  lineHeight: 1.1
                }}>
                {kpi.value}
              </Typography>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                {kpi.hint}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Paper sx={{ p: 2.5 }} elevation={0}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{
            fontWeight: 800
          }}>
            {t('propertiesTitle', 'Properties')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('propertiesSubtitle', 'Review value, debt, equity and monthly payment assumptions.')}
          </Typography>
        </Box>
        <Stack spacing={1.5}>
          {properties.map(renderProperty)}
        </Stack>
      </Paper>
    </Box>
  );
};

export default RealEstateOverviewSection;
