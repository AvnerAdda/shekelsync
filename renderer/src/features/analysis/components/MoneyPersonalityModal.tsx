import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  CircularProgress,
  Grid,
  Paper,
  Chip,
  useTheme,
  Avatar,
  Alert,
  Button,
  alpha,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import TodayIcon from '@mui/icons-material/Today';
import DateRangeIcon from '@mui/icons-material/DateRange';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import CategoryIcon from '@renderer/features/breakdown/components/CategoryIcon';

interface MoneyPersonalityModalProps {
  open: boolean;
  onClose: () => void;
}

interface FrequencyConfig {
  name: string;
  icon: React.ReactNode;
  label: string;
  color: string;
  description: string;
}

const MoneyPersonalityModal: React.FC<MoneyPersonalityModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.personality' });
  const { formatCurrency } = useFinancePrivacy();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  const FREQUENCY_MULTIPLIERS: Record<string, number> = {
    daily: 30,
    weekly: 4,
    biweekly: 2,
    monthly: 1,
    bimonthly: 0.5,
  };

  const frequencyConfigs: FrequencyConfig[] = [
    { name: 'daily', icon: <TodayIcon sx={{ fontSize: 16 }} />, label: t('frequencies.daily'), color: '#e91e63', description: t('frequencies.dailyDesc') },
    { name: 'weekly', icon: <DateRangeIcon sx={{ fontSize: 16 }} />, label: t('frequencies.weekly'), color: '#9c27b0', description: t('frequencies.weeklyDesc') },
    { name: 'biweekly', icon: <EventRepeatIcon sx={{ fontSize: 16 }} />, label: t('frequencies.biweekly'), color: '#3f51b5', description: t('frequencies.biweeklyDesc') },
    { name: 'monthly', icon: <CalendarMonthIcon sx={{ fontSize: 16 }} />, label: t('frequencies.monthly'), color: '#2196f3', description: t('frequencies.monthlyDesc') },
    { name: 'bimonthly', icon: <ScheduleIcon sx={{ fontSize: 16 }} />, label: t('frequencies.bimonthly'), color: '#00bcd4', description: t('frequencies.bimonthlyDesc') },
  ];

  useEffect(() => {
    if (open && (!data || (Date.now() - lastFetch) > CACHE_DURATION)) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/api/analytics/behavioral-patterns');
      if (!response.ok) {
        throw new Error(t('../../errors.fetchFailed', { defaultValue: 'Failed to fetch data' }));
      }
      setData(response.data);
      setLastFetch(Date.now());
    } catch (err) {
      console.error('Failed to fetch behavioral data:', err);
      setError(err instanceof Error ? err.message : t('../../errors.generic', { defaultValue: 'An error occurred' }));
    } finally {
      setLoading(false);
    }
  };

  const getCategoryColor = (amount: number, minAmount: number, maxAmount: number): string => {
    if (maxAmount === minAmount) return theme.palette.success.main;

    const normalized = (amount - minAmount) / (maxAmount - minAmount);

    if (normalized < 0.33) return theme.palette.success.main;
    else if (normalized < 0.66) return theme.palette.warning.main;
    else return theme.palette.error.main;
  };

  const formatCurrencyValue = (value: number) => formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

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
          <Typography variant="h5" fontWeight="bold" sx={{ background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`, backgroundClip: 'text', textFillColor: 'transparent', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {t('title')}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ minHeight: { xs: '60vh', sm: '70vh', md: '80vh' }, maxHeight: { xs: '85vh', sm: '85vh', md: '80vh' }, overflow: 'auto', p: { xs: 2, sm: 3 } }}>
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
            {/* Spending Behavior - Clean card design */}
            <Grid size={{ xs: 12, md: 3 }}>
              <Paper sx={{ p: 2.5, height: '100%', bgcolor: alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 2 }}>
                  {t('spendingBehavior.title')}
                </Typography>

                {/* Programmed spending card */}
                <Box sx={{
                  p: 1.5,
                  mb: 1.5,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.success.main, 0.08),
                  border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
                }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="caption" fontWeight="medium" color="success.main">
                      {t('spendingBehavior.programmed')}
                    </Typography>
                    <Typography variant="h6" fontWeight="bold" color="success.main">
                      {data.programmedPercentage?.toFixed(0)}%
                    </Typography>
                  </Box>
                  <Box sx={{
                    height: 6,
                    bgcolor: alpha(theme.palette.success.main, 0.2),
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}>
                    <Box sx={{
                      height: '100%',
                      width: `${data.programmedPercentage || 0}%`,
                      bgcolor: theme.palette.success.main,
                      borderRadius: 3,
                    }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    {formatCurrencyValue(data.programmedAmount || 0)}
                  </Typography>
                </Box>

                {/* Impulse spending card */}
                <Box sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.warning.main, 0.08),
                  border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
                }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="caption" fontWeight="medium" color="warning.main">
                      {t('spendingBehavior.impulse')}
                    </Typography>
                    <Typography variant="h6" fontWeight="bold" color="warning.main">
                      {data.impulsePercentage?.toFixed(0)}%
                    </Typography>
                  </Box>
                  <Box sx={{
                    height: 6,
                    bgcolor: alpha(theme.palette.warning.main, 0.2),
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}>
                    <Box sx={{
                      height: '100%',
                      width: `${data.impulsePercentage || 0}%`,
                      bgcolor: theme.palette.warning.main,
                      borderRadius: 3,
                    }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    {formatCurrencyValue(data.impulseAmount || 0)}
                  </Typography>
                </Box>
              </Paper>
            </Grid>

            {/* Recurring Patterns - Clean accordion list */}
            <Grid size={{ xs: 12, md: 9 }}>
              <Paper sx={{ p: 2.5, height: '100%', bgcolor: alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight="bold">
                    {t('recurring.title')}
                  </Typography>
                  {data.patternsByFrequency && (() => {
                    const grandTotal = Object.keys(data.patternsByFrequency).reduce((total, key) => {
                      const patterns = data.patternsByFrequency[key]?.transactions || [];
                      const multiplier = FREQUENCY_MULTIPLIERS[key] || 1;
                      return total + patterns.reduce((sum: number, p: any) => sum + (p.avgAmount || 0) * multiplier, 0);
                    }, 0);
                    return grandTotal > 0 ? (
                      <Typography variant="body2" fontWeight="medium" color="primary.main">
                        ~{formatCurrencyValue(grandTotal)}/mo
                      </Typography>
                    ) : null;
                  })()}
                </Box>

                {data.patternsByFrequency && Object.keys(data.patternsByFrequency).some(
                  (key) => data.patternsByFrequency[key]?.transactions?.length > 0
                ) ? (
                  <Box sx={{ maxHeight: 260, overflow: 'auto', pr: 0.5 }}>
                    {frequencyConfigs.map((config) => {
                      const frequencyData = data.patternsByFrequency[config.name];
                      const patterns = frequencyData?.transactions || [];

                      if (patterns.length === 0) return null;

                      const multipliers: Record<string, number> = {
                        daily: 30, weekly: 4, biweekly: 2, monthly: 1, bimonthly: 0.5,
                      };
                      const multiplier = multipliers[config.name] || 1;
                      const totalMonthly = patterns.reduce(
                        (sum: number, p: any) => sum + (p.avgAmount || 0) * multiplier, 0
                      );

                      return (
                        <Accordion
                          key={config.name}
                          disableGutters
                          sx={{
                            bgcolor: 'transparent',
                            boxShadow: 'none',
                            '&:before': { display: 'none' },
                            mb: 0.5,
                          }}
                        >
                          <AccordionSummary
                            expandIcon={<ExpandMoreIcon sx={{ color: config.color, fontSize: 20 }} />}
                            sx={{
                              minHeight: 44,
                              px: 1.5,
                              borderRadius: 1.5,
                              bgcolor: alpha(config.color, 0.06),
                              '&:hover': { bgcolor: alpha(config.color, 0.1) },
                              '& .MuiAccordionSummary-content': { my: 0.75 },
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                              <Avatar sx={{
                                width: 28,
                                height: 28,
                                bgcolor: alpha(config.color, 0.15),
                                color: config.color,
                              }}>
                                {config.icon}
                              </Avatar>
                              <Typography variant="body2" fontWeight="medium" sx={{ flex: 1 }}>
                                {config.label}
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Chip
                                  label={`${patterns.length} items`}
                                  size="small"
                                  sx={{
                                    height: 22,
                                    fontSize: '0.7rem',
                                    bgcolor: alpha(config.color, 0.12),
                                    color: config.color,
                                    fontWeight: 500,
                                  }}
                                />
                                <Typography variant="body2" fontWeight="medium" sx={{ color: config.color, minWidth: 70, textAlign: 'right' }}>
                                  {formatCurrencyValue(totalMonthly)}/mo
                                </Typography>
                              </Box>
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails sx={{ pt: 1, pb: 0.5, px: 1 }}>
                            <Grid container spacing={1}>
                              {patterns.map((pattern: any) => (
                                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={`${config.name}-${pattern.name}`}>
                                  <Box sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    py: 0.75,
                                    px: 1,
                                    borderRadius: 1,
                                    bgcolor: alpha(theme.palette.background.paper, 0.4),
                                    border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                                  }}>
                                    <Typography variant="body2" noWrap sx={{ flex: 1, mr: 1 }}>
                                      {pattern.name}
                                    </Typography>
                                    <Typography variant="body2" fontWeight="medium" sx={{ color: config.color }}>
                                      {formatCurrencyValue(pattern.avgAmount)}
                                    </Typography>
                                  </Box>
                                </Grid>
                              ))}
                            </Grid>
                          </AccordionDetails>
                        </Accordion>
                      );
                    })}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('recurring.noData')}
                  </Typography>
                )}
              </Paper>
            </Grid>

            {/* Average Spending per Category - Enhanced Design */}
            <Grid size={{ xs: 12 }}>
              <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('categoryAverages.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                  {t('categoryAverages.subtitle')}
                </Typography>

                {data.categoryAverages && data.categoryAverages.length > 0 ? (
                  (() => {
                    const amounts = data.categoryAverages.map((cat: any) => cat.avgPerWeek);
                    const minAmount = Math.min(...amounts);
                    const maxAmount = Math.max(...amounts);

                    return (
                      <Grid container spacing={2}>
                        {data.categoryAverages.map((cat: any) => {
                          const categoryColor = getCategoryColor(cat.avgPerWeek, minAmount, maxAmount);

                          return (
                            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={cat.category || cat.id}>
                              <Paper
                                elevation={0}
                                sx={{
                                  p: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 2,
                                  borderLeft: 4,
                                  borderColor: categoryColor,
                                  bgcolor: alpha(theme.palette.background.paper, 0.6),
                                  backdropFilter: 'blur(5px)',
                                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                                  borderLeftWidth: 4,
                                  transition: 'all 0.2s',
                                  '&:hover': {
                                    transform: 'translateY(-2px)',
                                    boxShadow: theme.shadows[4],
                                    bgcolor: alpha(theme.palette.background.paper, 0.8),
                                  }
                                }}
                              >
                                <Avatar sx={{ width: 48, height: 48, bgcolor: alpha(categoryColor, 0.1), color: categoryColor }}>
                                  <CategoryIcon iconName={cat.iconName || null} color={categoryColor} size={24} />
                                </Avatar>

                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="body2" fontWeight="medium" noWrap>
                                    {cat.category}
                                  </Typography>

                                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.5 }}>
                                    <Typography variant="h6" fontWeight="bold" sx={{ color: categoryColor }}>
                                      {formatCurrencyValue(cat.avgPerWeek)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">/week</Typography>
                                  </Box>

                                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                                    {cat.subscriptionCount > 0 ? (
                                      <Chip
                                        icon={<AutorenewIcon sx={{ fontSize: 14 }} />}
                                        label={t('categoryAverages.subscriptionBadge')}
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                        sx={{ height: 20, fontSize: '0.6875rem' }}
                                      />
                                    ) : cat.isRecurring ? (
                                      <Chip
                                        label={t('categoryAverages.recurringBadge')}
                                        size="small"
                                        color="success"
                                        variant="outlined"
                                        sx={{ height: 20, fontSize: '0.6875rem' }}
                                      />
                                    ) : null}
                                    {cat.recurringPercentage !== undefined && (
                                      <Chip
                                        label={`${cat.recurringPercentage?.toFixed(0)}%`}
                                        size="small"
                                        sx={{ height: 20, fontSize: '0.6875rem', bgcolor: alpha(categoryColor, 0.1), color: categoryColor }}
                                      />
                                    )}
                                  </Box>
                                </Box>
                              </Paper>
                            </Grid>
                          );
                        })}
                      </Grid>
                    );
                  })()
                ) : (
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                    {t('categoryAverages.noData')}
                  </Typography>
                )}
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

export default MoneyPersonalityModal;
