import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from 'react-i18next';
import type { PropertyCost, PropertyCostType, PropertySettings } from '@renderer/types/investments';

interface PropertyAssumptionsDialogProps {
  open: boolean;
  settings: PropertySettings;
  /** Effective values used by the analysis (defaults filled in). */
  effective: Partial<PropertySettings>;
  costs: PropertyCost[];
  detectedIncome: number | null;
  onClose: () => void;
  onSave: (settings: PropertySettings, costs: PropertyCost[]) => Promise<void>;
}

const VALUE_INDEX_SERIES = [
  'cbs.hpi.national', 'cbs.hpi.new_dwellings', 'cbs.hpi.district.jerusalem', 'cbs.hpi.district.north',
  'cbs.hpi.district.haifa', 'cbs.hpi.district.center', 'cbs.hpi.district.tel_aviv', 'cbs.hpi.district.south',
];
const VALUE_INDEX_FALLBACKS: Record<string, string> = {
  'cbs.hpi.national': 'National', 'cbs.hpi.new_dwellings': 'New dwellings', 'cbs.hpi.district.jerusalem': 'Jerusalem district',
  'cbs.hpi.district.north': 'North district', 'cbs.hpi.district.haifa': 'Haifa district', 'cbs.hpi.district.center': 'Center district',
  'cbs.hpi.district.tel_aviv': 'Tel Aviv district', 'cbs.hpi.district.south': 'South district',
};

const COST_TYPES: PropertyCostType[] = ['down_payment', 'purchase_tax', 'lawyer', 'broker', 'appraisal', 'renovation', 'mortgage_fees', 'other'];
const COST_FALLBACKS: Record<PropertyCostType, string> = {
  down_payment: 'Down payment (own funds)',
  purchase_tax: 'Purchase tax (מס רכישה)',
  lawyer: 'Lawyer',
  broker: 'Broker',
  appraisal: 'Appraiser',
  renovation: 'Renovation',
  mortgage_fees: 'Mortgage fees',
  other: 'Other',
};

function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const PropertyAssumptionsDialog: React.FC<PropertyAssumptionsDialogProps> = ({
  open, settings, effective, costs, detectedIncome, onClose, onSave,
}) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.assumptions' });
  const [draft, setDraft] = React.useState<PropertySettings>(settings);
  const [draftCosts, setDraftCosts] = React.useState<PropertyCost[]>(costs);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setDraftCosts(costs.filter((cost) => !cost.derived));
    setError(null);
  }, [open, settings, costs]);

  const field = (key: keyof PropertySettings, label: string, adornment?: string, helper?: string) => (
    <TextField
      fullWidth
      size="small"
      type="number"
      label={label}
      value={draft[key] === null || draft[key] === undefined ? '' : String(draft[key])}
      placeholder={effective[key] !== undefined && effective[key] !== null ? String(effective[key]) : undefined}
      onChange={(event) => setDraft((previous) => ({ ...previous, [key]: parseNumber(event.target.value) }))}
      helperText={helper}
      slotProps={{
        inputLabel: { shrink: true },
        input: adornment ? { endAdornment: <Typography variant="caption" sx={{ color: 'text.secondary' }}>{adornment}</Typography> } : undefined,
      }}
    />
  );

  const updateCost = (index: number, patch: Partial<PropertyCost>) => {
    setDraftCosts((previous) => previous.map((cost, position) => (position === index ? { ...cost, ...patch } : cost)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft, draftCosts.filter((cost) => cost.amount !== null && cost.amount !== undefined));
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('saveFailed', 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{t('title', 'Assumptions & purchase costs')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t('usage.title', 'How you use the property')}</Typography>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={t('usage.type', 'Usage')}
                  value={draft.usageType || 'owner_occupied'}
                  onChange={(event) => setDraft((previous) => ({ ...previous, usageType: event.target.value as PropertySettings['usageType'] }))}
                >
                  <MenuItem value="owner_occupied">{t('usage.owner_occupied', 'I live in it')}</MenuItem>
                  <MenuItem value="rented">{t('usage.rented', 'Rented out')}</MenuItem>
                  <MenuItem value="vacant">{t('usage.vacant', 'Vacant')}</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                {field('marketRent', draft.usageType === 'rented' ? t('usage.rentReceived', 'Monthly rent received') : t('usage.rentSaved', 'Rent of an equivalent home'), '₪/month')}
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label={t('usage.delivery', 'Delivery / move-in date')}
                  value={draft.deliveryDate || ''}
                  onChange={(event) => setDraft((previous) => ({ ...previous, deliveryDate: event.target.value || null }))}
                  helperText={t('usage.deliveryHint', 'Off-plan: rent is saved only from delivery')}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>{field('rentGrowthPct', t('usage.rentGrowth', 'Rent growth'), '%/yr')}</Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={Boolean(draft.isOffPlan)}
                      onChange={(event) => setDraft((previous) => ({ ...previous, isOffPlan: event.target.checked }))}
                    />
                  )}
                  label={t('usage.offPlan', 'Bought off-plan (from a developer)')}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={t('usage.valueIndex', 'Price index for automatic value')}
                  value={draft.valueIndexSeries || ''}
                  onChange={(event) => setDraft((previous) => ({ ...previous, valueIndexSeries: event.target.value || null }))}
                  slotProps={{ inputLabel: { shrink: true } }}
                >
                  <MenuItem value="">{t('usage.valueIndexAuto', 'Automatic (new dwellings if off-plan, else national)')}</MenuItem>
                  {VALUE_INDEX_SERIES.map((series) => (
                    <MenuItem key={series} value={series}>{t(`valueIndex.${series.replace(/\./g, '_')}`, VALUE_INDEX_FALLBACKS[series])}</MenuItem>
                  ))}
                </TextField>
              </Grid>
              {draft.usageType === 'rented' ? (
                <>
                  <Grid size={{ xs: 6, sm: 4 }}>{field('vacancyPct', t('usage.vacancy', 'Vacancy'), '%')}</Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>{field('rentalTaxPct', t('usage.rentalTax', 'Tax on rent'), '%', t('usage.rentalTaxHint', '0 if under the exemption ceiling, 10 on the flat track'))}</Grid>
                </>
              ) : null}
            </Grid>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t('sale.title', 'Selling')}</Typography>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, sm: 3 }}>{field('brokerPct', t('sale.broker', 'Broker'), '%')}</Grid>
              <Grid size={{ xs: 6, sm: 3 }}>{field('lawyerPct', t('sale.lawyer', 'Lawyer'), '%')}</Grid>
              <Grid size={{ xs: 6, sm: 3 }}>{field('vatPct', t('sale.vat', 'VAT'), '%')}</Grid>
              <Grid size={{ xs: 6, sm: 3 }}>{field('otherSaleCosts', t('sale.other', 'Other costs'), '₪')}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={draft.singleApartmentExemption ?? effective.singleApartmentExemption ?? true}
                      onChange={(event) => setDraft((previous) => ({ ...previous, singleApartmentExemption: event.target.checked }))}
                    />
                  )}
                  label={t('sale.exemption', 'Single-apartment exemption from capital gains tax')}
                />
              </Grid>
              {(draft.singleApartmentExemption ?? effective.singleApartmentExemption ?? true) ? null : (
                <Grid size={{ xs: 6, sm: 3 }}>{field('capitalGainsTaxPct', t('sale.cgt', 'Capital gains tax'), '%')}</Grid>
              )}
            </Grid>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t('alternative.title', 'Comparison and income')}</Typography>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, sm: 4 }}>{field('alternativeReturnPct', t('alternative.return', 'Return if invested instead'), '%/yr')}</Grid>
              <Grid size={{ xs: 6, sm: 4 }}>{field('alternativeTaxPct', t('alternative.tax', 'Tax on investment gains'), '%')}</Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                {field(
                  'monthlyIncomeOverride',
                  t('alternative.income', 'Net monthly income'),
                  '₪',
                  detectedIncome
                    ? t('alternative.incomeDetected', 'Leave empty to use the detected {{amount}}', { amount: detectedIncome.toLocaleString() })
                    : t('alternative.incomeNone', 'Not detected from transactions'),
                )}
              </Grid>
            </Grid>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t('costs.title', 'Purchase costs and own funds')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {t('costs.hint', 'What you paid from your own pocket. Without a down payment entry, it is assumed to be the purchase price minus the loan.')}
            </Typography>
            <Stack spacing={1}>
              {draftCosts.map((cost, index) => (
                <Grid key={index} container spacing={1} sx={{ alignItems: 'center' }}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={t('costs.type', 'Type')}
                      value={cost.type}
                      onChange={(event) => updateCost(index, { type: event.target.value as PropertyCostType })}
                    >
                      {COST_TYPES.map((type) => <MenuItem key={type} value={type}>{t(`costs.types.${type}`, COST_FALLBACKS[type])}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label={t('costs.amount', 'Amount')}
                      value={cost.amount ?? ''}
                      onChange={(event) => updateCost(index, { amount: parseNumber(event.target.value) })}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="date"
                      label={t('costs.date', 'Date')}
                      value={cost.date || ''}
                      onChange={(event) => updateCost(index, { date: event.target.value || null })}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 10, sm: 1.5 }}>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={t('costs.status', 'Status')}
                      value={cost.status}
                      onChange={(event) => updateCost(index, { status: event.target.value as PropertyCost['status'] })}
                    >
                      <MenuItem value="paid">{t('costs.paid', 'Paid')}</MenuItem>
                      <MenuItem value="planned">{t('costs.planned', 'Planned')}</MenuItem>
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 2, sm: 0.5 }}>
                    <IconButton size="small" onClick={() => setDraftCosts((previous) => previous.filter((_, position) => position !== index))}>
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Grid>
                </Grid>
              ))}
            </Stack>
            <Button
              size="small"
              startIcon={<AddIcon />}
              sx={{ mt: 1 }}
              onClick={() => setDraftCosts((previous) => [...previous, { type: previous.some((cost) => cost.type === 'down_payment') ? 'purchase_tax' : 'down_payment', amount: null, date: null, status: 'paid' }])}
            >
              {t('costs.add', 'Add cost')}
            </Button>
          </Box>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={18} /> : t('save', 'Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PropertyAssumptionsDialog;
