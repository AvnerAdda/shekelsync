import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  LinearProgress,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import type { ChipProps } from '@mui/material';
import type { LinearProgressProps } from '@mui/material/LinearProgress';
import {
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { BudgetHealthItem, BudgetHealthResponse } from '@renderer/types/budget-intelligence';
import { useTranslation } from 'react-i18next';

const BudgetHealthDashboard: React.FC = () => {
  const [health, setHealth] = useState<BudgetHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { formatCurrency } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.budgetHealth' });

  useEffect(() => {
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<BudgetHealthResponse>('/api/budget-intelligence/health');
      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }
      setHealth(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Error fetching budget health:', err);
    } finally {
      setLoading(false);
    }
  };

  type StatusColor = Exclude<ChipProps['color'], undefined>;

  const getStatusColor = (status: BudgetHealthItem['status']): StatusColor => {
    switch (status) {
      case 'on_track':
        return 'success';
      case 'warning':
        return 'warning';
      case 'exceeded':
        return 'error';
      default:
        return 'info';
    }
  };

  const getStatusIcon = (status: BudgetHealthItem['status']) => {
    switch (status) {
      case 'on_track':
        return <CheckIcon />;
      case 'warning':
        return <WarningIcon />;
      case 'exceeded':
        return <ErrorIcon />;
      default:
        return <TrendingUpIcon />;
    }
  };

  const getStatusLabel = (status: BudgetHealthItem['status']) => {
    switch (status) {
      case 'on_track':
        return t('labels.onTrack');
      case 'warning':
        return t('labels.warning');
      case 'exceeded':
        return t('labels.exceeded');
      default:
        return t('labels.unknown');
    }
  };

  const getProgressColor = (status: BudgetHealthItem['status']): LinearProgressProps['color'] => {
    if (status === 'exceeded') return 'error';
    if (status === 'warning') return 'warning';
    return 'success';
  };

  const getCategoryLabel = (budget: BudgetHealthItem) => {
    const locale = i18n.language?.split('-')[0] || 'he';
    if (locale === 'fr') {
      return budget.category_name_fr || budget.category_name_en || budget.category_name;
    }
    if (locale === 'en') {
      return budget.category_name_en || budget.category_name_fr || budget.category_name;
    }
    return budget.category_name;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        {error}
      </Alert>
    );
  }

  if (!health || !health.budgets || health.budgets.length === 0) {
    return (
      <Box>
        <Typography variant="h6" fontWeight="bold" gutterBottom>
          {t('title')}
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2" fontWeight="bold" gutterBottom>
            {t('empty.title')}
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('empty.instructions')}
          </Typography>
          <Box component="ol" sx={{ pl: 2, mb: 0 }}>
            <li>{t('empty.steps.step1')}</li>
            <li>{t('empty.steps.step2')}</li>
            <li>{t('empty.steps.step3')}</li>
            <li>{t('empty.steps.step4')}</li>
          </Box>
        </Alert>
      </Box>
    );
  }

  const overallStatusLabel = t(`overall.status.${health.overall_status ?? 'unknown'}`, {
    defaultValue: health.overall_status ?? t('labels.unknown'),
  });

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" fontWeight="bold" gutterBottom>
          {t('title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('subtitle')}
        </Typography>
      </Box>

      {/* Overall Status */}
      <Alert
        severity={
          health.overall_status === 'good' ? 'success' :
          health.overall_status === 'warning' ? 'warning' : 'error'
        }
        sx={{ mb: 3 }}
      >
        <Typography variant="body2" fontWeight="bold">
          {t('overall.title', { status: overallStatusLabel })}
        </Typography>
        <Typography variant="caption">
          {t('overall.breakdown', {
            onTrack: health.budgets.filter(b => b.status === 'on_track').length,
            warning: health.budgets.filter(b => b.status === 'warning').length,
            exceeded: health.budgets.filter(b => b.status === 'exceeded').length,
          })}
        </Typography>
      </Alert>

      {health.summary && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={4}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  {t('summary.totalBudget')}
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {formatCurrency(health.summary.total_budget || 0, { maximumFractionDigits: 0 })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('summary.categoriesTracked', { count: health.summary.total_budgets || 0 })}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  {t('summary.spentThisMonth')}
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {formatCurrency(health.summary.total_spent || 0, { maximumFractionDigits: 0 })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('summary.statusCounts', { onTrack: health.summary.on_track, warning: health.summary.warning })}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  {t('summary.remainingHeadroom')}
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {formatCurrency((health.summary.total_budget || 0) - (health.summary.total_spent || 0), { maximumFractionDigits: 0 })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('summary.exceededCount', { count: health.summary.exceeded })}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Budget Items */}
      <Grid container spacing={2}>
        {health.budgets.map((budget) => (
          <Grid item xs={12} md={6} key={budget.category_id}>
            <Card
              variant="outlined"
              sx={{
                borderColor: getStatusColor(budget.status) + '.main',
                borderWidth: budget.status !== 'on_track' ? 2 : 1,
              }}
            >
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {getCategoryLabel(budget)}
                  </Typography>
                  <Chip
                    label={getStatusLabel(budget.status)}
                    color={getStatusColor(budget.status)}
                    icon={getStatusIcon(budget.status)}
                    size="small"
                  />
                </Box>

                {/* Progress Bar */}
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('budget.spent', { amount: formatCurrency(budget.current_spent || 0, { maximumFractionDigits: 0 }) })}
                    </Typography>
                    <Typography variant="caption" fontWeight="bold">
                      {(budget.percentage_used || 0).toFixed(0)}%
                    </Typography>
                  </Box>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(budget.percentage_used || 0, 100)}
                      color={getProgressColor(budget.status)}
                      sx={{ height: 8, borderRadius: 4 }}
                    />
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {t('budget.limit', { amount: formatCurrency(budget.budget_limit || 0, { maximumFractionDigits: 0 }) })}
                  </Typography>
                </Box>

                {/* Stats Grid */}
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      {t('budget.daysRemaining')}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {t('budget.daysValue', { count: budget.days_remaining || 0 })}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      {t('budget.dailyLimit')}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {t('budget.dailyValue', {
                        amount: formatCurrency(budget.daily_limit || 0, { maximumFractionDigits: 0 }),
                      })}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      {t('budget.dailyAverage')}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {t('budget.dailyValue', {
                        amount: formatCurrency(budget.daily_avg || 0, { maximumFractionDigits: 0 }),
                      })}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">
                      {t('budget.projected')}
                    </Typography>
                    <Typography
                      variant="body2"
                      fontWeight="bold"
                      color={
                        (budget.projected_total || 0) > (budget.budget_limit || 0) ? 'error.main' :
                        (budget.projected_total || 0) > (budget.budget_limit || 0) * 0.9 ? 'warning.main' :
                        'success.main'
                      }
                    >
                      {formatCurrency(budget.projected_total || 0, { maximumFractionDigits: 0 })}
                      {(budget.projected_total || 0) > (budget.budget_limit || 0) && (
                        <Typography component="span" variant="caption" sx={{ ml: 1 }}>
                          {t('budget.overBy', {
                            amount: formatCurrency((budget.projected_total || 0) - (budget.budget_limit || 0), { maximumFractionDigits: 0 }),
                          })}
                        </Typography>
                      )}
                    </Typography>
                  </Grid>
                </Grid>

                {/* Warning/Error Messages */}
                {budget.status === 'warning' && (
                  <Alert severity="warning" sx={{ mt: 2 }} icon={<WarningIcon fontSize="small" />}>
                    <Typography variant="caption">
                      {t('budget.alerts.warning', {
                        percent: (budget.percentage_used || 0).toFixed(0),
                        days: budget.days_remaining || 0,
                      })}
                    </Typography>
                  </Alert>
                )}

                {budget.status === 'exceeded' && (
                  <Alert severity="error" sx={{ mt: 2 }} icon={<ErrorIcon fontSize="small" />}>
                    <Typography variant="caption">
                      {t('budget.alerts.exceeded')}
                    </Typography>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default BudgetHealthDashboard;
