import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Paper,
  Typography,
  useTheme,
  Grid,
  Card,
  CardContent,
  LinearProgress,
  CircularProgress,
  Alert,
  Button,
  Skeleton,
  Chip,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Lightbulb as ActionsIcon,
  PieChart as SpendingIcon,
  AccountBalance as BudgetIcon,
  Speed as ScoringIcon,
  CalendarToday as CalendarIcon,
  Psychology as PsychologyIcon,
  AttachMoney as MoneyIcon,
  Timeline as TimelineIcon,
  Refresh as RefreshIcon,
  ZoomOutMap as ZoomOutMapIcon,
} from '@mui/icons-material';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip as RechartsTooltip
} from 'recharts';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import LockedPagePlaceholder from '@renderer/shared/empty-state/LockedPagePlaceholder';
import SmartActionItemsPanel from '../components/SmartActionItemsPanel';
import SpendingCategoriesChart from '../components/SpendingCategoriesChart';
import SpendingCategoryTargetsMinimal from '../components/SpendingCategoryTargetsMinimal';
import FinancialHealthScore, { type FinancialHealthSnapshot } from '../components/FinancialHealthScore';
import FinancialRhythmModal from '../components/FinancialRhythmModal';
import MoneyPersonalityModal from '../components/MoneyPersonalityModal';
import PersonalizedFutureModal from '../components/PersonalizedFutureModal';
import MakeItRealModal from '../components/MakeItRealModal';
import { apiClient } from '@renderer/lib/api-client';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@mui/material';
import CategoryIcon from '@renderer/features/breakdown/components/CategoryIcon';

type UnknownRecord = Record<string, unknown>;

interface WeekendVsWeekday {
  weekendSpend: number;
  weekdaySpend: number;
  weekendPercentage: number;
}

interface TemporalIntelligence {
  hourlyHeatmap: number[];
  preciseTimePercentage?: number;
  financialRunwayDays?: number;
  dailyBurnRate?: number;
  peakSpendingHour?: number;
  paydayEffect?: number;
  weekendVsWeekday?: WeekendVsWeekday;
}

interface BehavioralIntelligence {
  impulseSpendingScore?: number;
  averageTransactionSize?: number;
  smallTransactionCount?: number;
  fomoScore?: number;
}

interface PredictiveAnalytics {
  savingsTrajectory6m?: number;
  monthlySavings?: number;
  forecastEndMonth?: number;
  spendingVelocity?: number;
}

interface PsychologicalInsights {
  hourlyWage?: number;
  avgTransactionInHours?: number | string;
  biggestPurchaseHours?: number | string;
}

interface BudgetOutlookItem {
  budgetId: number | null;
  categoryDefinitionId: number;
  categoryName: string;
  categoryNameEn?: string | null;
  categoryIcon?: string | null;
  categoryColor?: string | null;
  parentCategoryId?: number | null;
  limit: number;
  actualSpent: number;
  forecasted: number;
  projectedTotal: number;
  utilization: number;
  status: 'exceeded' | 'at_risk' | 'on_track';
  risk: number;
  alertThreshold: number;
  nextLikelyHitDate?: string | null;
  actions?: string[];
}

interface BudgetForecastSummary {
  totalBudgets: number;
  highRisk: number;
  exceeded: number;
  totalProjectedOverrun: number;
}

interface PersonalIntelligence extends FinancialHealthSnapshot {
  temporalIntelligence?: TemporalIntelligence | null;
  behavioralIntelligence?: BehavioralIntelligence | null;
  comparativeIntelligence?: UnknownRecord | null;
  microInsights?: UnknownRecord | null;
  efficiencyMetrics?: UnknownRecord | null;
  predictiveAnalytics?: PredictiveAnalytics | null;
  psychologicalInsights?: PsychologicalInsights | null;
  recommendations: UnknownRecord[];
  userProfile?: UnknownRecord | null;
  dataQuality?: UnknownRecord | null;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`analysis-tabpanel-${index}`}
      aria-labelledby={`analysis-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const AnalysisPageNew: React.FC = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage' });
  const isHebrew = i18n.language === 'he';
  const [currentTab, setCurrentTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [intelligence, setIntelligence] = useState<PersonalIntelligence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgetOutlook, setBudgetOutlook] = useState<BudgetOutlookItem[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<BudgetForecastSummary | null>(null);
  const [budgetForecastLoading, setBudgetForecastLoading] = useState(false);
  const [budgetForecastError, setBudgetForecastError] = useState<string | null>(null);
  
  // Modal states
  const [rhythmModalOpen, setRhythmModalOpen] = useState(false);
  const [personalityModalOpen, setPersonalityModalOpen] = useState(false);
  const [futureModalOpen, setFutureModalOpen] = useState(false);
  const [realityModalOpen, setRealityModalOpen] = useState(false);
  
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const { formatCurrency } = useFinancePrivacy();
  const accessStatus = getPageAccessStatus('analysis');
  const isLocked = accessStatus.isLocked;

  // Helper function to format hour based on locale
  const formatHour = (hour: number): string => {
    const date = new Date(2000, 0, 1, hour);
    return date.toLocaleTimeString(i18n.language, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: i18n.language !== 'he'
    });
  };

  const fetchIntelligence = useCallback(async () => {
    if (isLocked) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<PersonalIntelligence>('/api/analytics/personal-intelligence?months=3');

      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }

      setIntelligence(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Error fetching personal intelligence:', err);
    } finally {
      setLoading(false);
    }
  }, [isLocked, t]);

  const fetchBudgetForecast = useCallback(async () => {
    if (isLocked) {
      return;
    }
    setBudgetForecastLoading(true);
    setBudgetForecastError(null);

    try {
      const response = await apiClient.get<{ budgetOutlook?: BudgetOutlookItem[]; budgetSummary?: BudgetForecastSummary }>('/api/forecast/daily');
      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }
      const outlook = response.data?.budgetOutlook || [];
      const summary = response.data?.budgetSummary || null;

      if (process.env.NODE_ENV === 'development') {
        console.log('[Analysis][Budget] Received outlook', {
          count: outlook.length,
          names: outlook.slice(0, 10).map((o) => o.categoryName),
          sampleRestaurants: outlook.find((o) => o.categoryDefinitionId === 4 || o.categoryName?.includes('מסעדות') || o.categoryNameEn === 'Restaurants') || null,
        });
      }
      setBudgetOutlook(outlook);
      setBudgetSummary(summary);
    } catch (err) {
      setBudgetForecastError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Error fetching budget forecast:', err);
    } finally {
      setBudgetForecastLoading(false);
    }
  }, [isLocked, t]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
  };

  const handleRefreshAll = useCallback(() => {
    fetchIntelligence();
    fetchBudgetForecast();
  }, [fetchBudgetForecast, fetchIntelligence]);

  useEffect(() => {
    if (isLocked) {
      return;
    }
    fetchIntelligence();
    fetchBudgetForecast();
  }, [fetchBudgetForecast, fetchIntelligence, isLocked]);

  const formatCurrencyValue = (
    value: number,
    options?: { absolute?: boolean; showSign?: boolean; minimumFractionDigits?: number; maximumFractionDigits?: number }
  ) =>
    formatCurrency(value, {
      maximumFractionDigits: options?.maximumFractionDigits ?? 0,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      ...(options?.absolute !== undefined ? { absolute: options.absolute } : {}),
      ...(options?.showSign ? { showSign: true } : {}),
    });

  const formatDateLabel = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString();
  };

  const getBudgetStatusColor = (status: BudgetOutlookItem['status']) => {
    if (status === 'exceeded') return 'error';
    if (status === 'at_risk') return 'warning';
    return 'success';
  };

  const leafOutlook = useMemo(() => {
    const idsWithChildren = new Set<number | string>();
    budgetOutlook.forEach((item) => {
      if (item.parentCategoryId !== null && item.parentCategoryId !== undefined) {
        idsWithChildren.add(item.parentCategoryId);
        idsWithChildren.add(String(item.parentCategoryId));
      }
    });
    // Filter: only leaf categories (no children) with any activity (actual or forecasted)
    return budgetOutlook.filter(
      (item) =>
        !idsWithChildren.has(item.categoryDefinitionId) &&
        !idsWithChildren.has(String(item.categoryDefinitionId)) &&
        (item.forecasted > 0 || item.actualSpent > 0)
    );
  }, [budgetOutlook]);

  const getBudgetStatusLabel = (status: BudgetOutlookItem['status']) => {
    if (status === 'exceeded') return t('budgetForecast.status.exceeded');
    if (status === 'at_risk') return t('budgetForecast.status.atRisk');
    return t('budgetForecast.status.onTrack');
  };

  const getOverUnderLabel = (item: BudgetOutlookItem) => {
    if (!item.limit || item.limit <= 0) return t('budgetForecast.overUnder.noBudget');
    const delta = item.projectedTotal - item.limit;
    if (Math.abs(delta) < 1) return t('budgetForecast.overUnder.breakEven');
    if (delta > 0) {
      return t('budgetForecast.overUnder.over', { amount: formatCurrencyValue(delta, { maximumFractionDigits: 0 }) });
    }
    return t('budgetForecast.overUnder.under', { amount: formatCurrencyValue(Math.abs(delta), { maximumFractionDigits: 0 }) });
  };

  if (isLocked) {
    return (
      <LockedPagePlaceholder page="analysis" onboardingStatus={onboardingStatus} />
    );
  }

  const formatAveragePurchaseHours = () => {
    const value = intelligence?.psychologicalInsights?.avgTransactionInHours;
    if (value === undefined || value === null) return t('dashboard.reality.na');
    if (typeof value === 'number') return value.toFixed(1);
    return value;
  };

  const formatBiggestPurchaseHours = () => {
    const value = intelligence?.psychologicalInsights?.biggestPurchaseHours;
    if (value === undefined || value === null) return t('dashboard.reality.na');
    if (typeof value === 'number') return Math.round(value).toString();
    return value;
  };

  return (
    <Box sx={{ width: '100%', p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            {t('header.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('header.subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={16} aria-label={t('states.loading')} /> : <RefreshIcon />}
          onClick={handleRefreshAll}
          disabled={loading || budgetForecastLoading}
          size="small"
        >
          {loading || budgetForecastLoading ? t('actions.refreshing') : t('actions.refresh')}
        </Button>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          aria-label={t('tabs.ariaLabel')}
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              minHeight: 64,
              textTransform: 'none',
              fontSize: '1rem',
              fontWeight: 500,
            },
          }}
        >
          <Tab
            icon={<DashboardIcon />}
            iconPosition="start"
            label={t('tabs.dashboard')}
            id="analysis-tab-0"
            aria-controls="analysis-tabpanel-0"
          />
          <Tab
            icon={<ActionsIcon />}
            iconPosition="start"
            label={t('tabs.actions')}
            id="analysis-tab-1"
            aria-controls="analysis-tabpanel-1"
          />
          <Tab
            icon={<SpendingIcon />}
            iconPosition="start"
            label={t('tabs.spending')}
            id="analysis-tab-2"
            aria-controls="analysis-tabpanel-2"
          />
          <Tab
            icon={<BudgetIcon />}
            iconPosition="start"
            label={t('tabs.budget')}
            id="analysis-tab-3"
            aria-controls="analysis-tabpanel-3"
          />
          <Tab
            icon={<ScoringIcon />}
            iconPosition="start"
            label={t('tabs.scoring')}
            id="analysis-tab-4"
            aria-controls="analysis-tabpanel-4"
          />
        </Tabs>
      </Paper>

      {/* Tab Content */}
      <TabPanel value={currentTab} index={0}>
        {/* Dashboard Tab */}
        {loading && !intelligence ? (
          <Grid container spacing={2}>
            {[1, 2, 3, 4].map((i) => (
              <Grid item xs={12} md={6} key={i}>
                <Card variant="outlined">
                  <CardContent>
                    <Skeleton variant="text" width={200} height={32} />
                    <Skeleton variant="rectangular" width="100%" height={100} sx={{ mt: 2 }} />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : error ? (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
            <Button variant="contained" onClick={fetchIntelligence} sx={{ mt: 2 }}>
              {t('actions.retry')}
            </Button>
          </Alert>
        ) : !intelligence ? (
          <Alert severity="info" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2" fontWeight="bold">
              {t('states.noDataTitle', { defaultValue: 'No Analysis Data Available' })}
            </Typography>
            <Typography variant="body2">
              {t('states.noDataDescription', { defaultValue: 'Start by importing transactions to see personalized insights and analytics.' })}
            </Typography>
          </Alert>
        ) : (
          <Grid container spacing={2}>
            {/* Your Financial Rhythm */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CalendarIcon color="primary" />
                      <Typography variant="subtitle1" fontWeight="bold">
                        {t('dashboard.rhythm.title')}
                      </Typography>
                    </Box>
                    <Tooltip title={t('dashboard.expandView')}>
                      <Button
                        size="small"
                        onClick={() => setRhythmModalOpen(true)}
                        sx={{ minWidth: 'auto', p: 0.5 }}
                        aria-label={t('dashboard.expandView')}
                      >
                        <ZoomOutMapIcon fontSize="small" />
                      </Button>
                    </Tooltip>
                  </Box>

                  {/* Hourly Spending Heatmap */}
                  {loading ? (
                    <Box sx={{ mb: 2 }}>
                      <Skeleton variant="text" width="60%" height={20} sx={{ mb: 1 }} />
                      <Skeleton variant="rectangular" width="100%" height={100} sx={{ borderRadius: 2 }} />
                    </Box>
                  ) : intelligence.temporalIntelligence?.hourlyHeatmap && intelligence.temporalIntelligence.hourlyHeatmap.length > 0 ? (
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          {t('dashboard.rhythm.spendingByHour')}
                        </Typography>
                        {intelligence.temporalIntelligence.preciseTimePercentage !== undefined && intelligence.temporalIntelligence.preciseTimePercentage < 50 && (
                          <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.75rem' }}>
                            {t('dashboard.rhythm.lowPrecision', { percentage: intelligence.temporalIntelligence.preciseTimePercentage })}
                          </Typography>
                        )}
                      </Box>
                      <ResponsiveContainer width="100%" height={100}>
                        <RechartsBarChart
                          data={[
                            { time: formatHour(0), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(0, 3).reduce((a: number, b: number) => a + b, 0) },
                            { time: formatHour(3), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(3, 6).reduce((a: number, b: number) => a + b, 0) },
                            { time: formatHour(6), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(6, 9).reduce((a: number, b: number) => a + b, 0) },
                            { time: formatHour(9), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(9, 12).reduce((a: number, b: number) => a + b, 0) },
                            { time: formatHour(12), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(12, 15).reduce((a: number, b: number) => a + b, 0) },
                            { time: formatHour(15), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(15, 18).reduce((a: number, b: number) => a + b, 0) },
                            { time: formatHour(18), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(18, 21).reduce((a: number, b: number) => a + b, 0) },
                            { time: formatHour(21), amount: intelligence.temporalIntelligence.hourlyHeatmap.slice(21, 24).reduce((a: number, b: number) => a + b, 0) },
                          ]}
                          margin={{ top: 10, bottom: 30, left: 40, right: 10 }}
                        >
                          <XAxis
                            dataKey="time"
                            stroke={theme.palette.text.secondary}
                            style={{ fontSize: 10 }}
                          />
                          <YAxis
                            stroke={theme.palette.text.secondary}
                            style={{ fontSize: 9 }}
                          />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: theme.palette.background.paper,
                              border: `1px solid ${theme.palette.divider}`,
                              borderRadius: '8px',
                            }}
                          />
                          <Bar dataKey="amount" fill={theme.palette.primary.main} />
                        </RechartsBarChart>
                      </ResponsiveContainer>
                    </Box>
                  ) : null}

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.runway')}</Typography>
                      <Typography variant="h6">{t('dashboard.rhythm.runwayDays', { count: intelligence.temporalIntelligence?.financialRunwayDays || 0 })}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.burnRate')}</Typography>
                      <Typography variant="h6">{formatCurrencyValue(intelligence.temporalIntelligence?.dailyBurnRate || 0)}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.peakHour')}</Typography>
                      <Typography variant="body2">
                        {intelligence.temporalIntelligence?.peakSpendingHour !== undefined
                          ? formatHour(intelligence.temporalIntelligence.peakSpendingHour)
                          : t('dashboard.rhythm.na')}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.paydayEffect')}</Typography>
                      <Typography variant="body2">
                        {Math.round(intelligence.temporalIntelligence?.paydayEffect || 0)}%
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Your Money Personality */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PsychologyIcon color="secondary" />
                      <Typography variant="subtitle1" fontWeight="bold">
                        {t('dashboard.personality.title')}
                      </Typography>
                    </Box>
                    <Tooltip title={t('dashboard.expandView')}>
                      <Button
                        size="small"
                        onClick={() => setPersonalityModalOpen(true)}
                        sx={{ minWidth: 'auto', p: 0.5 }}
                        aria-label={t('dashboard.expandView')}
                      >
                        <ZoomOutMapIcon fontSize="small" />
                      </Button>
                    </Tooltip>
                  </Box>

                  {/* Impulse vs Planned Visual */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">{t('dashboard.personality.spendingStyle')}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, mb: 1 }}>
                      <Box
                        sx={{
                          flex: intelligence.behavioralIntelligence?.impulseSpendingScore || 0,
                          height: 8,
                          bgcolor: 'warning.main',
                          borderRadius: 1,
                          transition: 'all 0.3s'
                        }}
                      />
                      <Box
                        sx={{
                          flex: 100 - (intelligence.behavioralIntelligence?.impulseSpendingScore || 0),
                          height: 8,
                          bgcolor: 'success.main',
                          borderRadius: 1,
                          transition: 'all 0.3s'
                        }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption" color="warning.main">
                        {t('dashboard.personality.impulse', { value: Math.round(intelligence.behavioralIntelligence?.impulseSpendingScore || 0) })}
                      </Typography>
                      <Typography variant="caption" color="success.main">
                        {t('dashboard.personality.planned', { value: Math.round(100 - (intelligence.behavioralIntelligence?.impulseSpendingScore || 0)) })}
                      </Typography>
                    </Box>
                  </Box>

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.personality.avgTransaction')}</Typography>
                      <Typography variant="h6">{formatCurrencyValue(intelligence.behavioralIntelligence?.averageTransactionSize || 0)}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.personality.smallPurchases')}</Typography>
                      <Typography variant="h6">{intelligence.behavioralIntelligence?.smallTransactionCount || 0}</Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.personality.fomoScore')}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={intelligence.behavioralIntelligence?.fomoScore ?? 0}
                          sx={{ flex: 1, height: 6, borderRadius: 3 }}
                          color={(intelligence.behavioralIntelligence?.fomoScore ?? 0) > 70 ? 'error' : (intelligence.behavioralIntelligence?.fomoScore ?? 0) > 40 ? 'warning' : 'success'}
                        />
                        <Typography variant="body2" fontWeight="bold">
                          {intelligence.behavioralIntelligence?.fomoScore ?? 0}/100
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                        {t('dashboard.personality.fomoHint')}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Your Financial Future */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TimelineIcon color="success" />
                      <Typography variant="subtitle1" fontWeight="bold">
                        {t('dashboard.future.title')}
                      </Typography>
                    </Box>
                    <Tooltip title={t('dashboard.expandView')}>
                      <Button
                        size="small"
                        onClick={() => setFutureModalOpen(true)}
                        sx={{ minWidth: 'auto', p: 0.5 }}
                        aria-label={t('dashboard.expandView')}
                      >
                        <ZoomOutMapIcon fontSize="small" />
                      </Button>
                    </Tooltip>
                  </Box>

                  {/* 6-Month Trajectory Sparkline */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">{t('dashboard.future.trajectory')}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        variant="h6"
                        color={(intelligence.predictiveAnalytics?.savingsTrajectory6m ?? 0) > 0 ? 'success.main' : 'error.main'}
                      >
                        {formatCurrencyValue(intelligence.predictiveAnalytics?.savingsTrajectory6m ?? 0, { showSign: true })}
                      </Typography>
                      <Box sx={{ flex: 1, height: 30 }}>
                        <ResponsiveContainer width="100%" height={30}>
                          <LineChart
                            data={Array.from({ length: 6 }, (_, i) => ({
                              month: i + 1,
                              value: (intelligence.predictiveAnalytics?.monthlySavings ?? 0) * (i + 1)
                            }))}
                            margin={{ top: 2, bottom: 2, left: 2, right: 2 }}
                          >
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke={(intelligence.predictiveAnalytics?.savingsTrajectory6m ?? 0) > 0 ? '#4caf50' : '#f44336'}
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </Box>
                    </Box>
                  </Box>

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.future.endOfMonth')}</Typography>
                      <Typography variant="h6" color="primary.main">
                        {formatCurrencyValue(intelligence.predictiveAnalytics?.forecastEndMonth ?? 0)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.future.monthlySavings')}</Typography>
                      <Typography
                        variant="h6"
                        color={(intelligence.predictiveAnalytics?.monthlySavings ?? 0) > 0 ? 'success.main' : 'error.main'}
                      >
                        {formatCurrencyValue(intelligence.predictiveAnalytics?.monthlySavings ?? 0, { showSign: true })}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.future.dailyVelocity')}</Typography>
                      <Typography variant="body2">
                        {t('dashboard.future.velocityValue', {
                          value: formatCurrencyValue(intelligence.predictiveAnalytics?.spendingVelocity ?? 0),
                        })}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Make It Real */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <MoneyIcon color="warning" />
                      <Typography variant="subtitle1" fontWeight="bold">
                        {t('dashboard.reality.title')}
                      </Typography>
                    </Box>
                    <Tooltip title={t('dashboard.expandView')}>
                      <Button
                        size="small"
                        onClick={() => setRealityModalOpen(true)}
                        sx={{ minWidth: 'auto', p: 0.5 }}
                        aria-label={t('dashboard.expandView')}
                      >
                        <ZoomOutMapIcon fontSize="small" />
                      </Button>
                    </Tooltip>
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">{t('dashboard.reality.timeValue')}</Typography>
                    <Typography variant="h6">
                      {t('dashboard.reality.hourlyRate', { value: formatCurrencyValue(intelligence.psychologicalInsights?.hourlyWage || 0) })}
                    </Typography>
                    <Typography variant="caption">
                      {t('dashboard.reality.avgPurchase', { hours: formatAveragePurchaseHours() })}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('dashboard.reality.biggestPurchase')}</Typography>
                    <Typography variant="body2">
                      {t('dashboard.reality.hoursOfWork', { hours: formatBiggestPurchaseHours() })}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </TabPanel>

      <TabPanel value={currentTab} index={1}>
        {/* Actions Tab */}
        <Paper sx={{ p: 3 }}>
          <SmartActionItemsPanel />
        </Paper>
      </TabPanel>

      <TabPanel value={currentTab} index={2}>
        {/* Spending Tab */}
        <Paper sx={{ p: 3 }}>
          <SpendingCategoriesChart months={3} />
          <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider' }}>
            <SpendingCategoryTargetsMinimal />
          </Box>
        </Paper>
      </TabPanel>

      <TabPanel value={currentTab} index={3}>
        {/* Budget Tab */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Unified budget view: forecast risk + health + suggestions */}
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
              <Box>
                <Typography variant="h6">{t('budgetForecast.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('budgetForecast.subtitleUnified')}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={budgetForecastLoading ? <CircularProgress size={16} aria-label={t('states.loading')} /> : <RefreshIcon />}
                onClick={fetchBudgetForecast}
                disabled={budgetForecastLoading}
              >
                {budgetForecastLoading ? t('actions.refreshing') : t('actions.refresh')}
              </Button>
            </Box>

            {budgetForecastError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {budgetForecastError}
              </Alert>
            )}

            {budgetForecastLoading && budgetOutlook.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {[1, 2, 3].map((i) => (
                  <Paper key={`skeleton-${i}`} elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                      <Skeleton variant="circular" width={36} height={36} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton variant="text" width={180} height={24} />
                        <Skeleton variant="text" width={140} height={16} />
                      </Box>
                      <Skeleton variant="rounded" width={70} height={24} />
                    </Box>
                    <Skeleton variant="rounded" width="100%" height={12} sx={{ mb: 1 }} />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Skeleton variant="text" width={80} height={16} />
                      <Skeleton variant="text" width={80} height={16} />
                    </Box>
                  </Paper>
                ))}
              </Box>
            ) : budgetOutlook.length === 0 ? (
              <Alert severity="info" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="body2" fontWeight="bold">
                  {t('budgetForecast.emptyTitle', { defaultValue: 'No Budget Categories' })}
                </Typography>
                <Typography variant="body2">
                  {t('budgetForecast.emptyDescription', { defaultValue: 'Create budgets for your spending categories to track and forecast your expenses.' })}
                </Typography>
              </Alert>
            ) : leafOutlook.length === 0 ? (
              <Alert severity="info">{t('budgetForecast.noForecastedCategories', { defaultValue: 'No categories with active forecast data available.' })}</Alert>
            ) : (
              <Grid container spacing={2}>
                {leafOutlook
                  .slice()
                  .sort((a, b) => {
                    const riskDelta = b.risk - a.risk;
                    if (Math.abs(riskDelta) > 0.001) return riskDelta;
                    return b.utilization - a.utilization;
                  })
                  .map((item, idx) => {
                    const isExceeded = item.status === 'exceeded';
                    const isAtRisk = item.status === 'at_risk';
                    const hasLimit = item.limit > 0;
                    
                    // Use limit for progress calculation since status is based on projected/limit
                    const displayTarget = hasLimit ? item.limit : item.projectedTotal;
                    const actualPct = displayTarget > 0 ? (item.actualSpent / displayTarget) * 100 : 0;
                    
                    const utilizationRatio = hasLimit && item.limit > 0 
                      ? item.projectedTotal / item.limit 
                      : actualPct / 100;
                    const exceededLoops = Math.floor(utilizationRatio);
                    const remainderPct = (utilizationRatio - exceededLoops) * 100;
                    const displayProgress = isExceeded && exceededLoops >= 1 ? remainderPct : Math.min(actualPct, 100);
                    
                    // Display limit as target for budget categories, otherwise show projected total
                    const displayAmount = hasLimit ? item.limit : item.projectedTotal;
                    
                    const categoryName = isHebrew ? item.categoryName : item.categoryNameEn || item.categoryName;
                    const statusColor = isExceeded ? '#dc2626' : isAtRisk ? '#d97706' : '#059669';
                    
                    return (
                      <Grid item xs={12} sm={6} md={4} lg={3} key={`${item.categoryDefinitionId ?? 'cat'}-${idx}`}>
                        <Box
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center',
                            bgcolor: 'background.paper',
                            border: '1px solid',
                            borderColor: 'divider',
                            transition: 'border-color 0.2s',
                            '&:hover': { borderColor: statusColor },
                          }}
                        >
                          {/* Circular Progress */}
                          <Box sx={{ position: 'relative', mb: 1.5 }}>
                            <CircularProgress
                              variant="determinate"
                              value={100}
                              size={56}
                              thickness={2.5}
                              sx={{ color: 'divider', position: 'absolute' }}
                            />
                            <CircularProgress
                              variant="determinate"
                              value={displayProgress}
                              size={56}
                              thickness={2.5}
                              sx={{
                                color: statusColor,
                                '& .MuiCircularProgress-circle': { strokeLinecap: 'round' },
                              }}
                            />
                            <Box
                              sx={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {item.categoryIcon ? (
                                <CategoryIcon iconName={item.categoryIcon} color={item.categoryColor || '#1a1a1a'} size={20} />
                              ) : (
                                <Typography sx={{ color: item.categoryColor || '#1a1a1a', fontWeight: 600, fontSize: 11 }}>
                                  {categoryName?.slice(0, 2) || '?'}
                                </Typography>
                              )}
                            </Box>
                            {isExceeded && exceededLoops >= 1 && (
                              <Box
                                sx={{
                                  position: 'absolute',
                                  top: -4,
                                  right: -4,
                                  bgcolor: statusColor,
                                  color: 'white',
                                  borderRadius: 1,
                                  px: 0.5,
                                  fontSize: 9,
                                  fontWeight: 700,
                                }}
                              >
                                {exceededLoops}×
                              </Box>
                            )}
                          </Box>
                          
                          {/* Category Name */}
                          <Typography variant="caption" fontWeight={600} noWrap sx={{ maxWidth: '100%', mb: 0.25 }}>
                            {categoryName}
                          </Typography>
                          
                          {/* Amount */}
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6875rem' }}>
                            {formatCurrencyValue(item.actualSpent, { maximumFractionDigits: 0 })} / {formatCurrencyValue(displayAmount, { maximumFractionDigits: 0 })}
                          </Typography>

                          {/* Percentage */}
                          <Typography variant="caption" sx={{ fontWeight: 600, color: statusColor, fontSize: '0.75rem', mt: 0.25 }}>
                            {Math.round(actualPct)}% {isExceeded ? t('budgetForecast.exceeded', { defaultValue: '(Over Budget)' }) : isAtRisk ? t('budgetForecast.atRisk', { defaultValue: '(At Risk)' }) : t('budgetForecast.onTrack', { defaultValue: '(On Track)' })}
                          </Typography>

                          {!hasLimit && (
                            <Typography
                              component="span"
                              sx={{
                                mt: 0.5,
                                color: 'text.secondary',
                                fontSize: '0.6875rem',
                                cursor: 'pointer',
                                '&:hover': { textDecoration: 'underline' },
                              }}
                            >
                              {t('budgetForecast.setLimit')}
                            </Typography>
                          )}
                        </Box>
                      </Grid>
                    );
                  })}
              </Grid>
            )}
          </Paper>
        </Box>
      </TabPanel>

      <TabPanel value={currentTab} index={4}>
        {/* Scoring Tab */}
        <Paper sx={{ p: 3 }}>
          <FinancialHealthScore
            data={intelligence}
            loading={loading && !intelligence}
            error={error}
            onRefresh={fetchIntelligence}
          />
        </Paper>
      </TabPanel>

      {/* Detail Modals */}
      <FinancialRhythmModal open={rhythmModalOpen} onClose={() => setRhythmModalOpen(false)} />
      <MoneyPersonalityModal open={personalityModalOpen} onClose={() => setPersonalityModalOpen(false)} />
      <PersonalizedFutureModal open={futureModalOpen} onClose={() => setFutureModalOpen(false)} />
      <MakeItRealModal open={realityModalOpen} onClose={() => setRealityModalOpen(false)} />
    </Box>
  );
};

export default AnalysisPageNew;
