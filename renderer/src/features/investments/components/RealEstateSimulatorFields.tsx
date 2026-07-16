import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import CalculateIcon from '@mui/icons-material/Calculate';
import { useTranslation } from 'react-i18next';

export interface RealEstateProfileInput {
  city?: string;
  neighborhood?: string;
  property_type?: string;
  rooms?: string;
  square_meters?: string;
  floor?: string;
  total_floors?: string;
  has_elevator?: boolean;
  has_parking?: boolean;
  has_balcony?: boolean;
  has_storage?: boolean;
  ownership_percentage?: string;
  purchase_price?: string;
  purchase_date?: string;
  mortgage_balance?: string;
  monthly_mortgage_payment?: string;
  mortgage_interest_rate?: string;
  mortgage_term_years?: string;
  monthly_rent?: string;
  annual_expenses?: string;
  price_per_sqm?: string;
  annual_growth_rate?: string;
  rental_yield_rate?: string;
  manual_estimated_value?: string;
  valuation_method?: string;
}

interface EstimateSource {
  method: string;
  grossValue: number;
  ownedValue: number;
}

export interface RealEstateEstimatePreview {
  valuation_method: string;
  confidence: 'manual' | 'high' | 'medium' | 'low';
  estimated_value: number | null;
  estimated_net_equity: number | null;
  scenario_conservative: number | null;
  scenario_base: number | null;
  scenario_optimistic: number | null;
  sources: EstimateSource[];
}

interface RealEstateSimulatorFieldsProps {
  value: RealEstateProfileInput;
  currency?: string;
  onChange: (value: RealEstateProfileInput) => void;
  onApplyEstimate?: (estimate: RealEstateEstimatePreview) => void;
}

const PROPERTY_TYPES = [
  { value: 'apartment', labelKey: 'propertyTypes.apartment', fallback: 'Apartment' },
  { value: 'house', labelKey: 'propertyTypes.house', fallback: 'House' },
  { value: 'land', labelKey: 'propertyTypes.land', fallback: 'Land' },
  { value: 'commercial', labelKey: 'propertyTypes.commercial', fallback: 'Commercial' },
  { value: 'other', labelKey: 'propertyTypes.other', fallback: 'Other' },
];

const VALUATION_METHODS = [
  { value: 'blended', labelKey: 'valuationMethods.blended', fallback: 'Blended' },
  { value: 'manual', labelKey: 'valuationMethods.manual', fallback: 'Manual value' },
  { value: 'purchase_growth', labelKey: 'valuationMethods.purchaseGrowth', fallback: 'Purchase growth' },
  { value: 'purchase_price', labelKey: 'valuationMethods.purchasePrice', fallback: 'Purchase price' },
  { value: 'rent_yield', labelKey: 'valuationMethods.rentYield', fallback: 'Rental yield' },
  { value: 'price_per_sqm', labelKey: 'valuationMethods.pricePerSqm', fallback: 'Price per sqm' },
];

const FEATURE_FIELDS = [
  { field: 'has_elevator', labelKey: 'features.elevator', fallback: 'Elevator' },
  { field: 'has_parking', labelKey: 'features.parking', fallback: 'Parking' },
  { field: 'has_balcony', labelKey: 'features.balcony', fallback: 'Balcony' },
  { field: 'has_storage', labelKey: 'features.storage', fallback: 'Storage' },
] as const;

export const createEmptyRealEstateProfile = (): RealEstateProfileInput => ({
  property_type: 'apartment',
  ownership_percentage: '100',
  annual_growth_rate: '3',
  rental_yield_rate: '3.2',
  valuation_method: 'blended',
});

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  return String(value).split('T')[0] || null;
}

function yearsBetween(startDate: string | null, endDate = new Date()): number | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  const diffMs = endDate.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return diffMs / (365.25 * 24 * 60 * 60 * 1000);
}

function roundMoney(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function buildSource(
  method: string,
  grossValue: number | null,
  ownershipPercentage: number,
): EstimateSource | null {
  if (grossValue === null || !Number.isFinite(grossValue) || grossValue <= 0) {
    return null;
  }

  return {
    method,
    grossValue: Math.round(grossValue),
    ownedValue: Math.round(grossValue * (ownershipPercentage / 100)),
  };
}

export function estimateRealEstatePreview(profile: RealEstateProfileInput): RealEstateEstimatePreview {
  const ownershipPercentage = Math.min(Math.max(toNumber(profile.ownership_percentage) ?? 100, 0), 100) || 100;
  const valuationMethod = profile.valuation_method || 'blended';
  const purchasePrice = toNumber(profile.purchase_price);
  const manualValue = toNumber(profile.manual_estimated_value);
  const purchaseDate = normalizeDate(profile.purchase_date);
  const annualGrowthRate = toNumber(profile.annual_growth_rate) ?? 3;
  const monthlyRent = toNumber(profile.monthly_rent);
  const annualExpenses = toNumber(profile.annual_expenses) ?? 0;
  const rentalYieldRate = toNumber(profile.rental_yield_rate) ?? 3.2;
  const sqm = toNumber(profile.square_meters);
  const pricePerSqm = toNumber(profile.price_per_sqm);
  const mortgageBalance = (toNumber(profile.mortgage_balance) ?? 0) * (ownershipPercentage / 100);
  const sources: EstimateSource[] = [];
  const addSource = (source: EstimateSource | null) => {
    if (source) {
      sources.push(source);
    }
  };

  const manualGross = manualValue === null ? null : manualValue / (ownershipPercentage / 100);
  addSource(buildSource('manual', manualGross, ownershipPercentage));

  const holdingYears = yearsBetween(purchaseDate);
  if (purchasePrice !== null && holdingYears !== null) {
    addSource(buildSource(
      'purchase_growth',
      purchasePrice * Math.pow(1 + annualGrowthRate / 100, holdingYears),
      ownershipPercentage,
    ));
  } else if (purchasePrice !== null) {
    addSource(buildSource('purchase_price', purchasePrice, ownershipPercentage));
  }

  if (monthlyRent !== null && rentalYieldRate > 0) {
    const annualNetRent = Math.max(monthlyRent * 12 - annualExpenses, 0);
    addSource(buildSource('rent_yield', annualNetRent / (rentalYieldRate / 100), ownershipPercentage));
  }

  if (sqm !== null && pricePerSqm !== null) {
    addSource(buildSource('price_per_sqm', sqm * pricePerSqm, ownershipPercentage));
  }

  const validSources = sources.filter(Boolean);
  const selected = valuationMethod === 'blended'
    ? null
    : validSources.find((source) => source.method === valuationMethod) || null;
  const estimatedValue = selected
    ? selected.ownedValue
    : validSources.length > 0
      ? roundMoney(validSources.reduce((sum, source) => sum + source.ownedValue, 0) / validSources.length)
      : null;
  const method = selected
    ? selected.method
    : validSources.length === 1
      ? validSources[0].method
      : valuationMethod;
  const confidence: RealEstateEstimatePreview['confidence'] =
    method === 'manual'
      ? 'manual'
      : validSources.length >= 3 && profile.city && profile.square_meters
        ? 'high'
        : validSources.length >= 2
          ? 'medium'
          : 'low';

  return {
    valuation_method: method,
    confidence,
    estimated_value: estimatedValue,
    estimated_net_equity: estimatedValue === null ? null : roundMoney(estimatedValue - mortgageBalance),
    scenario_conservative: estimatedValue === null ? null : roundMoney(estimatedValue * 0.92),
    scenario_base: estimatedValue,
    scenario_optimistic: estimatedValue === null ? null : roundMoney(estimatedValue * 1.08),
    sources: validSources,
  };
}

export function hasRealEstateProfileInput(profile: RealEstateProfileInput): boolean {
  return [
    profile.city,
    profile.neighborhood,
    profile.rooms,
    profile.square_meters,
    profile.purchase_price,
    profile.purchase_date,
    profile.monthly_rent,
    profile.manual_estimated_value,
    profile.price_per_sqm,
    profile.mortgage_balance,
    profile.monthly_mortgage_payment,
    profile.mortgage_interest_rate,
    profile.mortgage_term_years,
  ].some((value) => String(value || '').trim().length > 0);
}

function formatCurrency(value: number | null, currency = 'ILS'): string {
  if (value === null) return '-';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

function getCurrencySymbol(currency = 'ILS'): string {
  try {
    const part = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    }).formatToParts(0).find((item) => item.type === 'currency');
    return part?.value || currency;
  } catch {
    return currency;
  }
}

export default function RealEstateSimulatorFields({
  value,
  currency = 'ILS',
  onChange,
  onApplyEstimate,
}: RealEstateSimulatorFieldsProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstate' });
  const estimate = React.useMemo(() => estimateRealEstatePreview(value), [value]);
  const currencySymbol = getCurrencySymbol(currency);

  const updateField = (field: keyof RealEstateProfileInput, nextValue: string | boolean) => {
    onChange({
      ...value,
      [field]: nextValue,
    });
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Stack direction="row" spacing={1} sx={{
        alignItems: "center"
      }}>
        <HomeWorkIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{
          fontWeight: 700
        }}>
          {t('title', 'Real estate simulator')}
        </Typography>
        <Chip
          size="small"
          label={t(`confidence.${estimate.confidence}`, estimate.confidence)}
          variant="outlined"
        />
      </Stack>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            size="small"
            label={t('fields.city', 'City')}
            value={value.city || ''}
            onChange={(event) => updateField('city', event.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            size="small"
            label={t('fields.neighborhood', 'Neighborhood')}
            value={value.neighborhood || ''}
            onChange={(event) => updateField('neighborhood', event.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            select
            size="small"
            label={t('fields.propertyType', 'Property type')}
            value={value.property_type || 'apartment'}
            onChange={(event) => updateField('property_type', event.target.value)}
          >
            {PROPERTY_TYPES.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {t(option.labelKey, option.fallback)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.rooms', 'Rooms')}
            value={value.rooms || ''}
            onChange={(event) => updateField('rooms', event.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.squareMeters', 'Sqm')}
            value={value.square_meters || ''}
            onChange={(event) => updateField('square_meters', event.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.floor', 'Floor')}
            value={value.floor || ''}
            onChange={(event) => updateField('floor', event.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.totalFloors', 'Floors')}
            value={value.total_floors || ''}
            onChange={(event) => updateField('total_floors', event.target.value)}
          />
        </Grid>
      </Grid>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{
        flexWrap: "wrap"
      }}>
        {FEATURE_FIELDS.map(({ field, labelKey, fallback }) => (
          <FormControlLabel
            key={field}
            control={(
              <Checkbox
                size="small"
                checked={Boolean(value[field as keyof RealEstateProfileInput])}
                onChange={(event) => updateField(field as keyof RealEstateProfileInput, event.target.checked)}
              />
            )}
            label={t(labelKey, fallback)}
          />
        ))}
      </Stack>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.purchasePrice', 'Purchase price')}
            value={value.purchase_price || ''}
            onChange={(event) => updateField('purchase_price', event.target.value)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="date"
            label={t('fields.purchaseDate', 'Purchase date')}
            value={value.purchase_date || ''}
            onChange={(event) => updateField('purchase_date', event.target.value)}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.ownership', 'Ownership')}
            value={value.ownership_percentage || '100'}
            onChange={(event) => updateField('ownership_percentage', event.target.value)}
            helperText={t('helpers.ownership', 'Legal ownership share, not down payment. Use 100% if you own the property.')}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.manualValue', 'Manual value')}
            value={value.manual_estimated_value || ''}
            onChange={(event) => updateField('manual_estimated_value', event.target.value)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.monthlyMortgagePayment', 'Monthly mortgage payment')}
            value={value.monthly_mortgage_payment || ''}
            onChange={(event) => updateField('monthly_mortgage_payment', event.target.value)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.mortgageInterestRate', 'Mortgage rate')}
            value={value.mortgage_interest_rate || ''}
            onChange={(event) => updateField('mortgage_interest_rate', event.target.value)}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.mortgageTermYears', 'Mortgage term')}
            value={value.mortgage_term_years || ''}
            onChange={(event) => updateField('mortgage_term_years', event.target.value)}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">{t('units.years', 'yrs')}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.mortgageBalance', 'Mortgage balance (total)')}
            value={value.mortgage_balance || ''}
            onChange={(event) => updateField('mortgage_balance', event.target.value)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            select
            size="small"
            label={t('fields.valuationMethod', 'Valuation method')}
            value={value.valuation_method || 'blended'}
            onChange={(event) => updateField('valuation_method', event.target.value)}
          >
            {VALUATION_METHODS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {t(option.labelKey, option.fallback)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.rent', 'Rent')}
            value={value.monthly_rent || ''}
            onChange={(event) => updateField('monthly_rent', event.target.value)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.yearlyExpenses', 'Yearly expenses')}
            value={value.annual_expenses || ''}
            onChange={(event) => updateField('annual_expenses', event.target.value)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.pricePerSqm', 'Price / sqm')}
            value={value.price_per_sqm || ''}
            onChange={(event) => updateField('price_per_sqm', event.target.value)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('fields.growth', 'Growth')}
            value={value.annual_growth_rate || '3'}
            onChange={(event) => updateField('annual_growth_rate', event.target.value)}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }
            }}
          />
        </Grid>
      </Grid>
      <Alert
        severity={estimate.estimated_value ? 'info' : 'warning'}
        icon={<CalculateIcon fontSize="inherit" />}
        action={estimate.estimated_value && onApplyEstimate ? (
          <Button size="small" onClick={() => onApplyEstimate(estimate)}>
            {t('actions.useEquity', 'Use equity')}
          </Button>
        ) : undefined}
      >
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={1} useFlexGap sx={{
            flexWrap: "wrap"
          }}>
            <Chip
              size="small"
              label={t('scenarios.conservative', {
                value: formatCurrency(estimate.scenario_conservative, currency),
                defaultValue: 'Conservative {{value}}',
              })}
            />
            <Chip
              size="small"
              color="primary"
              label={t('scenarios.base', {
                value: formatCurrency(estimate.scenario_base, currency),
                defaultValue: 'Base {{value}}',
              })}
            />
            <Chip
              size="small"
              label={t('scenarios.optimistic', {
                value: formatCurrency(estimate.scenario_optimistic, currency),
                defaultValue: 'Optimistic {{value}}',
              })}
            />
          </Stack>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {t('netEquity', {
              value: formatCurrency(estimate.estimated_net_equity, currency),
              defaultValue: 'Net equity: {{value}}',
            })}
          </Typography>
        </Stack>
      </Alert>
    </Box>
  );
}
