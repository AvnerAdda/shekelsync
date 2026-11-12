import React, { useState, useEffect, useCallback } from 'react';
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
  Tooltip as MuiTooltip,
  Tabs,
  Tab,
  alpha,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import RhythmPeriodView from './rhythm/RhythmPeriodView';
import RhythmDayView from './rhythm/RhythmDayView';
import RhythmChecks from './rhythm/RhythmChecks';
import { clearRhythmComparisonCache, useRhythmComparison } from './rhythm/useRhythmComparison';
import type { RhythmMetric, RhythmScope } from './rhythm/types';

interface FinancialRhythmModalProps {
  open: boolean;
  onClose: () => void;
}

type TimeRange = 'all' | '6months' | '3months';
type RhythmTab = 'month' | 'week' | 'day' | 'habits';
const RHYTHM_TABS: RhythmTab[] = ['month', 'week', 'day', 'habits'];
const CACHE_DURATION_MS = 5 * 60 * 1000;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <Paper sx={{ p: 1.5 }}>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
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
  const [tab, setTab] = useState<RhythmTab>('month');
  const [metric, setMetric] = useState<RhythmMetric>('spend');
  const [scope, setScope] = useState<RhythmScope>('all');
  const isComparison = tab !== 'habits';
  const comparison = useRhythmComparison(
    isComparison ? tab : 'month',
    metric,
    metric === 'income' ? 'all' : scope,
    open && isComparison,
  );
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('6months');
  const [viewMode, setViewMode] = useState<'amount' | 'count'>('amount');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Record<TimeRange, number>>({ all: 0, '6months': 0, '3months': 0 });

  const fetchData = useCallback(async () => {
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
  }, [t, timeRange]);

  useEffect(() => {
    if (open && tab === 'habits' && (Date.now() - lastFetch[timeRange]) > CACHE_DURATION_MS) {
      fetchData();
    }
  }, [fetchData, lastFetch, open, tab, timeRange]);

  const formatCurrencyValue = (value: number) => formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const dayLabels = [
    t('days.sun'),
    t('days.mon'),
    t('days.tue'),
    t('days.wed'),
    t('days.thu'),
    t('days.fri'),
    t('days.sat')
  ];
  const hourLabels = Array.from({ length: 24 }, (_, i) => i);
  const heatmapMatrix = (
    viewMode === 'amount'
      ? data?.hourlyByDaySpending
      : data?.hourlyByDayCount
  ) ?? Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatmapValues = heatmapMatrix.flat();
  const heatmapMax = heatmapValues.length > 0 ? Math.max(...heatmapValues) : 0;
  const formatHeatmapValue = (value: number) => (
    viewMode === 'amount'
      ? formatCurrencyValue(value)
      : value.toLocaleString(i18n.language)
  );
  const getHeatmapColor = (value: number) => {
    if (heatmapMax <= 0) {
      return alpha(theme.palette.primary.main, 0.08);
    }
    const intensity = Math.min(value / heatmapMax, 1);
    return alpha(theme.palette.primary.main, 0.15 + intensity * 0.75);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: alpha(theme.palette.background.paper, 0.8),
            backdropFilter: 'blur(20px)',
            backgroundImage: 'none',
            boxShadow: theme.shadows[24],
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }
        }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography
            variant="h5"
            sx={{
              fontWeight: "bold",
              background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              backgroundClip: 'text',
              textFillColor: 'transparent',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
            {t('title')}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <Box sx={{ px: { xs: 2, sm: 3 }, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tab}
          onChange={(_, value: RhythmTab) => setTab(value)}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {RHYTHM_TABS.map((value) => (
            <Tab key={value} value={value} label={t(`tabs.${value}`)} />
          ))}
        </Tabs>
      </Box>
      <DialogContent sx={{ minHeight: { xs: '60vh', sm: '70vh', md: '76vh' }, maxHeight: { xs: '85vh', sm: '85vh', md: '76vh' }, overflow: 'auto', p: { xs: 2, sm: 3 } }}>
        {isComparison ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
              <ToggleButtonGroup
                value={metric}
                exclusive
                onChange={(_, value) => value && setMetric(value)}
                size="small"
                sx={{ bgcolor: alpha(theme.palette.background.paper, 0.5) }}
              >
                <ToggleButton value="spend">{t('compare.metric.spend')}</ToggleButton>
                <ToggleButton value="income">{t('compare.metric.income')}</ToggleButton>
              </ToggleButtonGroup>
              {metric === 'spend' && (
                <MuiTooltip title={t('compare.scope.hint')} placement="bottom-end">
                  <ToggleButtonGroup
                    value={scope}
                    exclusive
                    onChange={(_, value) => value && setScope(value)}
                    size="small"
                    sx={{ bgcolor: alpha(theme.palette.background.paper, 0.5) }}
                  >
                    <ToggleButton value="all">{t('compare.scope.all')}</ToggleButton>
                    <ToggleButton value="everyday">{t('compare.scope.everyday')}</ToggleButton>
                  </ToggleButtonGroup>
                </MuiTooltip>
              )}
            </Box>
            {comparison.loading && !comparison.data ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
              </Box>
            ) : comparison.error && !comparison.data ? (
              <Alert severity="error">
                {t('compare.loadFailed')}
                <Button onClick={comparison.reload} size="small" sx={{ ml: 2 }}>
                  {t('../../actions.retry', { defaultValue: 'Retry' })}
                </Button>
              </Alert>
            ) : comparison.data ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: comparison.loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
                <RhythmChecks
                  checks={comparison.data.checks}
                  onRepaired={() => {
                    clearRhythmComparisonCache();
                    void comparison.reload();
                  }}
                />
                {comparison.data.granularity === 'day'
                  ? <RhythmDayView data={comparison.data} />
                  : <RhythmPeriodView data={comparison.data} />}
              </Box>
            ) : null}
          </Box>
        ) : (
        <>
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <ToggleButtonGroup
            value={timeRange}
            exclusive
            onChange={(_, value) => value && setTimeRange(value)}
            size="small"
            sx={{ bgcolor: alpha(theme.palette.background.paper, 0.5) }}
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
            sx={{ bgcolor: alpha(theme.palette.background.paper, 0.5) }}
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
          <Grid container spacing={3}>
            {/* Spending by Hour of Day */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Paper sx={{ p: 2, height: '100%', bgcolor: alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 2 }}>
                <Typography variant="subtitle2" gutterBottom sx={{
                  fontWeight: "bold"
                }}>
                  {t('hourOfDay.title')}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    display: "block",
                    mb: 1
                  }}>
                  {t('hourOfDay.subtitle')}
                </Typography>
                <ResponsiveContainer width="100%" height={200} minHeight={200}>
                  <RechartsBarChart
                    data={Array.from({ length: 24 }, (_, i) => ({
                      hour: `${i}:00`,
                      value: viewMode === 'amount'
                        ? (data.hourlySpending?.[i] || 0)
                        : (data.hourlyTransactionCount?.[i] || 0)
                    }))}
                    margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                  >
                    <defs>
                      <linearGradient id="hourGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.8}/>
                        <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0.2}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.1)} vertical={false} />
                    <XAxis dataKey="hour" stroke={theme.palette.text.secondary} style={{ fontSize: '0.75rem' }} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke={theme.palette.text.secondary}
                      tickFormatter={viewMode === 'amount' ? formatCurrencyValue : (v) => v.toString()}
                      style={{ fontSize: '0.75rem' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: alpha(theme.palette.primary.main, 0.1) }} />
                    <Bar
                      dataKey="value"
                      fill="url(#hourGradient)"
                      radius={[4, 4, 0, 0]}
                      name={viewMode === 'amount' ? t('hourOfDay.spending') : t('hourOfDay.transactions')}
                    />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            {/* Spending by Day of Week */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Paper sx={{ p: 2, height: '100%', bgcolor: alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 2 }}>
                <Typography variant="subtitle2" gutterBottom sx={{
                  fontWeight: "bold"
                }}>
                  {t('dayOfWeek.title')}
                </Typography>
                <ResponsiveContainer width="100%" height={200} minHeight={200}>
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
                    <defs>
                      <linearGradient id="dayGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.palette.secondary.main} stopOpacity={0.8}/>
                        <stop offset="95%" stopColor={theme.palette.secondary.main} stopOpacity={0.2}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.1)} vertical={false} />
                    <XAxis dataKey="day" stroke={theme.palette.text.secondary} style={{ fontSize: '0.75rem' }} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke={theme.palette.text.secondary}
                      tickFormatter={viewMode === 'amount' ? formatCurrencyValue : (v) => v.toString()}
                      style={{ fontSize: '0.75rem' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: alpha(theme.palette.secondary.main, 0.1) }} />
                    <Bar
                      dataKey="value"
                      fill="url(#dayGradient)"
                      radius={[4, 4, 0, 0]}
                      name={viewMode === 'amount' ? t('dayOfWeek.spending') : t('dayOfWeek.transactions')}
                    />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            {/* Weekend vs Weekday */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Paper sx={{ p: 2, height: '100%', bgcolor: alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Typography variant="subtitle2" gutterBottom sx={{
                  fontWeight: "bold"
                }}>
                  {t('weekendVsWeekday.title')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                  <Box sx={{ flex: 1, p: 2, bgcolor: alpha(theme.palette.primary.main, 0.1), borderRadius: 2, textAlign: 'center' }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        mb: 1
                      }}>
                      {t('weekendVsWeekday.weekday')}
                    </Typography>
                    <Typography
                      variant="h6"
                      sx={{
                        color: "primary.main",
                        fontWeight: "bold"
                      }}>
                      {formatCurrencyValue(data.weekdayTotal || 0)}
                    </Typography>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {data.weekdayPercentage?.toFixed(0)}%
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1, p: 2, bgcolor: alpha(theme.palette.secondary.main, 0.1), borderRadius: 2, textAlign: 'center' }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        mb: 1
                      }}>
                      {t('weekendVsWeekday.weekend')}
                    </Typography>
                    <Typography
                      variant="h6"
                      sx={{
                        color: "secondary.main",
                        fontWeight: "bold"
                      }}>
                      {formatCurrencyValue(data.weekendTotal || 0)}
                    </Typography>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {data.weekendPercentage?.toFixed(0)}%
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            </Grid>

            {/* Hour/Day Heatmap */}
            <Grid size={{ xs: 12 }}>
              <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 2 }}>
                <Typography variant="subtitle2" gutterBottom sx={{
                  fontWeight: "bold"
                }}>
                  {t('heatmap.title')}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    display: "block",
                    mb: 1
                  }}>
                  {t('heatmap.subtitle')}
                </Typography>
                {heatmapMax > 0 ? (
                  <Box sx={{ overflowX: 'auto', pb: 1 }}>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '48px repeat(24, minmax(10px, 1fr))',
                        gap: 0.5,
                        alignItems: 'center',
                        minWidth: 500
                      }}
                    >
                      <Box />
                      {hourLabels.map((hour) => (
                        <Typography
                          key={`hour-label-${hour}`}
                          variant="caption"
                          align="center"
                          sx={{
                            color: "text.secondary",
                            fontSize: '0.65rem',
                            lineHeight: 1
                          }}>
                          {hour % 3 === 0 ? hour : ''}
                        </Typography>
                      ))}
                      {dayLabels.map((dayLabel, dayIndex) => (
                        <React.Fragment key={`day-row-${dayLabel}`}>
                          <Typography
                            variant="caption"
                            sx={{
                              color: "text.secondary",
                              pr: 1
                            }}>
                            {dayLabel}
                          </Typography>
                          {hourLabels.map((hour) => {
                            const value = heatmapMatrix?.[dayIndex]?.[hour] ?? 0;
                            return (
                              <MuiTooltip
                                key={`cell-${dayIndex}-${hour}`}
                                title={(
                                  <Box sx={{ p: 0.5 }}>
                                    <Typography variant="caption" sx={{
                                      color: "text.secondary"
                                    }}>
                                      {dayLabel} • {String(hour).padStart(2, '0')}:00
                                    </Typography>
                                    <Typography variant="body2" sx={{
                                      fontWeight: "bold"
                                    }}>
                                      {formatHeatmapValue(value)}
                                    </Typography>
                                  </Box>
                                )}
                                arrow
                                placement="top"
                              >
                                <Box
                                  sx={{
                                    height: 16,
                                    borderRadius: 0.5,
                                    bgcolor: getHeatmapColor(value),
                                    border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                                    cursor: 'default'
                                  }}
                                />
                              </MuiTooltip>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('noData')}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{t('heatmap.low')}</Typography>
                  <Box
                    sx={{
                      width: 120,
                      height: 8,
                      borderRadius: 4,
                      background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.15)}, ${alpha(theme.palette.primary.main, 0.9)})`
                    }}
                  />
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{t('heatmap.high')}</Typography>
                </Box>
              </Paper>
            </Grid>

          </Grid>
        ) : (
          <Typography align="center" sx={{
            color: "text.secondary"
          }}>
            {t('noData')}
          </Typography>
        )}
        </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FinancialRhythmModal;
