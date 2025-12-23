import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Grid,
  Paper,
  useTheme,
  Alert,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  BarChart as RechartsBarChart,
  LineChart as RechartsLineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';

interface FinancialRhythmModalProps {
  open: boolean;
  onClose: () => void;
}

type TimeRange = 'all' | '6months' | '3months';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <Paper sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {payload.map((entry: any, index: number) => (
          <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: entry.color, borderRadius: 1 }} />
            <Typography variant="body2">
              {entry.name}: {entry.value}
            </Typography>
          </Box>
        ))}
      </Paper>
    );
  }
  return null;
};

const FinancialRhythmModal: React.FC<FinancialRhythmModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.rhythm' });
  const { i18n } = useTranslation();
  const { formatCurrency } = useFinancePrivacy();
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('6months');
  const [viewMode, setViewMode] = useState<'amount' | 'count'>('amount');
  const [evolutionGranularity, setEvolutionGranularity] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Record<TimeRange, number>>({ all: 0, '6months': 0, '3months': 0 });

  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    if (open && (Date.now() - lastFetch[timeRange]) > CACHE_DURATION) {
      fetchData();
    }
  }, [open, timeRange]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/api/analytics/temporal?timeRange=${timeRange}`);
      if (!response.ok) {
        throw new Error(t('../../errors.fetchFailed', { defaultValue: 'Failed to fetch data' }));
      }
      setData(response.data);
      setLastFetch(prev => ({ ...prev, [timeRange]: Date.now() }));
    } catch (err) {
      console.error('Failed to fetch temporal data:', err);
      setError(err instanceof Error ? err.message : t('../../errors.generic', { defaultValue: 'An error occurred' }));
    } finally {
      setLoading(false);
    }
  };

  const formatCurrencyValue = (value: number) => formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const getEvolutionData = () => {
    if (!data) return [];

    let evolutionData;
    switch (evolutionGranularity) {
      case 'daily':
        evolutionData = data.dailyEvolution || [];
        break;
      case 'monthly':
        evolutionData = data.monthlyEvolution || [];
        break;
      case 'weekly':
      default:
        evolutionData = data.weeklyEvolution || [];
    }

    return evolutionData.map((item: any) => ({
      label: evolutionGranularity === 'daily'
        ? new Date(item.date).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })
        : evolutionGranularity === 'monthly'
        ? new Date(item.date).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' })
        : `Week ${item.week.split('-')[1]}`,
      value: viewMode === 'amount' ? item.amount : item.count,
      date: item.date,
      daysAgo: item.daysAgo
    }));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.default',
          backgroundImage: 'none',
        }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5" fontWeight="bold">
            {t('title')}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ minHeight: { xs: '60vh', sm: '70vh', md: '80vh' }, maxHeight: { xs: '85vh', sm: '85vh', md: '80vh' }, overflow: 'auto', p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <ToggleButtonGroup
            value={timeRange}
            exclusive
            onChange={(_, value) => value && setTimeRange(value)}
            size="small"
          >
            <ToggleButton value="3months">{t('timeRange.3months')}</ToggleButton>
            <ToggleButton value="6months">{t('timeRange.6months')}</ToggleButton>
            <ToggleButton value="all">{t('timeRange.all')}</ToggleButton>
          </ToggleButtonGroup>

          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, value) => value && setViewMode(value)}
            size="small"
          >
            <ToggleButton value="amount">{t('viewMode.amount')}</ToggleButton>
            <ToggleButton value="count">{t('viewMode.count')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
            <Button onClick={fetchData} size="small" sx={{ ml: 2 }}>
              {t('../../actions.retry', { defaultValue: 'Retry' })}
            </Button>
          </Alert>
        ) : data ? (
          <Grid container spacing={2}>
            {/* Spending by Hour of Day */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('hourOfDay.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {t('hourOfDay.subtitle')}
                </Typography>
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsBarChart
                    data={Array.from({ length: 24 }, (_, i) => ({
                      hour: `${i}:00`,
                      value: viewMode === 'amount'
                        ? (data.hourlySpending?.[i] || 0)
                        : (data.hourlyTransactionCount?.[i] || 0)
                    }))}
                    margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="hour" stroke={theme.palette.text.secondary} style={{ fontSize: '0.75rem' }} />
                    <YAxis
                      stroke={theme.palette.text.secondary}
                      tickFormatter={viewMode === 'amount' ? formatCurrencyValue : (v) => v.toString()}
                      style={{ fontSize: '0.75rem' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      fill={theme.palette.primary.main}
                      name={viewMode === 'amount' ? t('hourOfDay.spending') : t('hourOfDay.transactions')}
                    />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            {/* Spending by Day of Week */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('dayOfWeek.title')}
                </Typography>
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsBarChart
                    data={[
                      t('days.sun'), t('days.mon'), t('days.tue'),
                      t('days.wed'), t('days.thu'), t('days.fri'), t('days.sat')
                    ].map((day, i) => ({
                      day,
                      value: viewMode === 'amount'
                        ? (data.weekdaySpending?.[i] || 0)
                        : (data.weekdayTransactionCount?.[i] || 0)
                    }))}
                    margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="day" stroke={theme.palette.text.secondary} style={{ fontSize: '0.75rem' }} />
                    <YAxis
                      stroke={theme.palette.text.secondary}
                      tickFormatter={viewMode === 'amount' ? formatCurrencyValue : (v) => v.toString()}
                      style={{ fontSize: '0.75rem' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      fill={theme.palette.secondary.main}
                      name={viewMode === 'amount' ? t('dayOfWeek.spending') : t('dayOfWeek.transactions')}
                    />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            {/* Weekend vs Weekday */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('weekendVsWeekday.title')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('weekendVsWeekday.weekday')}
                    </Typography>
                    <Typography variant="h6" color="primary.main">
                      {formatCurrencyValue(data.weekdayTotal || 0)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {data.weekdayPercentage?.toFixed(0)}%
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('weekendVsWeekday.weekend')}
                    </Typography>
                    <Typography variant="h6" color="secondary.main">
                      {formatCurrencyValue(data.weekendTotal || 0)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {data.weekendPercentage?.toFixed(0)}%
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            </Grid>

            {/* Week-by-Week Trend */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('weeklyTrend.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {t('weeklyTrend.subtitle')}
                </Typography>
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsLineChart
                    data={(data.weeklyTrend || []).map((w: any) => ({
                      week: w.week,
                      value: w.total
                    }))}
                    margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="week" stroke={theme.palette.text.secondary} style={{ fontSize: '0.75rem' }} />
                    <YAxis
                      stroke={theme.palette.text.secondary}
                      tickFormatter={formatCurrencyValue}
                      style={{ fontSize: '0.75rem' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="natural"
                      dataKey="value"
                      stroke={theme.palette.success.main}
                      strokeWidth={2}
                      dot={{ fill: theme.palette.background.paper, strokeWidth: 2, r: 4 }}
                      name={t('weeklyTrend.spending')}
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            {/* Evolution Curve */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                      {t('evolution.title')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t('evolution.subtitle')}
                    </Typography>
                  </Box>
                  <ToggleButtonGroup
                    value={evolutionGranularity}
                    exclusive
                    onChange={(_, value) => value && setEvolutionGranularity(value)}
                    size="small"
                  >
                    <ToggleButton value="daily">{t('evolution.daily')}</ToggleButton>
                    <ToggleButton value="weekly">{t('evolution.weekly')}</ToggleButton>
                    <ToggleButton value="monthly">{t('evolution.monthly')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>

                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={getEvolutionData()} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <defs>
                      <linearGradient id="evolutionGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={theme.palette.error.main} stopOpacity={0.8} />
                        <stop offset="50%" stopColor={theme.palette.warning.main} stopOpacity={0.8} />
                        <stop offset="100%" stopColor={theme.palette.success.main} stopOpacity={0.8} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="label" stroke={theme.palette.text.secondary} style={{ fontSize: '0.75rem' }} />
                    <YAxis
                      stroke={theme.palette.text.secondary}
                      tickFormatter={viewMode === 'amount' ? formatCurrencyValue : (v) => v.toString()}
                      style={{ fontSize: '0.75rem' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="url(#evolutionGradient)"
                      fill="url(#evolutionGradient)"
                      fillOpacity={0.3}
                      strokeWidth={2}
                      name={viewMode === 'amount' ? t('evolution.spending') : t('evolution.transactions')}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="url(#evolutionGradient)"
                      strokeWidth={2}
                      dot={{ fill: theme.palette.background.paper, strokeWidth: 2, r: 4 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>

                {/* Color Legend */}
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, mt: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 16, height: 16, bgcolor: theme.palette.error.main, borderRadius: 1 }} />
                    <Typography variant="caption" color="text.secondary">{t('evolution.oldest')}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 16, height: 16, bgcolor: theme.palette.warning.main, borderRadius: 1 }} />
                    <Typography variant="caption" color="text.secondary">{t('evolution.recent')}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 16, height: 16, bgcolor: theme.palette.success.main, borderRadius: 1 }} />
                    <Typography variant="caption" color="text.secondary">{t('evolution.latest')}</Typography>
                  </Box>
                </Box>
              </Paper>
            </Grid>
          </Grid>
        ) : (
          <Typography color="text.secondary" align="center">
            {t('noData')}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FinancialRhythmModal;
