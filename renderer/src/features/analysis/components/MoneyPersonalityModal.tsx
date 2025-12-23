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
  Badge,
  Avatar,
  Alert,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { PieChart } from '@mui/x-charts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import CategoryIcon from '@renderer/features/breakdown/components/CategoryIcon';

interface MoneyPersonalityModalProps {
  open: boolean;
  onClose: () => void;
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
            {/* Programmed vs Impulse */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('spendingBehavior.title')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('spendingBehavior.programmed')}
                    </Typography>
                    <Typography variant="h6" color="success.main">
                      {data.programmedPercentage?.toFixed(0)}%
                    </Typography>
                    <Typography variant="caption">
                      {formatCurrencyValue(data.programmedAmount || 0)}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('spendingBehavior.impulse')}
                    </Typography>
                    <Typography variant="h6" color="warning.main">
                      {data.impulsePercentage?.toFixed(0)}%
                    </Typography>
                    <Typography variant="caption">
                      {formatCurrencyValue(data.impulseAmount || 0)}
                    </Typography>
                  </Box>
                </Box>
                <PieChart
                  series={[
                    {
                      data: [
                        { id: 0, value: data.programmedAmount || 0, label: t('spendingBehavior.programmed'), color: theme.palette.success.main },
                        { id: 1, value: data.impulseAmount || 0, label: t('spendingBehavior.impulse'), color: theme.palette.warning.main },
                      ],
                    },
                  ]}
                  height={180}
                  slotProps={{ legend: { hidden: true } }}
                />
              </Paper>
            </Grid>

            {/* Recurring Patterns */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  {t('recurring.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {t('recurring.subtitle')}
                </Typography>
                {data.recurringPatterns && data.recurringPatterns.length > 0 ? (
                  <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
                    {data.recurringPatterns.slice(0, 6).map((pattern: any, index: number) => (
                      <Box key={index} sx={{ mb: 1.5, pb: 1.5, borderBottom: index < 5 ? 1 : 0, borderColor: 'divider' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" fontWeight="medium">
                            {pattern.name}
                          </Typography>
                          <Chip
                            label={pattern.frequency}
                            size="small"
                            color={pattern.frequency === 'monthly' ? 'primary' : 'default'}
                          />
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                          {formatCurrencyValue(pattern.avgAmount)} × {pattern.occurrences}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('recurring.noData')}
                  </Typography>
                )}
              </Paper>
            </Grid>

            {/* Average Spending per Category - Enhanced Design */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
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
                        {data.categoryAverages.map((cat: any, index: number) => {
                          const categoryColor = getCategoryColor(cat.avgPerWeek, minAmount, maxAmount);

                          return (
                            <Grid item xs={12} sm={6} md={4} key={index}>
                              <Paper
                                elevation={2}
                                sx={{
                                  p: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 2,
                                  borderLeft: 4,
                                  borderColor: categoryColor,
                                  transition: 'all 0.2s',
                                  '&:hover': {
                                    transform: 'translateY(-2px)',
                                    boxShadow: theme.shadows[4]
                                  }
                                }}
                              >
                                <Avatar sx={{ width: 48, height: 48, bgcolor: `${categoryColor}20`, color: categoryColor }}>
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
                                    {cat.isRecurring && (
                                      <Chip
                                        label={t('categoryAverages.recurringBadge')}
                                        size="small"
                                        color="success"
                                        variant="outlined"
                                        sx={{ height: 20, fontSize: '0.6875rem' }}
                                      />
                                    )}
                                    {cat.recurringPercentage !== undefined && (
                                      <Chip
                                        label={`${cat.recurringPercentage?.toFixed(0)}%`}
                                        size="small"
                                        sx={{ height: 20, fontSize: '0.6875rem', bgcolor: `${categoryColor}15`, color: categoryColor }}
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
