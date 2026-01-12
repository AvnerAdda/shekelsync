import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Line } from 'recharts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';

type TrendDirection = 'up' | 'down' | 'flat';

interface HealthScoreHistoryPoint {
  date: string;
  overallHealthScore: number;
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
    }));
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
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2 }}>
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

            <Box sx={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.4)} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => (typeof value === 'string' ? value.slice(5) : value)}
                    minTickGap={24}
                  />
                  <YAxis domain={[0, 100]} tickCount={6} />
                  <RechartsTooltip
                    formatter={(value: number) => [`${Math.round(value)}`, t('tooltip.score')]}
                    labelFormatter={(label: string) => label}
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
                    strokeWidth={3}
                    dot={false}
                  />
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
