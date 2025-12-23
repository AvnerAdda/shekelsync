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
  ToggleButtonGroup,
  ToggleButton,
  useTheme,
  Alert,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { LineChart, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';

interface PersonalizedFutureModalProps {
  open: boolean;
  onClose: () => void;
}

type ForecastScenario = 'pessimistic' | 'base' | 'optimistic';

const PersonalizedFutureModal: React.FC<PersonalizedFutureModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.future' });
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
      const response = await apiClient.get('/api/analytics/forecast-extended');
      if (!response.ok) {
        throw new Error(t('../../errors.fetchFailed', { defaultValue: 'Failed to fetch data' }));
      }
      setData(response.data);
      setLastFetch(Date.now());
    } catch (err) {
      console.error('Failed to fetch forecast data:', err);
      setError(err instanceof Error ? err.message : t('../../errors.generic', { defaultValue: 'An error occurred' }));
    } finally {
      setLoading(false);
    }
  };

  const formatCurrencyValue = (value: number) => formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {payload[0].payload.date}
          </Typography>
          {payload.map((entry: any, index: number) => (
            <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Box sx={{ width: 12, height: 12, bgcolor: entry.color, borderRadius: 1 }} />
              <Typography variant="body2">
                {entry.name}: {formatCurrencyValue(entry.value)}
              </Typography>
            </Box>
          ))}
        </Paper>
      );
    }
    return null;
  };

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
          <Box>
            <Typography variant="h5" fontWeight="bold">
              {t('title')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              6-month forecast based on your financial patterns
            </Typography>
          </Box>
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
            {/* Net Position with Three Scenario Curves */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('netPosition.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {t('netPosition.subtitle')}
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={data.combinedData || []} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <defs>
                      <linearGradient id="historicalGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.palette.warning.main} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={theme.palette.warning.main} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis
                      dataKey="date"
                      stroke={theme.palette.text.secondary}
                      style={{ fontSize: '0.75rem' }}
                    />
                    <YAxis
                      stroke={theme.palette.text.secondary}
                      tickFormatter={formatCurrencyValue}
                      style={{ fontSize: '0.75rem' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: '0.875rem' }}
                      iconType="line"
                    />
                    <ReferenceLine
                      y={0}
                      stroke={theme.palette.text.secondary}
                      strokeDasharray="3 3"
                      strokeWidth={1}
                    />
                    <Area
                      type="monotone"
                      dataKey="historicalCumulative"
                      stroke={theme.palette.primary.main}
                      strokeWidth={2}
                      fill="url(#historicalGradient)"
                      name={t('netPosition.historical')}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="p10Cumulative"
                      stroke={theme.palette.success.main}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name={`${t('scenarios.good')} (P10)`}
                      connectNulls
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="p50Cumulative"
                      stroke={theme.palette.warning.main}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name={`${t('scenarios.normal')} (P50)`}
                      connectNulls
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="p90Cumulative"
                      stroke={theme.palette.error.main}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name={`${t('scenarios.bad')} (P90)`}
                      connectNulls
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            {/* Scenario Summary Cards */}
            <Grid item xs={12}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <Paper
                    elevation={3}
                    sx={{
                      p: 3,
                      bgcolor: theme.palette.error.dark,
                      color: theme.palette.error.contrastText,
                      borderTop: 4,
                      borderColor: theme.palette.error.main,
                      transition: 'all 0.2s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: theme.shadows[6]
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                      <Box>
                        <Typography variant="body2" fontWeight="medium" sx={{ opacity: 0.9 }}>
                          {t('scenarios.bad')} (P90)
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.8, display: 'block', mt: 0.5 }}>
                          Worst case scenario (only 10% chance it's worse)
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ my: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="caption">Income:</Typography>
                        <Typography variant="caption" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.pessimistic?.income || 0)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                        <Typography variant="caption">Expenses:</Typography>
                        <Typography variant="caption" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.pessimistic?.expenses || 0)}
                        </Typography>
                      </Box>
                      <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.3)', pt: 1, display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="body2" fontWeight="bold">Net:</Typography>
                        <Typography variant="h6" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.pessimistic?.netCashFlow || 0)}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      {t('scenarios.endOfPeriod')}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Paper
                    elevation={3}
                    sx={{
                      p: 3,
                      bgcolor: theme.palette.warning.dark,
                      color: theme.palette.warning.contrastText,
                      borderTop: 4,
                      borderColor: theme.palette.warning.main,
                      transition: 'all 0.2s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: theme.shadows[6]
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                      <Box>
                        <Typography variant="body2" fontWeight="medium" sx={{ opacity: 0.9 }}>
                          {t('scenarios.normal')} (P50)
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.8, display: 'block', mt: 0.5 }}>
                          Most likely scenario (median outcome)
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ my: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="caption">Income:</Typography>
                        <Typography variant="caption" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.base?.income || 0)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                        <Typography variant="caption">Expenses:</Typography>
                        <Typography variant="caption" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.base?.expenses || 0)}
                        </Typography>
                      </Box>
                      <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.3)', pt: 1, display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="body2" fontWeight="bold">Net:</Typography>
                        <Typography variant="h6" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.base?.netCashFlow || 0)}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      {t('scenarios.endOfPeriod')}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Paper
                    elevation={3}
                    sx={{
                      p: 3,
                      bgcolor: theme.palette.success.dark,
                      color: theme.palette.success.contrastText,
                      borderTop: 4,
                      borderColor: theme.palette.success.main,
                      transition: 'all 0.2s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: theme.shadows[6]
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                      <Box>
                        <Typography variant="body2" fontWeight="medium" sx={{ opacity: 0.9 }}>
                          {t('scenarios.good')} (P10)
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.8, display: 'block', mt: 0.5 }}>
                          Best case scenario (90% chance it's at least this good)
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ my: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="caption">Income:</Typography>
                        <Typography variant="caption" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.optimistic?.income || 0)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                        <Typography variant="caption">Expenses:</Typography>
                        <Typography variant="caption" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.optimistic?.expenses || 0)}
                        </Typography>
                      </Box>
                      <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.3)', pt: 1, display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="body2" fontWeight="bold">Net:</Typography>
                        <Typography variant="h6" fontWeight="bold">
                          {formatCurrencyValue(data.summaries?.optimistic?.netCashFlow || 0)}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      {t('scenarios.endOfPeriod')}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
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

export default PersonalizedFutureModal;
