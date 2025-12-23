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
            {/* Hourly Wage Hero Section */}
            <Grid item xs={12}>
              <Paper
                elevation={4}
                sx={{
                  p: 4,
                  background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 100%)`,
                  color: theme.palette.primary.contrastText,
                  textAlign: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: `radial-gradient(circle at 20% 50%, ${theme.palette.primary.light}40 0%, transparent 50%)`,
                  }
                }}
              >
                <Box sx={{ position: 'relative', zIndex: 1 }}>
                  <Typography variant="h6" fontWeight="medium" sx={{ opacity: 0.9, mb: 2 }}>
                    {t('hourlyWage.title')}
                  </Typography>
                  <Typography variant="h2" fontWeight="bold" sx={{ my: 2 }}>
                    {formatCurrencyValue(data.hourlyWage || 0)}
                    <Typography component="span" variant="h4" sx={{ ml: 1 }}>/hr</Typography>
                  </Typography>
                  <Typography variant="body1" sx={{ opacity: 0.85 }}>
                    {t('hourlyWage.subtitle')}
                  </Typography>
                </Box>
              </Paper>
            </Grid>

            {/* Income vs Expense Comparison */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('incomeVsExpense.title')}
                </Typography>
                <Box sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption">{t('incomeVsExpense.income')}</Typography>
                    <Typography variant="body2" fontWeight="bold" color="success.main">
                      {formatCurrencyValue(data.totalIncome || 0)}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={100}
                    sx={{ height: 6, borderRadius: 1, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: 'success.main' } }}
                  />
                </Box>
                <Box sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption">{t('incomeVsExpense.expenses')}</Typography>
                    <Typography variant="body2" fontWeight="bold" color="error.main">
                      {formatCurrencyValue(data.totalExpenses || 0)}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={(data.totalExpenses / data.totalIncome) * 100}
                    sx={{ height: 6, borderRadius: 1, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: 'error.main' } }}
                  />
                </Box>
                <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('incomeVsExpense.ratio')}
                  </Typography>
                  <Typography variant="h6" color={(data.totalIncome - data.totalExpenses) >= 0 ? 'success.main' : 'error.main'}>
                    {((data.totalExpenses / data.totalIncome) * 100).toFixed(1)}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('incomeVsExpense.ofIncome')}
                  </Typography>
                </Box>
              </Paper>
            </Grid>

            {/* Hours Required per Category */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('hoursRequired.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  {t('hoursRequired.subtitle')}
                </Typography>
                <Box sx={{ flex: 1, overflow: 'auto' }}>
                  {data.topCategories && data.topCategories.map((cat: any, index: number) => (
                  <Box key={index} sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">{cat.category}</Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {cat.hours.toFixed(1)}h
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={(cat.amount / (data.topCategories[0]?.amount || 1)) * 100}
                        sx={{ flex: 1, height: 6, borderRadius: 1 }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {formatCurrencyValue(cat.amount)}
                      </Typography>
                    </Box>
                  </Box>
                  ))}
                </Box>
              </Paper>
            </Grid>

            {/* Category Costs in Work Hours */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('categoryHours.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {t('categoryHours.subtitle')}
                </Typography>
                <BarChart
                  height={250}
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
                />
              </Paper>
            </Grid>

            {/* Biggest Purchase Analysis */}
            <Grid item xs={12}>
              <Paper
                elevation={3}
                sx={{
                  p: 3,
                  borderLeft: 4,
                  borderColor: theme.palette.warning.main,
                  background: `linear-gradient(to right, ${theme.palette.warning.main}08 0%, transparent 100%)`,
                  transition: 'all 0.2s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: theme.shadows[6]
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
                    <Typography variant="h3" fontWeight="bold" color="warning.main" sx={{ mb: 3 }}>
                      {formatCurrencyValue(data.biggestPurchase.amount)}
                    </Typography>
                    <Grid container spacing={3}>
                      <Grid item xs={6} sm={3}>
                        <Paper
                          elevation={1}
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            bgcolor: theme.palette.warning.main + '15',
                            border: 1,
                            borderColor: theme.palette.warning.main + '40'
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
                      <Grid item xs={6} sm={3}>
                        <Paper
                          elevation={1}
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            bgcolor: theme.palette.warning.main + '15',
                            border: 1,
                            borderColor: theme.palette.warning.main + '40'
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
        ) : (
          <Typography color="text.secondary" align="center">
            {t('noData')}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MakeItRealModal;
