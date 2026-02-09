import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Switch,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import SavingsIcon from '@mui/icons-material/Savings';
import Diversity3Icon from '@mui/icons-material/Diversity3';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Line, Legend } from 'recharts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';

type TrendDirection = 'up' | 'down' | 'flat';

interface HealthBreakdown {
  savingsScore: number;
  diversityScore: number;
  impulseScore: number;
  runwayScore: number;
}

interface HealthScoreHistoryPoint {
  date: string;
  overallHealthScore: number;
  breakdown?: HealthBreakdown;
}

interface HealthScoreHistoryResponse {
  startDate: string;
  endDate: string;
  historyDays: number;
  windowDays: number;
  points: HealthScoreHistoryPoint[];
  trend: {
    direction: TrendDirection;
    delta: number;
    startAverage: number;
    endAverage: number;
  };
}

const BREAKDOWN_COLORS = {
  savingsScore: '#4caf50',
  diversityScore: '#2196f3',
  impulseScore: '#ff9800',
  runwayScore: '#9c27b0',
};

const BREAKDOWN_ICONS: Record<string, React.ReactNode> = {
  savingsScore: <SavingsIcon fontSize="small" />,
  diversityScore: <Diversity3Icon fontSize="small" />,
  impulseScore: <ShoppingCartIcon fontSize="small" />,
  runwayScore: <ScheduleIcon fontSize="small" />,
};

interface HealthScoreTrendModalProps {
  open: boolean;
  onClose: () => void;
  days?: number;
  windowDays?: number;
}

const HealthScoreTrendModal: React.FC<HealthScoreTrendModalProps> = ({ open, onClose, days = 60, windowDays = 60 }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.health.trendModal' });
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HealthScoreHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    if (!open) return;

    if (data && (Date.now() - lastFetch) < CACHE_DURATION && data.historyDays === days && data.windowDays === windowDays) {
      return;
    }

    let isActive = true;
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.get<HealthScoreHistoryResponse>(
          `/api/analytics/health-score-history?days=${days}&windowDays=${windowDays}`,
        );
        if (!response.ok) {
          throw new Error(t('errors.fetchFailed'));
        }
        if (isActive) {
          setData(response.data);
          setLastFetch(Date.now());
        }
      } catch (err) {
        console.error('Failed to fetch health score history:', err);
        if (isActive) {
          setError(err instanceof Error ? err.message : t('errors.generic'));
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    fetchHistory();
    return () => {
      isActive = false;
    };
  }, [open, days, windowDays, t, data, lastFetch]);

  const chartData = useMemo(() => {
    if (!data?.points) return [];
    return data.points.map((point) => ({
      date: point.date,
      score: point.overallHealthScore,
      savingsScore: point.breakdown?.savingsScore,
      diversityScore: point.breakdown?.diversityScore,
      impulseScore: point.breakdown?.impulseScore,
      runwayScore: point.breakdown?.runwayScore,
    }));
  }, [data]);

  const hasBreakdownData = useMemo(() => {
    return data?.points?.some((p) => p.breakdown) ?? false;
  }, [data]);

  const trend = data?.trend;
  const trendDirection: TrendDirection = trend?.direction ?? 'flat';
  const trendDelta = trend?.delta ?? 0;

  const trendMeta = useMemo(() => {
    const isUp = trendDirection === 'up';
    const isDown = trendDirection === 'down';
    const isFlat = trendDirection === 'flat';

    if (isUp) {
      return {
        label: t('trend.up'),
        icon: <TrendingUpIcon />,
        color: theme.palette.success.main,
      };
    }
    if (isDown) {
      return {
        label: t('trend.down'),
        icon: <TrendingDownIcon />,
        color: theme.palette.error.main,
      };
    }
    return {
      label: t('trend.flat'),
      icon: <TrendingFlatIcon />,
      color: theme.palette.warning.main,
    };
  }, [t, theme, trendDirection]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: alpha(theme.palette.background.paper, 0.85),
          backdropFilter: 'blur(20px)',
          backgroundImage: 'none',
          boxShadow: theme.shadows[24],
          borderRadius: 3,
          border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        },
      }}
    >
      <DialogTitle sx={{ pr: 6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight="bold">
              {t('title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('subtitle', { days, windowDays })}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label={t('actions.close')}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && error && (
          <Alert severity="error">{error}</Alert>
        )}

        {!loading && !error && data && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip
                  icon={trendMeta.icon}
                  label={trendMeta.label}
                  sx={{
                    bgcolor: alpha(trendMeta.color, 0.12),
                    color: trendMeta.color,
                    fontWeight: 700,
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  {t('summary', { delta: trendDelta > 0 ? `+${trendDelta}` : `${trendDelta}` })}
                </Typography>
              </Box>
              {hasBreakdownData && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={showBreakdown}
                      onChange={(e) => setShowBreakdown(e.target.checked)}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2" color="text.secondary">
                      {t('showBreakdown', { defaultValue: 'Show breakdown' })}
                    </Typography>
                  }
                />
              )}
            </Box>

            {showBreakdown && hasBreakdownData && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2, justifyContent: 'center' }}>
                {Object.entries(BREAKDOWN_COLORS).map(([key, color]) => (
                  <Box
                    key={key}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1.5,
                      py: 0.5,
                      borderRadius: 2,
                      bgcolor: alpha(color, 0.1),
                      border: `1px solid ${alpha(color, 0.3)}`,
                    }}
                  >
                    <Box sx={{ color, display: 'flex' }}>{BREAKDOWN_ICONS[key]}</Box>
                    <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
                      {t(`breakdown.${key.replace('Score', '')}`, { defaultValue: key.replace('Score', '') })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            <Box sx={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.4)} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => (typeof value === 'string' ? value.slice(5) : value)}
                    minTickGap={24}
                  />
                  <YAxis domain={[0, 100]} tickCount={6} />
                  <RechartsTooltip
                    formatter={(value, name) => {
                      if (value === undefined || value === null) return ['-', name ?? ''];
                      const nameStr = String(name ?? 'score');
                      const labelKey = nameStr === 'score' ? 'tooltip.score' : `breakdown.${nameStr.replace('Score', '')}`;
                      return [`${Math.round(Number(value))}`, t(labelKey, { defaultValue: nameStr })];
                    }}
                    labelFormatter={(label) => String(label ?? '')}
                    contentStyle={{
                      backgroundColor: alpha(theme.palette.background.paper, 0.85),
                      backdropFilter: 'blur(12px)',
                      borderRadius: 10,
                      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                      boxShadow: theme.shadows[8],
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={trendMeta.color}
                    strokeWidth={showBreakdown ? 2 : 3}
                    dot={false}
                    name="score"
                  />
                  {showBreakdown && hasBreakdownData && (
                    <>
                      <Line
                        type="monotone"
                        dataKey="savingsScore"
                        stroke={BREAKDOWN_COLORS.savingsScore}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="savingsScore"
                      />
                      <Line
                        type="monotone"
                        dataKey="diversityScore"
                        stroke={BREAKDOWN_COLORS.diversityScore}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="diversityScore"
                      />
                      <Line
                        type="monotone"
                        dataKey="impulseScore"
                        stroke={BREAKDOWN_COLORS.impulseScore}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="impulseScore"
                      />
                      <Line
                        type="monotone"
                        dataKey="runwayScore"
                        stroke={BREAKDOWN_COLORS.runwayScore}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="runwayScore"
                      />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default HealthScoreTrendModal;
