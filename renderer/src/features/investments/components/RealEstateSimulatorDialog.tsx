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
  Stack,
  Typography,
} from '@mui/material';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { apiClient } from '@/lib/api-client';
import type { InvestmentAccountSummary } from '@renderer/types/investments';
import RealEstateSimulatorFields, {
  createEmptyRealEstateProfile,
  estimateRealEstatePreview,
  hasRealEstateProfileInput,
  type RealEstateProfileInput,
} from './RealEstateSimulatorFields';
import { useTranslation } from 'react-i18next';

interface RealEstateSimulatorDialogProps {
  open: boolean;
  account: Pick<InvestmentAccountSummary, 'id' | 'account_name' | 'currency' | 'current_value' | 'cost_basis'> | null;
  onClose: () => void;
  onSaved?: () => void;
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return String(value);
}

function profileToInput(profile: any, account: RealEstateSimulatorDialogProps['account']): RealEstateProfileInput {
  if (!profile) {
    return {
      ...createEmptyRealEstateProfile(),
      purchase_price: account?.cost_basis ? String(account.cost_basis) : '',
      manual_estimated_value: account?.current_value ? String(account.current_value) : '',
    };
  }

  return {
    city: profile.city || '',
    neighborhood: profile.neighborhood || '',
    property_type: profile.property_type || 'apartment',
    rooms: toInputValue(profile.rooms),
    square_meters: toInputValue(profile.square_meters),
    floor: toInputValue(profile.floor),
    total_floors: toInputValue(profile.total_floors),
    has_elevator: Boolean(profile.has_elevator),
    has_parking: Boolean(profile.has_parking),
    has_balcony: Boolean(profile.has_balcony),
    has_storage: Boolean(profile.has_storage),
    ownership_percentage: toInputValue(profile.ownership_percentage || 100),
    purchase_price: toInputValue(profile.purchase_price),
    purchase_date: profile.purchase_date || '',
    mortgage_balance: toInputValue(profile.mortgage_balance),
    monthly_mortgage_payment: toInputValue(profile.monthly_mortgage_payment),
    mortgage_interest_rate: toInputValue(profile.mortgage_interest_rate),
    mortgage_term_years: toInputValue(profile.mortgage_term_years),
    monthly_rent: toInputValue(profile.monthly_rent),
    annual_expenses: toInputValue(profile.annual_expenses),
    price_per_sqm: toInputValue(profile.price_per_sqm),
    annual_growth_rate: toInputValue(profile.annual_growth_rate || 3),
    rental_yield_rate: toInputValue(profile.rental_yield_rate || 3.2),
    manual_estimated_value: toInputValue(profile.manual_estimated_value),
    valuation_method: profile.valuation_method || 'blended',
  };
}

export default function RealEstateSimulatorDialog({
  open,
  account,
  onClose,
  onSaved,
}: RealEstateSimulatorDialogProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstate' });
  const { showNotification } = useNotification();
  const accountId = account?.id ?? null;
  const accountDefaultsRef = React.useRef<RealEstateSimulatorDialogProps['account']>(account);
  const [profile, setProfile] = React.useState<RealEstateProfileInput>(() => createEmptyRealEstateProfile());
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isDirty, setIsDirty] = React.useState(false);

  React.useEffect(() => {
    accountDefaultsRef.current = account;
  }, [account]);

  React.useEffect(() => {
    if (!open || !accountId) {
      return;
    }

    let active = true;
    const accountForDefaults = accountDefaultsRef.current;
    setLoading(true);
    setError(null);
    setIsDirty(false);

    apiClient.get(`/api/investments/real-estate/profiles/${accountId}`)
      .then((response) => {
        if (!active) return;
        if (!response.ok) {
          throw new Error(response.statusText || t('errors.loadFailed', 'Failed to load real estate profile'));
        }
        const data = response.data as any;
        setProfile(profileToInput(data?.profile, accountForDefaults));
        setIsDirty(false);
      })
      .catch((loadError) => {
        if (!active) return;
        console.error('Failed to load real estate simulator profile:', loadError);
        setError(loadError instanceof Error
          ? loadError.message
          : t('errors.loadFailed', 'Failed to load real estate profile'));
        setProfile(profileToInput(null, accountForDefaults));
        setIsDirty(false);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accountId, open, t]);

  const saveProfile = React.useCallback(async () => {
    if (!accountId) {
      throw new Error(t('errors.missingAccount', 'Missing real estate account'));
    }
    if (!hasRealEstateProfileInput(profile)) {
      throw new Error(t('errors.emptyProfile', 'Enter at least one property or valuation field'));
    }

    const response = await apiClient.put(
      `/api/investments/real-estate/profiles/${accountId}`,
      profile,
    );

    if (!response.ok) {
      const message = (response.data as any)?.error
        || response.statusText
        || t('errors.saveFailed', 'Failed to save real estate profile');
      throw new Error(message);
    }

    return response.data;
  }, [accountId, profile, t]);

  const handleProfileChange = React.useCallback((nextProfile: RealEstateProfileInput) => {
    setIsDirty(true);
    setProfile(nextProfile);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveProfile();
      setIsDirty(false);
      showNotification(t('notifications.saved', 'Real estate simulator saved'), 'success');
      onSaved?.();
      window.dispatchEvent(new CustomEvent('dataRefresh'));
      onClose();
    } catch (saveError) {
      console.error('Failed to save real estate simulator:', saveError);
      setError(saveError instanceof Error
        ? saveError.message
        : t('errors.saveFailed', 'Failed to save real estate simulator'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndApply = async () => {
    if (!accountId) {
      return;
    }

    setApplying(true);
    setError(null);
    try {
      await saveProfile();
      const response = await apiClient.post(
        `/api/investments/real-estate/profiles/${accountId}/apply-valuation`,
        { asOfDate: new Date().toISOString().split('T')[0] },
      );
      if (!response.ok) {
        const message = (response.data as any)?.error
          || response.statusText
          || t('errors.applyFailed', 'Failed to apply valuation');
        throw new Error(message);
      }
      setIsDirty(false);
      showNotification(t('notifications.applied', 'Real estate valuation applied'), 'success');
      onSaved?.();
      window.dispatchEvent(new CustomEvent('dataRefresh'));
      onClose();
    } catch (applyError) {
      console.error('Failed to apply real estate valuation:', applyError);
      setError(applyError instanceof Error
        ? applyError.message
        : t('errors.applyFailed', 'Failed to apply valuation'));
    } finally {
      setApplying(false);
    }
  };

  const busy = loading || saving || applying;
  const hasInput = hasRealEstateProfileInput(profile);
  const previewEstimate = React.useMemo(() => estimateRealEstatePreview(profile), [profile]);
  const canApplyValuation = hasInput && previewEstimate.estimated_value !== null;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="span">
            {t('title', 'Real estate simulator')}
          </Typography>
          {account && (
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {account.account_name}{isDirty ? t('unsavedSuffix', ' - unsaved changes') : ''}
            </Typography>
          )}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <RealEstateSimulatorFields
            value={profile}
            currency={account?.currency || 'ILS'}
            onChange={handleProfileChange}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {t('actions.cancel', 'Cancel')}
        </Button>
        <Button onClick={handleSave} disabled={busy || loading || !hasInput}>
          {t('actions.save', 'Save')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSaveAndApply}
          disabled={busy || loading || !canApplyValuation}
          startIcon={applying ? <CircularProgress size={18} /> : undefined}
        >
          {t('actions.saveApply', 'Save & Apply Valuation')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
