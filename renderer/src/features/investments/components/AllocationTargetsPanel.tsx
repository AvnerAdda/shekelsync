import React from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Skeleton,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type {
  InvestmentAllocationTargetsResponse,
  InvestmentCategoryKey,
  PortfolioSummary,
} from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import {
  getPortfolioCategoryBucketsForScope,
  getPortfolioScopeTotal,
  INVESTMENT_CATEGORY_ORDER,
} from '../utils/portfolio-categories';

interface AllocationTargetsPanelProps {
  portfolioData: PortfolioSummary;
  fxComplete: boolean;
  valuationsComplete: boolean;
  baseCurrency?: string;
}

type TargetDraft = Record<InvestmentCategoryKey, string>;

function emptyDraft(): TargetDraft {
  return INVESTMENT_CATEGORY_ORDER.reduce((result, category) => {
    result[category] = '0';
    return result;
  }, {} as TargetDraft);
}

const AllocationTargetsPanel: React.FC<AllocationTargetsPanelProps> = ({
  portfolioData,
  fxComplete,
  valuationsComplete,
  baseCurrency = 'ILS',
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation');
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [data, setData] = React.useState<InvestmentAllocationTargetsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<TargetDraft>(emptyDraft);

  const fetchTargets = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<InvestmentAllocationTargetsResponse>(
        '/api/investments/allocation-targets?scope=exclude_real_estate',
        { cacheMode: 'no-store' },
      );
      if (!response.ok) throw new Error(response.statusText || 'Failed to load allocation targets');
      setData(response.data || null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load allocation targets');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchTargets();
  }, [fetchTargets]);

  const total = getPortfolioScopeTotal(portfolioData, 'exclude_real_estate');
  const driftAvailable = fxComplete && valuationsComplete;
  const safeTotal = total ?? 0;
  const actualByCategory = React.useMemo(() => {
    const values = new Map<InvestmentCategoryKey, number>();
    getPortfolioCategoryBucketsForScope(portfolioData, 'exclude_real_estate').forEach(({ key, bucket }) => {
      values.set(key, driftAvailable
        && safeTotal > 0
        && typeof bucket.totalValue === 'number'
        ? (bucket.totalValue / safeTotal) * 100
        : 0);
    });
    return values;
  }, [driftAvailable, portfolioData, safeTotal]);
  const targetsByCategory = React.useMemo(
    () => new Map((data?.targets || []).map((target) => [target.category, target.targetPercentage])),
    [data],
  );

  const openEditor = () => {
    const next = emptyDraft();
    INVESTMENT_CATEGORY_ORDER.forEach((category) => {
      const existing = targetsByCategory.get(category);
      next[category] = (existing ?? actualByCategory.get(category) ?? 0).toFixed(2);
    });
    setDraft(next);
    setError(null);
    setDialogOpen(true);
  };

  const draftTotal = INVESTMENT_CATEGORY_ORDER.reduce(
    (sum, category) => sum + (Number(draft[category]) || 0),
    0,
  );

  const saveTargets = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.put<InvestmentAllocationTargetsResponse>(
        '/api/investments/allocation-targets',
        {
          scope: 'exclude_real_estate',
          targets: INVESTMENT_CATEGORY_ORDER.map((category) => ({
            category,
            targetPercentage: Number(draft[category]) || 0,
          })),
        },
      );
      if (!response.ok) {
        const payload = response.data as { error?: string } | undefined;
        throw new Error(payload?.error || response.statusText || 'Failed to save allocation targets');
      }
      setData(response.data || null);
      setDialogOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save allocation targets');
    } finally {
      setSaving(false);
    }
  };

  const clearTargets = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.delete<InvestmentAllocationTargetsResponse>(
        '/api/investments/allocation-targets?scope=exclude_real_estate',
      );
      if (!response.ok) throw new Error(response.statusText || 'Failed to clear allocation targets');
      setData(response.data || null);
      setDialogOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to clear allocation targets');
    } finally {
      setSaving(false);
    }
  };

  const formatAmount = (value: number) => {
    if (maskAmounts) return '***';
    return formatCurrency(value, {
      absolute: false,
      maximumFractionDigits: 0,
      currencySymbol: baseCurrency === 'ILS' ? '₪' : `${baseCurrency} `,
    });
  };

  if (loading) {
    return (
      <Paper sx={{ p: 2.5 }}>
        <Skeleton width={240} height={30} />
        <Skeleton width="55%" />
        <Skeleton variant="rounded" height={180} sx={{ mt: 2 }} />
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('investmentsPage.allocationTargets.title', 'Target category mix')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(
              'investmentsPage.allocationTargets.subtitle',
              'Compare tracked categories with your plan, excluding real estate.',
            )}
          </Typography>
        </Box>
        <Button size="small" startIcon={<EditIcon />} onClick={openEditor} disabled={saving}>
          {data?.configured
            ? t('investmentsPage.allocationTargets.edit', 'Edit targets')
            : t('investmentsPage.allocationTargets.set', 'Set targets')}
        </Button>
      </Box>

      {!fxComplete && (
        <Alert severity="warning">
          {t(
            'investmentsPage.allocationTargets.fxRequired',
            'Add the missing FX rates before calculating allocation drift.',
          )}
        </Alert>
      )}
      {fxComplete && !valuationsComplete && (
        <Alert severity="warning">
          {t(
            'investmentsPage.allocationTargets.valuationsRequired',
            'Value every account before calculating allocation drift.',
          )}
        </Alert>
      )}
      {error && !dialogOpen && <Alert severity="error" action={<Button onClick={() => void fetchTargets()}>{t('common.retry', 'Retry')}</Button>}>{error}</Alert>}

      {driftAvailable && !data?.configured ? (
        <Box sx={{ py: 2, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {t('investmentsPage.allocationTargets.empty', 'No allocation plan has been saved yet.')}
          </Typography>
        </Box>
      ) : driftAvailable ? (
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          {INVESTMENT_CATEGORY_ORDER.map((category) => {
            const actual = actualByCategory.get(category) || 0;
            const target = targetsByCategory.get(category) || 0;
            const drift = actual - target;
            const amount = (target - actual) / 100 * safeTotal;
            return (
              <Box
                key={category}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(120px, 1fr) 2fr repeat(3, minmax(76px, auto))' },
                  alignItems: 'center',
                  gap: 1.25,
                  p: 1.25,
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t(`investmentsPage.balanceSheet.buckets.${category}`)}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(actual, 100)}
                  color={Math.abs(drift) <= 2 ? 'success' : Math.abs(drift) <= 5 ? 'warning' : 'error'}
                  sx={{ height: 8, borderRadius: 999 }}
                />
                <Typography variant="caption">{t('investmentsPage.allocationTargets.actual', 'Actual')} {actual.toFixed(1)}%</Typography>
                <Typography variant="caption">{t('investmentsPage.allocationTargets.target', 'Target')} {target.toFixed(1)}%</Typography>
                <Typography
                  variant="caption"
                  sx={{ color: Math.abs(drift) <= 2 ? 'success.main' : 'warning.main', fontWeight: 700 }}
                >
                  {drift >= 0 ? '+' : ''}{drift.toFixed(1)} pp · {formatAmount(amount)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      ) : null}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('investmentsPage.allocationTargets.dialogTitle', 'Edit category targets')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1.5, pt: '12px !important' }}>
          <Alert severity={Math.abs(draftTotal - 100) <= 0.01 ? 'success' : 'warning'}>
            {t('investmentsPage.allocationTargets.total', 'Total')}: {draftTotal.toFixed(2)}%
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}
          {INVESTMENT_CATEGORY_ORDER.map((category) => (
            <TextField
              key={category}
              type="number"
              size="small"
              label={t(`investmentsPage.balanceSheet.buckets.${category}`)}
              value={draft[category]}
              onChange={(event) => setDraft((current) => ({ ...current, [category]: event.target.value }))}
              slotProps={{ htmlInput: { min: 0, max: 100, step: 0.5 } }}
            />
          ))}
        </DialogContent>
        <DialogActions>
          {data?.configured && (
            <Button color="inherit" startIcon={<RestartAltIcon />} disabled={saving} onClick={() => void clearTargets()}>
              {t('investmentsPage.allocationTargets.clear', 'Clear')}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => void saveTargets()}
            disabled={saving || Math.abs(draftTotal - 100) > 0.01}
          >
            {t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default AllocationTargetsPanel;
