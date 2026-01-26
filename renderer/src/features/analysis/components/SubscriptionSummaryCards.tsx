import React from 'react';
import {
  Box,
  Typography,
  Stack,
  Skeleton,
  Grid,
  LinearProgress,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Autorenew as SubscriptionIcon,
  CalendarMonth as MonthlyIcon,
  DateRange as YearlyIcon,
  TrendingUp as TrendUpIcon,
  TrendingDown as TrendDownIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import type { SubscriptionSummary } from '@renderer/types/subscriptions';

interface SubscriptionSummaryCardsProps {
  summary: SubscriptionSummary | null;
  loading: boolean;
}

const SubscriptionSummaryCards: React.FC<SubscriptionSummaryCardsProps> = ({
  summary,
  loading,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions' });

  // Calculate active vs total ratio for the progress bar
  const activeCount = summary?.active_count ?? 0;
  const totalCount = summary?.total_count ?? 0;
  const activeRatio = totalCount > 0 ? (activeCount / totalCount) * 100 : 0;

  // Mock trend data (would come from API comparing to previous period)
  const monthlyTrend = 0; // Placeholder - could be calculated from creep data

  if (loading && !summary) {
    return (
      <Box sx={{ mb: 4 }}>
        <Grid container spacing={2}>
          {[1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 4 }}>
              <Box
                sx={{
                  p: 3,
                  borderRadius: 4,
                  bgcolor: alpha(theme.palette.background.paper, 0.4),
                  backdropFilter: 'blur(20px)',
                }}
              >
                <Skeleton variant="circular" width={48} height={48} sx={{ mb: 2 }} />
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="80%" height={40} />
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Grid container spacing={2}>
        {/* Total Subscriptions Card */}
        <Grid size={{ xs: 12, sm: 4 }}>
          <Box
            sx={{
              p: 3,
              borderRadius: 4,
              background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.dark, 0.05)} 100%)`,
              backdropFilter: 'blur(20px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.2),
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: `0 12px 40px -12px ${alpha(theme.palette.primary.main, 0.35)}`,
              },
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 3,
                  background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 14px 0 ${alpha(theme.palette.primary.main, 0.4)}`,
                }}
              >
                <SubscriptionIcon sx={{ color: '#fff', fontSize: 24 }} />
              </Box>
              <Typography
                variant="caption"
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.success.main, 0.1),
                  color: theme.palette.success.main,
                  fontWeight: 600,
                }}
              >
                {activeCount} {t('summary.active')}
              </Typography>
            </Stack>

            <Box sx={{ mt: 2.5 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                {t('summary.totalSubscriptions')}
              </Typography>
              <Typography variant="h3" fontWeight={700} sx={{ mt: 0.5 }}>
                {totalCount}
              </Typography>
            </Box>

            {/* Active ratio progress bar */}
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" justifyContent="space-between" mb={0.5}>
                <Typography variant="caption" color="text.secondary">
                  {t('summary.activeRatio')}
                </Typography>
                <Typography variant="caption" fontWeight={600}>
                  {activeRatio.toFixed(0)}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={activeRatio}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 3,
                    background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.primary.light})`,
                  },
                }}
              />
            </Box>
          </Box>
        </Grid>

        {/* Monthly Total Card */}
        <Grid size={{ xs: 12, sm: 4 }}>
          <Box
            sx={{
              p: 3,
              borderRadius: 4,
              background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.warning.dark, 0.05)} 100%)`,
              backdropFilter: 'blur(20px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.warning.main, 0.2),
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: `0 12px 40px -12px ${alpha(theme.palette.warning.main, 0.35)}`,
              },
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 3,
                  background: `linear-gradient(135deg, ${theme.palette.warning.main} 0%, ${theme.palette.warning.dark} 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 14px 0 ${alpha(theme.palette.warning.main, 0.4)}`,
                }}
              >
                <MonthlyIcon sx={{ color: '#fff', fontSize: 24 }} />
              </Box>
              {monthlyTrend !== 0 && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {monthlyTrend > 0 ? (
                    <TrendUpIcon sx={{ fontSize: 16, color: theme.palette.error.main }} />
                  ) : (
                    <TrendDownIcon sx={{ fontSize: 16, color: theme.palette.success.main }} />
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: monthlyTrend > 0 ? theme.palette.error.main : theme.palette.success.main,
                      fontWeight: 600,
                    }}
                  >
                    {Math.abs(monthlyTrend)}%
                  </Typography>
                </Stack>
              )}
            </Stack>

            <Box sx={{ mt: 2.5 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                {t('summary.monthlyTotal')}
              </Typography>
              <Typography variant="h3" fontWeight={700} sx={{ mt: 0.5 }}>
                {formatCurrency(summary?.monthly_total ?? 0, { maximumFractionDigits: 0 })}
              </Typography>
            </Box>

            {/* Category breakdown mini indicator */}
            <Stack direction="row" spacing={1} mt={2} flexWrap="wrap">
              {summary?.category_breakdown?.slice(0, 3).map((cat, idx) => (
                <Typography
                  key={idx}
                  variant="caption"
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.warning.main, 0.1),
                    color: 'text.secondary',
                  }}
                >
                  {cat.name}
                </Typography>
              ))}
              {(summary?.category_breakdown?.length ?? 0) > 3 && (
                <Typography
                  variant="caption"
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.warning.main, 0.1),
                    color: 'text.secondary',
                  }}
                >
                  +{(summary?.category_breakdown?.length ?? 0) - 3}
                </Typography>
              )}
            </Stack>
          </Box>
        </Grid>

        {/* Yearly Total Card */}
        <Grid size={{ xs: 12, sm: 4 }}>
          <Box
            sx={{
              p: 3,
              borderRadius: 4,
              background: `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.1)} 0%, ${alpha(theme.palette.error.dark, 0.05)} 100%)`,
              backdropFilter: 'blur(20px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.error.main, 0.2),
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: `0 12px 40px -12px ${alpha(theme.palette.error.main, 0.35)}`,
              },
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 3,
                  background: `linear-gradient(135deg, ${theme.palette.error.main} 0%, ${theme.palette.error.dark} 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 14px 0 ${alpha(theme.palette.error.main, 0.4)}`,
                }}
              >
                <YearlyIcon sx={{ color: '#fff', fontSize: 24 }} />
              </Box>
            </Stack>

            <Box sx={{ mt: 2.5 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                {t('summary.yearlyTotal')}
              </Typography>
              <Typography variant="h3" fontWeight={700} sx={{ mt: 0.5 }}>
                {formatCurrency(summary?.yearly_total ?? 0, { maximumFractionDigits: 0 })}
              </Typography>
            </Box>

            {/* Per day breakdown */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {t('summary.perDay')}
              </Typography>
              <Typography variant="body1" fontWeight={600} sx={{ color: theme.palette.error.main }}>
                {formatCurrency((summary?.yearly_total ?? 0) / 365, { maximumFractionDigits: 0 })}
              </Typography>
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SubscriptionSummaryCards;
