import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  Button,
  Tooltip,
  LinearProgress,
  Paper,
} from '@mui/material';
import {
  TrendingUp as TrendIcon,
  Savings as SavingsIcon,
  Diversity3 as DiversityIcon,
  ShoppingCart as ImpulseIcon,
  Schedule as RunwayIcon,
  HelpOutline as HelpIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { apiClient } from '@renderer/lib/api-client';
import { useTranslation } from 'react-i18next';

export interface HealthBreakdown {
  savingsScore?: number;
  diversityScore?: number;
  impulseScore?: number;
  runwayScore?: number;
  [key: string]: number | undefined;
}

export interface FinancialHealthSnapshot {
  overallHealthScore: number;
  healthBreakdown: HealthBreakdown;
}

interface FinancialHealthScoreProps {
  data?: FinancialHealthSnapshot | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => Promise<void> | void;
}

const FinancialHealthScore: React.FC<FinancialHealthScoreProps> = ({ data, loading, error, onRefresh }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.health' });
  const hasExternalData = data !== undefined;
  const [intelligence, setIntelligence] = useState<FinancialHealthSnapshot | null>(data ?? null);
  const [internalLoading, setInternalLoading] = useState(!hasExternalData);
  const [internalError, setInternalError] = useState<string | null>(null);

  useEffect(() => {
    if (hasExternalData) {
      setIntelligence(data ?? null);
    }
  }, [data, hasExternalData]);

  const fetchHealthScore = useCallback(async () => {
    setInternalLoading(true);
    setInternalError(null);
    try {
      const response = await apiClient.get<FinancialHealthSnapshot>('/api/analytics/personal-intelligence?months=3');
      if (!response.ok) {
        throw new Error(t('errors.fetchFailed'));
      }
      setIntelligence(response.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.generic');
      setInternalError(message);
      console.error('Error fetching health score:', err);
    } finally {
      setInternalLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!hasExternalData) {
      fetchHealthScore();
    }
  }, [hasExternalData, fetchHealthScore]);

  const handleRefresh = async () => {
    if (onRefresh) {
      try {
        await onRefresh();
      } catch (err) {
        console.error('Error refreshing financial health score:', err);
      }
      return;
    }
    await fetchHealthScore();
  };

  const effectiveLoading = hasExternalData ? (loading ?? false) : internalLoading;
  const effectiveError = hasExternalData ? (error ?? null) : internalError;

  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return '#4caf50';
    if (score >= 60) return '#ff9800';
    return '#f44336';
  };

  const getHealthMetricIcon = (key: string) => {
    switch (key.toLowerCase()) {
      case 'savingsscore':
        return <SavingsIcon />;
      case 'diversityscore':
        return <DiversityIcon />;
      case 'impulsescore':
        return <ImpulseIcon />;
      case 'runwayscore':
        return <RunwayIcon />;
      default:
        return <SavingsIcon />;
    }
  };

  const getHealthMetricName = (key: string) => {
    const normalized = key.toLowerCase().replace('score', '');
    return t(`metrics.${normalized}.label`, {
      defaultValue: key.replace('Score', '').replace(/([A-Z])/g, ' $1').trim(),
    });
  };

  const getHealthMetricTooltip = (key: string) => {
    const normalized = key.toLowerCase().replace('score', '');
    return t(`metrics.${normalized}.tooltip`, {
      defaultValue: t('metrics.fallbackTooltip'),
    });
  };

  const getHealthScoreDescription = (score: number) => {
    if (score >= 80) {
      return {
        status: t('scorecard.status.excellent.title'),
        message: t('scorecard.status.excellent.message'),
        color: '#4caf50',
      };
    }
    if (score >= 60) {
      return {
        status: t('scorecard.status.good.title'),
        message: t('scorecard.status.good.message'),
        color: '#ff9800',
      };
    }
    return {
      status: t('scorecard.status.needsAttention.title'),
      message: t('scorecard.status.needsAttention.message'),
      color: '#f44336',
    };
  };

  if (effectiveLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (effectiveError) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {effectiveError}
        <Button variant="contained" onClick={handleRefresh} sx={{ mt: 2 }}>
          {t('actions.retry')}
        </Button>
      </Alert>
    );
  }

  if (!intelligence) {
    return (
      <Alert severity="info">
        {t('empty')}
      </Alert>
    );
  }

  const { overallHealthScore, healthBreakdown } = intelligence;
  const description = getHealthScoreDescription(overallHealthScore);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight="bold" gutterBottom>
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          disabled={effectiveLoading}
          size="small"
        >
          {t('actions.refresh')}
        </Button>
      </Box>

      {/* Overall Health Score */}
      <Paper
        sx={{
          p: 3,
          mb: 3,
          background: `linear-gradient(135deg, ${getHealthScoreColor(overallHealthScore)}15 0%, ${getHealthScoreColor(overallHealthScore)}05 100%)`,
          borderRadius: 2,
          border: `1px solid ${getHealthScoreColor(overallHealthScore)}30`,
        }}
      >
        <Grid container spacing={3} alignItems="center">
          {/* Overall Score Circle */}
          <Grid item xs={12} md={4}>
            <Box textAlign="center">
              <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                <CircularProgress
                  variant="determinate"
                  value={overallHealthScore}
                  size={140}
                  thickness={6}
                  sx={{
                    color: getHealthScoreColor(overallHealthScore),
                    '& .MuiCircularProgress-circle': {
                      strokeLinecap: 'round',
                    },
                  }}
                />
              <Box
                sx={{
                  top: 0,
                  left: 0,
                  bottom: 0,
                  right: 0,
                  position: 'absolute',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                }}
              >
                <Typography variant="h3" fontWeight="bold" color={getHealthScoreColor(overallHealthScore)}>
                  {overallHealthScore}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6875rem' }}>
                  {t('labels.healthScore')}
                </Typography>
              </Box>
            </Box>

              {/* Status Badge */}
              <Box sx={{ mt: 2 }}>
                <Typography variant="h6" fontWeight="bold" color={description.color} gutterBottom>
                  {description.status}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {description.message}
                </Typography>
              </Box>

              {/* Improve Button */}
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="medium"
                  startIcon={<TrendIcon />}
                  sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    px: 3,
                  }}
                >
                  {t('actions.improve')}
                </Button>
              </Box>
            </Box>
          </Grid>

          {/* Health Breakdown Metrics */}
          <Grid item xs={12} md={8}>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 2 }}>
              {t('scorecard.breakdown')}
            </Typography>
            <Grid container spacing={2}>
              {Object.entries(healthBreakdown).slice(0, 4).map(([key, value]) => {
                const score = value as number;
                const color = getHealthScoreColor(score);

                return (
                  <Grid item xs={6} sm={3} key={key}>
                    <Tooltip title={getHealthMetricTooltip(key)} placement="top" arrow>
                      <Card
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          textAlign: 'center',
                          cursor: 'help',
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            transform: 'translateY(-2px)',
                            boxShadow: 2,
                            borderColor: color + '80',
                          },
                          borderColor: color + '40',
                        }}
                      >
                        <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                          <CircularProgress
                            variant="determinate"
                            value={score}
                            size={70}
                            thickness={5}
                            sx={{
                              color: color,
                              '& .MuiCircularProgress-circle': {
                                strokeLinecap: 'round',
                              },
                            }}
                          />
                          <Box
                            sx={{
                              top: 0,
                              left: 0,
                              bottom: 0,
                              right: 0,
                              position: 'absolute',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Typography variant="h6" fontWeight="bold" color={color}>
                              {score}
                            </Typography>
                          </Box>
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 0.5 }}>
                          <Box sx={{ color: color, display: 'flex', fontSize: '0.9rem' }}>
                            {getHealthMetricIcon(key)}
                          </Box>
                          <HelpIcon sx={{ fontSize: '0.75rem', color: 'text.disabled' }} />
                        </Box>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            lineHeight: 1.2,
                          }}
                        >
                          {getHealthMetricName(key)}
                        </Typography>
                      </Card>
                    </Tooltip>
                  </Grid>
                );
              })}
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* Detailed Breakdown */}
      <Grid container spacing={2}>
        {Object.entries(healthBreakdown).map(([key, value]) => {
          const score = value as number;
          const color = getHealthScoreColor(score);

          return (
            <Grid item xs={12} md={6} key={key}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Box sx={{ color: color, display: 'flex' }}>
                      {getHealthMetricIcon(key)}
                    </Box>
                    <Typography variant="subtitle1" fontWeight="bold">
                      {getHealthMetricName(key)}
                    </Typography>
                    <Tooltip title={getHealthMetricTooltip(key)} placement="top" arrow>
                      <HelpIcon sx={{ fontSize: '1rem', color: 'text.disabled', cursor: 'help' }} />
                    </Tooltip>
                  </Box>

                  <Box sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('labels.score')}
                    </Typography>
                    <Typography variant="h6" fontWeight="bold" color={color}>
                      {score}/100
                    </Typography>
                  </Box>
                    <LinearProgress
                      variant="determinate"
                      value={score}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: color + '20',
                        '& .MuiLinearProgress-bar': {
                          backgroundColor: color,
                        },
                      }}
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem', mt: 1 }}>
                    {getHealthMetricTooltip(key)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};

export default FinancialHealthScore;
