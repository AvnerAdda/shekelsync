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
  LinearProgress,
  useTheme,
  Alert,
  Button,
  alpha,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { BarChart } from '@mui/x-charts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';

interface MakeItRealModalProps {
  open: boolean;
  onClose: () => void;
}

const MakeItRealModal: React.FC<MakeItRealModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.makeItReal' });
  const { formatCurrency } = useFinancePrivacy();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    if (open && (!data || (Date.now() - lastFetch) > CACHE_DURATION)) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/api/analytics/time-value');
      if (!response.ok) {
        throw new Error(t('../../errors.fetchFailed', { defaultValue: 'Failed to fetch data' }));
      }
      setData(response.data);
      setLastFetch(Date.now());
    } catch (err) {
      console.error('Failed to fetch time value data:', err);
      setError(err instanceof Error ? err.message : t('../../errors.generic', { defaultValue: 'An error occurred' }));
    } finally {
      setLoading(false);
    }
  };

  const formatCurrencyValue = (value: number) => formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const renderContent = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      );
    }
    if (error) {
      return (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
          <Button onClick={fetchData} size="small" sx={{ ml: 2 }}>
            {t('../../actions.retry', { defaultValue: 'Retry' })}
          </Button>
        </Alert>
      );
    }
    if (!data) {
      return (
        <Typography color="text.secondary" align="center">
          {t('noData')}
        </Typography>
      );
    }

    return (
          <Grid container spacing={3}>
            {/* Hourly Wage Hero Section */}
            <Grid size={{ xs: 12 }}>
              <Paper
                elevation={0}
                sx={{
                  p: 4,
                  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.9)} 0%, ${alpha(theme.palette.primary.main, 0.8)} 100%)`,
                  color: theme.palette.primary.contrastText,
                  textAlign: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 3,
                  boxShadow: `0 8px 32px 0 ${alpha(theme.palette.primary.main, 0.3)}`,
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: `radial-gradient(circle at 20% 50%, ${alpha(theme.palette.common.white, 0.1)} 0%, transparent 50%)`,
                  }
                }}
              >
                <Box sx={{ position: 'relative', zIndex: 1 }}>
                  <Typography variant="h6" fontWeight="medium" sx={{ opacity: 0.9, mb: 2 }}>
                    {t('hourlyWage.title')}
                  </Typography>
                  <Typography variant="h2" fontWeight="bold" sx={{ my: 2 }}>
                    {formatCurrencyValue(data.hourlyWage || 0)}
                    <Typography component="span" variant="h4" sx={{ ml: 1, opacity: 0.8 }}>/hr</Typography>
                  </Typography>
                  <Typography variant="body1" sx={{ opacity: 0.85 }}>
                    {t('hourlyWage.subtitle')}
                  </Typography>
                </Box>
              </Paper>
            </Grid>

            {/* Income vs Expense Comparison */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Paper sx={{
                p: 3,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: alpha(theme.palette.background.paper, 0.4),
                backdropFilter: 'blur(10px)',
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.common.white, 0.05)}`,
              }}>
                <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ mb: 3 }}>
                  {t('incomeVsExpense.title')}
                </Typography>
                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">{t('incomeVsExpense.income')}</Typography>
                    <Typography variant="body1" fontWeight="bold" color="success.main">
                      {formatCurrencyValue(data.totalIncome || 0)}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={100}
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      bgcolor: alpha(theme.palette.success.main, 0.1),
                      '& .MuiLinearProgress-bar': {
                        bgcolor: 'success.main',
                        borderRadius: 4,
                      }
                    }}
                  />
                </Box>
                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">{t('incomeVsExpense.expenses')}</Typography>
                    <Typography variant="body1" fontWeight="bold" color="error.main">
                      {formatCurrencyValue(data.totalExpenses || 0)}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min((data.totalExpenses / (data.totalIncome || 1)) * 100, 100)}
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      bgcolor: alpha(theme.palette.error.main, 0.1),
                      '& .MuiLinearProgress-bar': {
                        bgcolor: 'error.main',
                        borderRadius: 4,
                      }
                    }}
                  />
                </Box>
                <Box sx={{ mt: 'auto', pt: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                  <Grid container alignItems="center" justifyContent="space-between">
                    <Grid>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('incomeVsExpense.ratio')}
                      </Typography>
                      <Typography variant="h4" fontWeight="bold" color={(data.totalIncome - data.totalExpenses) >= 0 ? 'success.main' : 'error.main'}>
                        {((data.totalExpenses / (data.totalIncome || 1)) * 100).toFixed(1)}%
                      </Typography>
                    </Grid>
                    <Grid>
                      <Typography variant="caption" color="text.secondary">
                        {t('incomeVsExpense.ofIncome')}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Paper>
            </Grid>

            {/* Hours Required per Category */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Paper sx={{
                p: 3,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: alpha(theme.palette.background.paper, 0.4),
                backdropFilter: 'blur(10px)',
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.common.white, 0.05)}`,
              }}>
                <Typography variant="h6" fontWeight="bold" gutterBottom>
                  {t('hoursRequired.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  {t('hoursRequired.subtitle')}
                </Typography>
                <Box sx={{ flex: 1, overflow: 'auto', pr: 1 }}>
                  {data.topCategories?.map((cat: any) => (
                  <Box key={cat.category} sx={{ mb: 2.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2" fontWeight="medium">{cat.category}</Typography>
                      <Typography variant="body2" fontWeight="bold" color="primary.main">
                        {cat.hours.toFixed(1)}h
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <LinearProgress
                        variant="determinate"
                        value={(cat.amount / (data.topCategories[0]?.amount || 1)) * 100}
                        sx={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          bgcolor: alpha(theme.palette.primary.main, 0.1),
                          '& .MuiLinearProgress-bar': {
                            bgcolor: 'primary.main',
                            borderRadius: 3,
                          }
                        }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60, textAlign: 'right' }}>
                        {formatCurrencyValue(cat.amount)}
                      </Typography>
                    </Box>
                  </Box>
                  ))}
                </Box>
              </Paper>
            </Grid>

            {/* Category Costs in Work Hours */}
            <Grid size={{ xs: 12 }}>
              <Paper sx={{
                p: 3,
                bgcolor: alpha(theme.palette.background.paper, 0.4),
                backdropFilter: 'blur(10px)',
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.common.white, 0.05)}`,
              }}>
                <Typography variant="h6" fontWeight="bold" gutterBottom>
                  {t('categoryHours.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  {t('categoryHours.subtitle')}
                </Typography>
                <Box sx={{ height: 300, width: '100%' }}>
                  <BarChart
                    height={300}
                    series={[
                      {
                        data: data.categoryCosts?.map((c: any) => c.hours) || [],
                        label: t('categoryHours.hours'),
                        color: theme.palette.warning.main,
                      },
                    ]}
                    xAxis={[{
                      data: data.categoryCosts?.map((c: any) => c.category) || [],
                      scaleType: 'band',
                    }]}
                    yAxis={[{
                      label: t('categoryHours.yAxisLabel'),
                    }]}
                    slotProps={{
                      legend: {
                        hidden: true
                      }
                    }}
                    sx={{
                      '.MuiBarElement-root': {
                        fill: `url(#categoryHoursGradient)`,
                      }
                    }}
                  >
                    <defs>
                      <linearGradient id="categoryHoursGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={theme.palette.warning.main} stopOpacity={0.8} />
                        <stop offset="100%" stopColor={theme.palette.warning.dark} stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </Box>
              </Paper>
            </Grid>

            {/* Biggest Purchase Analysis */}
            <Grid size={{ xs: 12 }}>
              <Paper
                elevation={0}
                sx={{
                  p: 4,
                  borderRadius: 3,
                  borderLeft: `6px solid ${theme.palette.warning.main}`,
                  background: `linear-gradient(to right, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.background.paper, 0.4)} 100%)`,
                  backdropFilter: 'blur(10px)',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: `0 8px 24px ${alpha(theme.palette.warning.main, 0.15)}`
                  }
                }}
              >
                <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {t('biggestPurchase.title')}
                </Typography>
                {data.biggestPurchase ? (
                  <Box>
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                      {data.biggestPurchase.name}
                    </Typography>
                    <Typography variant="h3" fontWeight="bold" sx={{
                      mb: 4,
                      background: `linear-gradient(45deg, ${theme.palette.warning.main}, ${theme.palette.warning.dark})`,
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}>
                      {formatCurrencyValue(data.biggestPurchase.amount)}
                    </Typography>
                    <Grid container spacing={3}>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            bgcolor: alpha(theme.palette.warning.main, 0.1),
                            border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
                            borderRadius: 2,
                          }}
                        >
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                            {t('biggestPurchase.hoursOfWork')}
                          </Typography>
                          <Typography variant="h4" fontWeight="bold" color="warning.main">
                            {data.biggestPurchase.hours.toFixed(1)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            hours
                          </Typography>
                        </Paper>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            bgcolor: alpha(theme.palette.warning.main, 0.1),
                            border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
                            borderRadius: 2,
                          }}
                        >
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                            {t('biggestPurchase.daysOfWork')}
                          </Typography>
                          <Typography variant="h4" fontWeight="bold" color="warning.main">
                            {data.biggestPurchase.days.toFixed(1)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('biggestPurchase.days')}
                          </Typography>
                        </Paper>
                      </Grid>
                    </Grid>
                  </Box>
                ) : (
                  <Typography color="text.secondary">
                    {t('biggestPurchase.noData')}
                  </Typography>
                )}
              </Paper>
            </Grid>
          </Grid>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: alpha(theme.palette.background.paper, 0.8),
          backdropFilter: 'blur(20px)',
          backgroundImage: 'none',
          borderRadius: 3,
          border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        }
      }}
    >
      <DialogTitle sx={{ p: 3, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h4" fontWeight="bold" sx={{
            background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {t('title')}
          </Typography>
          <IconButton onClick={onClose} size="small" sx={{
            color: 'text.secondary',
            '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.05) }
          }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{
        minHeight: { xs: '60vh', sm: '70vh', md: '80vh' },
        maxHeight: { xs: '85vh', sm: '85vh', md: '80vh' },
        overflow: 'auto',
        p: { xs: 2, sm: 3 },
        borderColor: alpha(theme.palette.divider, 0.1),
      }}>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
};

export default MakeItRealModal;
