import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { MortgageScenario, RealEstateOverviewProperty } from '@renderer/types/investments';
import { usePropertyAnalysis, useRealEstateMortgage } from '../../hooks/useRealEstateMortgage';
import { apiClient } from '@/lib/api-client';
import MortgageSchedulePanel from './MortgageSchedulePanel';
import MortgageHealthPanel from './MortgageHealthPanel';
import SaleAnalysisPanel from './SaleAnalysisPanel';
import PropertyAssumptionsDialog from './PropertyAssumptionsDialog';
import HealthVerdictChip from './HealthVerdictChip';
import MortgageReconciliationCard from './MortgageReconciliationCard';
import MortgageStressPanel from './MortgageStressPanel';
import RefinancePanel from './RefinancePanel';
import MortgageTracksDialog from './MortgageTracksDialog';
import { addMonthsIso, draftFromView, type PropertyValueContext } from './mortgage-utils';

interface RealEstatePropertyDetailProps {
  open: boolean;
  property: RealEstateOverviewProperty | null;
  onClose: () => void;
  onChanged?: () => void;
}

const SCENARIOS: Array<{ key: string; scenario: MortgageScenario }> = [
  { key: 'base', scenario: {} },
  { key: 'prime1', scenario: { primeShiftPct: 1 } },
  { key: 'prime2', scenario: { primeShiftPct: 2 } },
  { key: 'cpi4', scenario: { cpiAnnualOverridePct: 4 } },
  { key: 'combined', scenario: { primeShiftPct: 2, cpiAnnualOverridePct: 4, anchorShiftPct: 1 } },
];

const RealEstatePropertyDetail: React.FC<RealEstatePropertyDetailProps> = ({ open, property, onClose, onChanged }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.mortgage' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [scenarioKey, setScenarioKey] = React.useState('base');
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = React.useState(false);
  const [tab, setTab] = React.useState<'mortgage' | 'sale' | 'health' | 'stress'>('mortgage');
  const [analysisKey, setAnalysisKey] = React.useState(0);
  const { t: tTabs } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.detailTabs' });
  const scenario = SCENARIOS.find((item) => item.key === scenarioKey)?.scenario;
  const { data, loading, error, save, remove } = useRealEstateMortgage(open && property ? property.accountId : null, scenario);
  const base = useRealEstateMortgage(open && property && scenarioKey !== 'base' ? property.accountId : null);
  const analysis = usePropertyAnalysis(open && property ? property.accountId : null, analysisKey);

  React.useEffect(() => {
    if (!open) {
      setScenarioKey('base');
      setTab('mortgage');
    }
  }, [open]);

  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };

  const propertyContext: PropertyValueContext | null = React.useMemo(() => (property
    ? {
      marketValue: property.propertyMarketValue,
      ownershipPercentage: property.ownershipPercentage,
      annualGrowthPct: property.annualGrowthRate ?? 3,
      valuationDate: property.lastValuationDate,
    }
    : null), [property]);

  const initialDraft = React.useMemo(() => draftFromView(data), [data]);

  const paymentAt = (view: typeof data, monthsAhead: number) => {
    if (!view?.schedule) return null;
    const month = addMonthsIso(view.asOf, monthsAhead).slice(0, 7);
    return view.schedule.monthly.find((point) => point.month === month)?.payment ?? null;
  };
  const horizonRows = [12, 36, 60].map((months) => ({
    months,
    value: paymentAt(data, months),
    base: scenarioKey === 'base' ? null : paymentAt(base.data, months),
  }));

  const handleSave = async (draft: Parameters<typeof save>[0]) => {
    await save(draft);
    setAnalysisKey((value) => value + 1);
    onChanged?.();
  };

  const handleRemove = async () => {
    if (!window.confirm(t('confirmRemove', 'Remove the detailed tracks? The property keeps its last computed balance.'))) return;
    await remove();
    setAnalysisKey((value) => value + 1);
    onChanged?.();
  };

  const source = data?.source;
  const hasSchedule = Boolean(data?.summary && data.schedule);

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {property?.accountName}
          {source === 'tracks' ? <Chip size="small" color="primary" label={t('source.tracks', 'Detailed tracks')} /> : null}
          {source === 'legacy' ? <Chip size="small" variant="outlined" label={t('source.legacy', 'Estimated')} /> : null}
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" size="small" startIcon={<EditIcon />} onClick={() => setEditorOpen(true)} disabled={loading && !data}>
            {source === 'tracks' ? t('actions.editTracks', 'Edit tracks') : t('actions.setupTracks', 'Set up tracks')}
          </Button>
        </DialogTitle>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="mortgage" label={tTabs('mortgage', 'Mortgage')} />
          <Tab value="sale" label={tTabs('sale', 'Sale & break-even')} />
          <Tab value="stress" label={tTabs('stress', 'Stress & refinance')} />
          <Tab
            value="health"
            label={(
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {tTabs('health', 'Credit health')}
                {analysis.data?.health ? <HealthVerdictChip verdict={analysis.data.health.overall} /> : null}
              </Box>
            )}
          />
        </Tabs>
        <DialogContent dividers>
          {tab === 'stress' && property ? (
            source === 'tracks' || source === 'legacy' ? (
              <Stack spacing={3}>
                <MortgageStressPanel accountId={property.accountId} refreshKey={analysisKey} />
                <RefinancePanel accountId={property.accountId} view={data} onApply={handleSave} refreshKey={analysisKey} />
              </Stack>
            ) : (
              <Alert severity="info">{tTabs('healthNeedsMortgage', 'Add your mortgage tracks to see the credit health.')}</Alert>
            )
          ) : null}
          {tab === 'sale' || tab === 'health' ? (
            <>
              {analysis.loading && !analysis.data ? <CircularProgress /> : null}
              {analysis.error ? <Alert severity="warning">{analysis.error}</Alert> : null}
              {tab === 'sale' && analysis.data ? (
                <SaleAnalysisPanel
                  sale={analysis.data.sale}
                  onEditAssumptions={() => setAssumptionsOpen(true)}
                  usingPriceIndex={property?.valuationMethod === 'price_index'}
                  onUsePriceIndex={property ? async () => {
                    // The profile endpoint replaces the whole profile: load it, switch the method, save.
                    const current = await apiClient.get<{ profile: Record<string, unknown> }>(`/api/investments/real-estate/profiles/${property.accountId}`);
                    if (!current.ok || !current.data?.profile) throw new Error('Failed to load the property profile');
                    const saved = await apiClient.put(`/api/investments/real-estate/profiles/${property.accountId}`, {
                      ...current.data.profile,
                      valuation_method: 'price_index',
                      last_valuation_date: new Date().toISOString().slice(0, 10),
                    });
                    if (!saved.ok) throw new Error('Failed to update the valuation');
                    await apiClient.post(`/api/investments/real-estate/profiles/${property.accountId}/apply-valuation`, {});
                    setAnalysisKey((value) => value + 1);
                    onChanged?.();
                  } : undefined}
                />
              ) : null}
              {tab === 'health' && analysis.data ? (
                analysis.data.health
                  ? <MortgageHealthPanel health={analysis.data.health} />
                  : <Alert severity="info">{tTabs('healthNeedsMortgage', 'Add your mortgage tracks to see the credit health.')}</Alert>
              ) : null}
            </>
          ) : null}
          <Box sx={{ display: tab === 'mortgage' ? 'block' : 'none' }}>
          {loading && !data ? <CircularProgress /> : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}

          {source === 'legacy' ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('legacyNotice', 'This projection is estimated from the single mortgage balance, rate and payment. Set up your tracks (prime, fixed, CPI-linked…) for an accurate schedule that follows the Bank of Israel rate and the CPI.')}
            </Alert>
          ) : null}
          {source === 'static' || source === 'none' ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('empty.title', 'No mortgage schedule yet')}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, mb: 2 }}>
                {t('empty.description', 'Add your mortgage tracks to see the balance over time, interest vs principal, and how prime or CPI changes affect your payment.')}
              </Typography>
              <Button variant="contained" onClick={() => setEditorOpen(true)}>{t('actions.setupTracks', 'Set up tracks')}</Button>
            </Paper>
          ) : null}

          {hasSchedule && data?.summary ? (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t('scenarios.title', 'What if rates change?')}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  {t('scenarios.subtitle', 'Shifts apply from today on. The base case keeps prime at today\'s rate and projects CPI from market inflation expectations.')}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
                  {SCENARIOS.map((item) => (
                    <Chip
                      key={item.key}
                      label={t(`scenarios.${item.key}`, item.key)}
                      color={scenarioKey === item.key ? 'primary' : 'default'}
                      variant={scenarioKey === item.key ? 'filled' : 'outlined'}
                      onClick={() => setScenarioKey(item.key)}
                    />
                  ))}
                  {loading ? <CircularProgress size={18} /> : null}
                </Stack>
                <Grid container spacing={1.5}>
                  {horizonRows.map((row) => {
                    const delta = row.value !== null && row.base !== null ? row.value - row.base : null;
                    return (
                      <Grid key={row.months} size={{ xs: 12, sm: 4 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                          {t('scenarios.paymentIn', 'Monthly payment in {{years}} year(s)', { years: row.months / 12 })}
                        </Typography>
                        <Typography variant="h6" sx={{ fontWeight: 900 }}>{money(row.value)}</Typography>
                        {delta !== null && Math.abs(delta) >= 1 ? (
                          <Typography variant="caption" sx={{ color: delta > 0 ? 'error.main' : 'success.main', fontWeight: 700 }}>
                            {delta > 0 ? '+' : ''}{money(delta)} {t('scenarios.vsBase', 'vs base')}
                          </Typography>
                        ) : null}
                      </Grid>
                    );
                  })}
                </Grid>
              </Paper>
              <MortgageSchedulePanel summary={data.summary} schedule={data.schedule} property={propertyContext} />
              {source === 'tracks' && property ? (
                <MortgageReconciliationCard accountId={property.accountId} refreshKey={analysisKey} onEditTracks={() => setEditorOpen(true)} />
              ) : null}
            </Stack>
          ) : null}
          </Box>
        </DialogContent>
        <DialogActions>
          {source === 'tracks' ? (
            <Button color="error" onClick={handleRemove}>{t('actions.removeTracks', 'Remove tracks')}</Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose}>{t('actions.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>
      {analysis.data ? (
        <PropertyAssumptionsDialog
          open={assumptionsOpen}
          settings={analysis.data.settings}
          effective={analysis.data.sale.settings}
          costs={analysis.data.costs}
          detectedIncome={analysis.data.health?.affordability.income?.source === 'transactions' ? analysis.data.health.affordability.income.monthly : null}
          onClose={() => setAssumptionsOpen(false)}
          onSave={async (settings, costs) => {
            await analysis.saveAssumptions(settings, costs);
            onChanged?.();
          }}
        />
      ) : null}
      <MortgageTracksDialog
        open={editorOpen}
        title={property ? t('editorTitleFor', 'Mortgage tracks — {{name}}', { name: property.accountName }) : undefined}
        initialDraft={initialDraft}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />
    </>
  );
};

export default RealEstatePropertyDetail;
