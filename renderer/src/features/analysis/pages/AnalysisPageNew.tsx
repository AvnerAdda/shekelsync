import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  CircularProgress,
  Alert,
  Button,
  Skeleton,
  alpha,
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
import QuestsPanel from '../components/QuestsPanel';
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
  scenarios?: { p10: number; p50: number; p90: number } | null;
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
  const [temporalData, setTemporalData] = useState<any | null>(null);
  const [behavioralData, setBehavioralData] = useState<any | null>(null);
  const [futureData, setFutureData] = useState<any | null>(null);
  const [timeValueData, setTimeValueData] = useState<any | null>(null);
  const [temporalLoading, setTemporalLoading] = useState(false);
  const [behavioralLoading, setBehavioralLoading] = useState(false);
  const [futureLoading, setFutureLoading] = useState(false);
  const [timeValueLoading, setTimeValueLoading] = useState(false);
  const [temporalError, setTemporalError] = useState<string | null>(null);
  const [behavioralError, setBehavioralError] = useState<string | null>(null);
  const [futureError, setFutureError] = useState<string | null>(null);
  const [timeValueError, setTimeValueError] = useState<string | null>(null);
  
  // Modal states
  const [rhythmModalOpen, setRhythmModalOpen] = useState(false);
  const [personalityModalOpen, setPersonalityModalOpen] = useState(false);
  const [futureModalOpen, setFutureModalOpen] = useState(false);
  const [realityModalOpen, setRealityModalOpen] = useState(false);
  
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const { formatCurrency } = useFinancePrivacy();
  const accessStatus = getPageAccessStatus('analysis');
  const isLocked = accessStatus.isLocked;
  const fetchOnceRef = useRef({
    intelligence: false,
    temporal: false,
    behavioral: false,
    future: false,
    timeValue: false,
    budget: false,
  });

  // Helper function to format hour based on locale
  const formatHour = (hour: number): string => {
    const date = new Date(2000, 0, 1, hour);
    return date.toLocaleTimeString(i18n.language, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: i18n.language !== 'he'
    });
  };

  const fetchTemporalData = useCallback(async () => {
    if (isLocked) return;
    setTemporalLoading(true);
    setTemporalError(null);
    try {
      const response = await apiClient.get('/api/analytics/temporal?timeRange=6months');
      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }
      setTemporalData(response.data);
    } catch (err) {
      setTemporalError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Error fetching temporal analytics:', err);
    } finally {
      setTemporalLoading(false);
    }
  }, [isLocked, t]);

  const fetchBehavioralData = useCallback(async () => {
    if (isLocked) return;
    setBehavioralLoading(true);
    setBehavioralError(null);
    try {
      const response = await apiClient.get('/api/analytics/behavioral-patterns');
      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }
      setBehavioralData(response.data);
    } catch (err) {
      setBehavioralError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Error fetching behavioral analytics:', err);
    } finally {
      setBehavioralLoading(false);
    }
  }, [isLocked, t]);

  const fetchFutureData = useCallback(async () => {
    if (isLocked) return;
    setFutureLoading(true);
    setFutureError(null);
    try {
      const response = await apiClient.get('/api/analytics/forecast-extended');
      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }
      setFutureData(response.data);
    } catch (err) {
      setFutureError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Error fetching extended forecast analytics:', err);
    } finally {
      setFutureLoading(false);
    }
  }, [isLocked, t]);

  const fetchTimeValueData = useCallback(async () => {
    if (isLocked) return;
    setTimeValueLoading(true);
    setTimeValueError(null);
    try {
      const response = await apiClient.get('/api/analytics/time-value');
      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }
      setTimeValueData(response.data);
    } catch (err) {
      setTimeValueError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Error fetching time value analytics:', err);
    } finally {
      setTimeValueLoading(false);
    }
  }, [isLocked, t]);

  const fetchIntelligence = useCallback(async () => {
    if (isLocked) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<PersonalIntelligence>('/api/analytics/personal-intelligence?days=60');

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
    fetchTemporalData();
    fetchBehavioralData();
    fetchFutureData();
    fetchTimeValueData();
  }, [fetchBehavioralData, fetchBudgetForecast, fetchFutureData, fetchIntelligence, fetchTemporalData, fetchTimeValueData]);

  useEffect(() => {
    if (isLocked) {
      return;
    }
    if (fetchOnceRef.current.intelligence) {
      return;
    }
    fetchOnceRef.current.intelligence = true;
    fetchIntelligence();
  }, [fetchIntelligence, isLocked]);

  useEffect(() => {
    if (isLocked) {
      return;
    }

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    if (currentTab === 0) {
      if (!fetchOnceRef.current.temporal) {
        fetchOnceRef.current.temporal = true;
        fetchTemporalData();
      }

      if (!fetchOnceRef.current.behavioral) {
        fetchOnceRef.current.behavioral = true;
        fetchBehavioralData();
      }

      // Defer the heavier endpoints slightly so the tab becomes interactive faster.
      if (!fetchOnceRef.current.future) {
        fetchOnceRef.current.future = true;
        timers.push(setTimeout(() => fetchFutureData(), 250));
      }

      if (!fetchOnceRef.current.timeValue) {
        fetchOnceRef.current.timeValue = true;
        timers.push(setTimeout(() => fetchTimeValueData(), 250));
      }
    }

    if (currentTab === 3 && !fetchOnceRef.current.budget) {
      fetchOnceRef.current.budget = true;
      fetchBudgetForecast();
    }

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [
    currentTab,
    fetchBehavioralData,
    fetchBudgetForecast,
    fetchFutureData,
    fetchTemporalData,
    fetchTimeValueData,
    isLocked,
  ]);

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

  const isRefreshing = loading || budgetForecastLoading || temporalLoading || behavioralLoading || futureLoading || timeValueLoading;

  const hourlySeries = useMemo(() => {
    const series = temporalData?.hourlySpending ?? intelligence?.temporalIntelligence?.hourlyHeatmap;
    if (!Array.isArray(series)) return [];
    return series.map((value) => (typeof value === 'number' ? value : Number(value) || 0));
  }, [intelligence?.temporalIntelligence?.hourlyHeatmap, temporalData?.hourlySpending]);

  const rhythmBuckets = useMemo(() => {
    if (hourlySeries.length === 0) return [];
    return Array.from({ length: 8 }, (_, idx) => {
      const startHour = idx * 3;
      const amount = hourlySeries.slice(startHour, startHour + 3).reduce((sum, val) => sum + val, 0);
      return {
        time: formatHour(startHour),
        amount,
      };
    });
  }, [hourlySeries, i18n.language]);

  const rhythmStats = useMemo(() => {
    if (hourlySeries.length === 0 && !temporalData && !intelligence?.temporalIntelligence) {
      return null;
    }

    const peakHour = hourlySeries.reduce(
      (best, value, idx) => (value > best.value ? { value, idx } : best),
      { value: -Infinity, idx: 0 }
    ).idx;

    const dailyEvolution = temporalData?.dailyEvolution;
    const avgDailySpend = dailyEvolution?.length
      ? dailyEvolution.reduce((sum: number, day: any) => sum + (day.amount || 0), 0) / dailyEvolution.length
      : intelligence?.temporalIntelligence?.dailyBurnRate ?? null;

    return {
      peakHour,
      avgDailySpend,
      weekendPercentage: temporalData?.weekendPercentage ?? intelligence?.temporalIntelligence?.weekendVsWeekday?.weekendPercentage ?? null,
      preciseTimePercentage: temporalData?.preciseTimePercentage ?? intelligence?.temporalIntelligence?.preciseTimePercentage ?? null,
    };
  }, [hourlySeries, intelligence?.temporalIntelligence, temporalData]);

  const personalityMetrics = useMemo(() => {
    const impulsePercentage = behavioralData?.impulsePercentage ?? intelligence?.behavioralIntelligence?.impulseSpendingScore ?? 0;
    const programmedPercentage = behavioralData?.programmedPercentage ?? (100 - impulsePercentage);

    return {
      impulsePercentage,
      programmedPercentage,
      programmedAmount: behavioralData?.programmedAmount ?? null,
      impulseAmount: behavioralData?.impulseAmount ?? null,
      recurringCount: behavioralData?.recurringPatterns?.length ?? null,
      topCategoryWeekly: behavioralData?.categoryAverages?.[0]?.avgPerWeek ?? null,
      topCategoryName: behavioralData?.categoryAverages?.[0]?.category ?? null,
    };
  }, [behavioralData, intelligence?.behavioralIntelligence?.impulseSpendingScore]);

  const scenarioEndBalances = useMemo(() => {
    const combined = futureData?.combinedData;
    if (!combined) {
      return { p10: null, p50: null, p90: null };
    }
    const reversed = [...combined].reverse();
    const findEnd = (key: 'p10Cumulative' | 'p50Cumulative' | 'p90Cumulative') => {
      const entry = reversed.find((item) => item[key] !== null && item[key] !== undefined);
      return entry ? entry[key] : null;
    };

    return {
      p10: findEnd('p10Cumulative'),
      p50: findEnd('p50Cumulative'),
      p90: findEnd('p90Cumulative'),
    };
  }, [futureData]);

  const scenarioNetCash = useMemo(() => ({
    base: futureData?.summaries?.base?.netCashFlow ?? intelligence?.predictiveAnalytics?.savingsTrajectory6m ?? 0,
    optimistic: futureData?.summaries?.optimistic?.netCashFlow ?? intelligence?.predictiveAnalytics?.savingsTrajectory6m ?? 0,
    pessimistic: futureData?.summaries?.pessimistic?.netCashFlow ?? intelligence?.predictiveAnalytics?.savingsTrajectory6m ?? 0,
  }), [futureData?.summaries, intelligence?.predictiveAnalytics?.savingsTrajectory6m]);

  const futureSparklineData = useMemo(() => {
    if (!futureData?.combinedData) return [];
    return futureData.combinedData
      .filter((item: any) => item.p50Cumulative !== null && item.p50Cumulative !== undefined)
      .map((item: any, idx: number) => ({
        month: idx + 1,
        value: item.p50Cumulative,
      }));
  }, [futureData]);

  const primaryHourlyWage = timeValueData?.hourlyWage ?? intelligence?.psychologicalInsights?.hourlyWage ?? 0;
  const expenseRatio = useMemo(() => {
    if (timeValueData?.totalIncome) {
      return (timeValueData.totalExpenses / Math.max(timeValueData.totalIncome, 1)) * 100;
    }
    return null;
  }, [timeValueData]);
  const biggestPurchaseHoursValue = timeValueData?.biggestPurchase?.hours ?? intelligence?.psychologicalInsights?.biggestPurchaseHours ?? null;
  const topCategoryHours = timeValueData?.topCategories?.[0]?.hours ?? null;

  const formatAveragePurchaseHours = () => {
    const value = topCategoryHours ?? intelligence?.psychologicalInsights?.avgTransactionInHours;
    if (value === undefined || value === null) return t('dashboard.reality.na');
    if (typeof value === 'number') return value.toFixed(1);
    return value;
  };

  const formatBiggestPurchaseHours = () => {
    const value = biggestPurchaseHoursValue;
    if (value === undefined || value === null) return t('dashboard.reality.na');
    if (typeof value === 'number') return Math.round(value).toString();
    return value;
  };

  if (isLocked) {
    return (
      <LockedPagePlaceholder page="analysis" onboardingStatus={onboardingStatus} />
    );
  }

  return (
    <Box sx={{ width: '100%', p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom sx={{ 
            background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            mb: 1
          }}>
            {t('header.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('header.subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={isRefreshing ? <CircularProgress size={16} aria-label={t('states.loading')} /> : <RefreshIcon />}
          onClick={handleRefreshAll}
          disabled={isRefreshing}
          size="small"
          sx={{
            borderRadius: 2,
            borderColor: (theme) => alpha(theme.palette.divider, 0.2),
            backdropFilter: 'blur(10px)',
            '&:hover': {
              borderColor: 'primary.main',
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05)
            }
          }}
        >
          {isRefreshing ? t('actions.refreshing') : t('actions.refresh')}
        </Button>
      </Box>

      {/* Tabs */}
      <Paper sx={{ 
        mb: 3,
        borderRadius: 3,
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
        backdropFilter: 'blur(20px)',
        border: '1px solid',
        borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
        boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
        overflow: 'hidden'
      }}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          aria-label={t('tabs.ariaLabel')}
          sx={{
            '& .MuiTabs-indicator': {
              height: 3,
              borderRadius: '3px 3px 0 0',
              background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            },
            '& .MuiTab-root': {
              minHeight: 64,
              textTransform: 'none',
              fontSize: '1rem',
              fontWeight: 600,
              transition: 'all 0.2s',
              '&.Mui-selected': {
                color: theme.palette.primary.main,
              },
              '&:hover': {
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05),
              }
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
        {isRefreshing && !intelligence && !temporalData && !behavioralData && !futureData && !timeValueData ? (
          <Grid container spacing={2}>
            {[1, 2, 3, 4].map((i) => (
              <Grid item xs={12} md={6} key={i}>
                <Card elevation={0} sx={{
                  height: '100%',
                  borderRadius: 4,
                  bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
                  backdropFilter: 'blur(20px)',
                  border: '1px solid',
                  borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
                }}>
                  <CardContent>
                    <Skeleton variant="text" width={200} height={32} />
                    <Skeleton variant="rectangular" width="100%" height={100} sx={{ mt: 2 }} />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (error && !temporalData && !behavioralData && !futureData && !timeValueData) ? (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
            <Button variant="contained" onClick={fetchIntelligence} sx={{ mt: 2 }}>
              {t('actions.retry')}
            </Button>
          </Alert>
        ) : (!intelligence && !temporalData && !behavioralData && !futureData && !timeValueData) ? (
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
              <Card elevation={0} sx={{
                height: '100%',
                borderRadius: 4,
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
                backdropFilter: 'blur(20px)',
                border: '1px solid',
                borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
                boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: (theme) => `0 12px 40px 0 ${alpha(theme.palette.primary.main, 0.1)}`,
                  borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
                }
              }}>
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
                  {(temporalLoading && rhythmBuckets.length === 0) ? (
                    <Box sx={{ mb: 2 }}>
                      <Skeleton variant="text" width="60%" height={20} sx={{ mb: 1 }} />
                      <Skeleton variant="rectangular" width="100%" height={100} sx={{ borderRadius: 2 }} />
                    </Box>
                  ) : rhythmBuckets.length > 0 ? (
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          {t('dashboard.rhythm.spendingByHour')}
                        </Typography>
                        {rhythmStats?.preciseTimePercentage !== undefined && rhythmStats.preciseTimePercentage < 50 && (
                          <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.75rem' }}>
                            {t('dashboard.rhythm.lowPrecision', { percentage: Math.round(rhythmStats.preciseTimePercentage) })}
                          </Typography>
                        )}
                      </Box>
                      <ResponsiveContainer width="100%" height={100}>
                        <RechartsBarChart
                          data={rhythmBuckets}
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
                  ) : temporalError ? (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {temporalError}
                    </Alert>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('states.noData')}
                    </Typography>
                  )}

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.avgDaily')}</Typography>
                      <Typography variant="h6">
                        {rhythmStats?.avgDailySpend !== null && rhythmStats?.avgDailySpend !== undefined
                          ? formatCurrencyValue(rhythmStats.avgDailySpend || 0)
                          : t('dashboard.rhythm.na')}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.weekendShare')}</Typography>
                      <Typography variant="h6">
                        {rhythmStats?.weekendPercentage !== null && rhythmStats?.weekendPercentage !== undefined
                          ? `${Math.round(rhythmStats.weekendPercentage)}%`
                          : t('dashboard.rhythm.na')}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.peakHour')}</Typography>
                      <Typography variant="body2">
                        {rhythmStats?.peakHour !== undefined && rhythmStats?.peakHour !== null
                          ? formatHour(rhythmStats.peakHour)
                          : t('dashboard.rhythm.na')}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">{t('dashboard.rhythm.preciseTime')}</Typography>
                      <Typography variant="body2">
                        {rhythmStats?.preciseTimePercentage !== null && rhythmStats?.preciseTimePercentage !== undefined
                          ? `${Math.round(rhythmStats.preciseTimePercentage)}%`
                          : t('dashboard.rhythm.na')}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Your Money Personality */}
            <Grid item xs={12} md={6}>
              <Card elevation={0} sx={{
                height: '100%',
                borderRadius: 4,
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
                backdropFilter: 'blur(20px)',
                border: '1px solid',
                borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
                boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: (theme) => `0 12px 40px 0 ${alpha(theme.palette.primary.main, 0.1)}`,
                  borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
                }
              }}>
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

                  {behavioralLoading && !behavioralData ? (
                    <Box>
                      <Skeleton variant="text" width="50%" height={20} sx={{ mb: 1 }} />
                      <Skeleton variant="rectangular" width="100%" height={80} sx={{ borderRadius: 2 }} />
                    </Box>
                  ) : behavioralError ? (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {behavioralError}
                    </Alert>
                  ) : (
                    <>
                      {/* Impulse vs Planned Visual */}
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary">{t('dashboard.personality.spendingStyle')}</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, mb: 1 }}>
                          <Box
                            sx={{
                              flex: personalityMetrics.impulsePercentage,
                              height: 8,
                              bgcolor: 'warning.main',
                              borderRadius: 1,
                              transition: 'all 0.3s'
                            }}
                          />
                          <Box
                            sx={{
                              flex: Math.max(0, 100 - personalityMetrics.impulsePercentage),
                              height: 8,
                              bgcolor: 'success.main',
                              borderRadius: 1,
                              transition: 'all 0.3s'
                            }}
                          />
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="warning.main">
                            {t('dashboard.personality.impulse', { value: Math.round(personalityMetrics.impulsePercentage) })}
                          </Typography>
                          <Typography variant="caption" color="success.main">
                            {t('dashboard.personality.planned', { value: Math.round(Math.max(0, 100 - personalityMetrics.impulsePercentage)) })}
                          </Typography>
                        </Box>
                      </Box>

                      <Grid container spacing={1}>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">{t('dashboard.personality.programmedSpend')}</Typography>
                          <Typography variant="h6" color="success.main">
                            {personalityMetrics.programmedAmount !== null
                              ? `+${formatCurrencyValue(personalityMetrics.programmedAmount || 0)}`
                              : t('dashboard.personality.na')}
                          </Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">{t('dashboard.personality.impulseSpend')}</Typography>
                          <Typography variant="h6" color="warning.main">
                            {personalityMetrics.impulseAmount !== null
                              ? `+${formatCurrencyValue(personalityMetrics.impulseAmount || 0)}`
                              : t('dashboard.personality.na')}
                          </Typography>
                        </Grid>
                        <Grid item xs={12}>
                          <Typography variant="caption" color="text.secondary">{t('dashboard.personality.recurringPatterns')}</Typography>
                          <Typography variant="h6">
                            {personalityMetrics.recurringCount ?? 0}
                          </Typography>
                        </Grid>
                        <Grid item xs={12}>
                          <Typography variant="caption" color="text.secondary">
                            {t('dashboard.personality.topCategoryWeekly', { category: personalityMetrics.topCategoryName || t('dashboard.personality.na') })}
                          </Typography>
                          <Typography variant="body2" fontWeight="bold" color="text.primary">
                            {personalityMetrics.topCategoryWeekly !== null
                              ? formatCurrencyValue(personalityMetrics.topCategoryWeekly || 0)
                              : t('dashboard.personality.na')}
                          </Typography>
                        </Grid>
                      </Grid>
                    </>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Your Financial Future */}
            <Grid item xs={12} md={6}>
              <Card elevation={0} sx={{
                height: '100%',
                borderRadius: 4,
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
                backdropFilter: 'blur(20px)',
                border: '1px solid',
                borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
                boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: (theme) => `0 12px 40px 0 ${alpha(theme.palette.primary.main, 0.1)}`,
                  borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
                }
              }}>
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

                  {futureLoading && !futureData ? (
                    <Box>
                      <Skeleton variant="text" width="50%" height={20} sx={{ mb: 1 }} />
                      <Skeleton variant="rectangular" width="100%" height={90} sx={{ borderRadius: 2 }} />
                    </Box>
                  ) : futureError ? (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {futureError}
                    </Alert>
                  ) : (
                    <>
                      {/* 6-Month Trajectory Sparkline */}
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary">{t('dashboard.future.trajectory')}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography
                            variant="h6"
                            color={scenarioNetCash.base >= 0 ? 'success.main' : 'error.main'}
                          >
                            {formatCurrencyValue(scenarioNetCash.base, { showSign: true })}
                          </Typography>
                          <Box sx={{ flex: 1, height: 30 }}>
                            <ResponsiveContainer width="100%" height={30}>
                              <LineChart data={futureSparklineData.length > 0 ? futureSparklineData : [{ month: 0, value: 0 }]} margin={{ top: 2, bottom: 2, left: 2, right: 2 }}>
                                <Line
                                  type="monotone"
                                  dataKey="value"
                                  stroke={scenarioNetCash.base >= 0 ? '#4caf50' : '#f44336'}
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
                          <Typography variant="caption" color="text.secondary">{t('dashboard.future.baseCase')}</Typography>
                          <Typography variant="h6" color="primary.main">
                            {scenarioEndBalances.p50 !== null && scenarioEndBalances.p50 !== undefined
                              ? formatCurrencyValue(scenarioEndBalances.p50 || 0)
                              : t('dashboard.future.na')}
                          </Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">{t('dashboard.future.bestCase')}</Typography>
                          <Typography
                            variant="h6"
                            color="success.main"
                          >
                            {scenarioEndBalances.p90 !== null && scenarioEndBalances.p90 !== undefined
                              ? formatCurrencyValue(scenarioEndBalances.p90 || 0)
                              : t('dashboard.future.na')}
                          </Typography>
                        </Grid>
                        <Grid item xs={12}>
                          <Typography variant="caption" color="text.secondary">{t('dashboard.future.worstCase')}</Typography>
                          <Typography variant="body2" color="error.main" fontWeight="bold">
                            {scenarioEndBalances.p10 !== null && scenarioEndBalances.p10 !== undefined
                              ? formatCurrencyValue(scenarioEndBalances.p10 || 0)
                              : t('dashboard.future.na')}
                          </Typography>
                        </Grid>
                      </Grid>
                    </>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Make It Real */}
            <Grid item xs={12} md={6}>
              <Card elevation={0} sx={{
                height: '100%',
                borderRadius: 4,
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
                backdropFilter: 'blur(20px)',
                border: '1px solid',
                borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
                boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: (theme) => `0 12px 40px 0 ${alpha(theme.palette.primary.main, 0.1)}`,
                  borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
                }
              }}>
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

                  {timeValueLoading && !timeValueData ? (
                    <Box>
                      <Skeleton variant="text" width="60%" height={20} sx={{ mb: 1 }} />
                      <Skeleton variant="rectangular" width="100%" height={60} sx={{ borderRadius: 2 }} />
                    </Box>
                  ) : timeValueError ? (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {timeValueError}
                    </Alert>
                  ) : (
                    <>
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary">{t('dashboard.reality.timeValue')}</Typography>
                        <Typography variant="h6">
                          {t('dashboard.reality.hourlyRate', { value: formatCurrencyValue(primaryHourlyWage) })}
                        </Typography>
                        <Typography variant="caption">
                          {expenseRatio !== null
                            ? t('dashboard.reality.expenseRatio', { ratio: expenseRatio.toFixed(1) })
                            : t('dashboard.reality.na')}
                        </Typography>
                      </Box>

                      <Box>
                        <Typography variant="caption" color="text.secondary">{t('dashboard.reality.biggestPurchase')}</Typography>
                        <Typography variant="body2">
                          {t('dashboard.reality.hoursOfWork', { hours: formatBiggestPurchaseHours() })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {t('dashboard.reality.topCategoryHours', { hours: formatAveragePurchaseHours() })}
                        </Typography>
                      </Box>
                    </>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </TabPanel>

      <TabPanel value={currentTab} index={1}>
        {/* Quests Tab */}
        <Paper sx={{ 
          p: 3,
          borderRadius: 4,
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
          backdropFilter: 'blur(20px)',
          border: '1px solid',
          borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
          boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
        }}>
          <QuestsPanel />
        </Paper>
      </TabPanel>

      <TabPanel value={currentTab} index={2}>
        {/* Spending Tab */}
        <Paper sx={{ 
          p: 3,
          borderRadius: 4,
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
          backdropFilter: 'blur(20px)',
          border: '1px solid',
          borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
          boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
        }}>
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
          <Paper sx={{ 
            p: 3,
            borderRadius: 4,
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
            backdropFilter: 'blur(20px)',
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
            boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
          }}>
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
                    
                    const tooltipContent = item.scenarios ? (
                      <Box sx={{ fontSize: '0.75rem', p: 1 }}>
                        <Box sx={{ mb: 0.5 }}>
                          <strong>Current:</strong> {formatCurrencyValue(item.actualSpent)}
                        </Box>
                        <Box sx={{ mb: 0.5, color: '#22c55e' }}>
                          <strong>Best (P10):</strong> {formatCurrencyValue(item.scenarios.p10)}
                        </Box>
                        <Box sx={{ mb: 0.5, color: '#f59e0b' }}>
                          <strong>Medium (P50):</strong> {formatCurrencyValue(item.scenarios.p50)}
                        </Box>
                        <Box sx={{ color: '#ef4444' }}>
                          <strong>Bad (P90):</strong> {formatCurrencyValue(item.scenarios.p90)}
                        </Box>
                      </Box>
                    ) : null;

                    return (
                      <Grid item xs={12} sm={6} md={4} lg={3} key={`${item.categoryDefinitionId ?? 'cat'}-${idx}`}>
                        <Tooltip title={tooltipContent} enterDelay={200}>
                          <Box
                            sx={{
                              position: 'relative',
                              p: 2,
                              height: '100%',
                              minHeight: 110,
                              borderRadius: 4,
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              overflow: 'hidden',
                              bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
                              backdropFilter: 'blur(12px)',
                              background: (theme) => `linear-gradient(90deg, 
                                ${alpha(statusColor, 0.15)} ${Math.min(actualPct, 100)}%, 
                                ${alpha(theme.palette.background.paper, 0.4)} ${Math.min(actualPct, 100)}%)`,
                              border: '1px solid',
                              borderColor: alpha(statusColor, 0.3),
                              transition: 'all 0.3s ease-in-out',
                              '&:hover': { 
                                transform: 'translateY(-4px)',
                                boxShadow: (theme) => `0 8px 24px 0 ${alpha(statusColor, 0.2)}`,
                                borderColor: statusColor,
                              },
                              cursor: 'help'
                            }}
                          >
                            {/* Background Icon (Watermark) */}
                            <Box
                              sx={{
                                position: 'absolute',
                                right: -10,
                                bottom: -15,
                                opacity: 0.1,
                                transform: 'rotate(-15deg)',
                                pointerEvents: 'none',
                                zIndex: 0
                              }}
                            >
                              {item.categoryIcon ? (
                                <CategoryIcon iconName={item.categoryIcon} color={statusColor} size={100} />
                              ) : (
                                <Typography sx={{ fontSize: 80, fontWeight: 900, color: statusColor, opacity: 0.5 }}>
                                  {categoryName?.slice(0, 1)}
                                </Typography>
                              )}
                            </Box>

                            {/* Content - Top Row */}
                            <Box sx={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ maxWidth: '70%' }}>
                                {categoryName}
                              </Typography>
                              <Typography variant="h6" fontWeight={800} sx={{ color: statusColor }}>
                                {Math.round(actualPct)}%
                              </Typography>
                            </Box>

                            {/* Content - Bottom Row */}
                            <Box sx={{ position: 'relative', zIndex: 1, width: '100%' }}>
                              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                                {formatCurrencyValue(item.actualSpent, { maximumFractionDigits: 0 })} / {formatCurrencyValue(displayAmount, { maximumFractionDigits: 0 })}
                              </Typography>
                              
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: statusColor }} />
                                <Typography variant="caption" sx={{ fontWeight: 600, color: statusColor }}>
                                  {isExceeded ? t('budgetForecast.exceeded', { defaultValue: 'Over Budget' }) : isAtRisk ? t('budgetForecast.atRisk', { defaultValue: 'At Risk' }) : t('budgetForecast.onTrack', { defaultValue: 'On Track' })}
                                </Typography>
                              </Box>

                              {!hasLimit && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                                  {t('budgetForecast.setLimit')}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        </Tooltip>
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
        <Paper sx={{ 
          p: 3,
          borderRadius: 4,
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
          backdropFilter: 'blur(20px)',
          border: '1px solid',
          borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
          boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
        }}>
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
