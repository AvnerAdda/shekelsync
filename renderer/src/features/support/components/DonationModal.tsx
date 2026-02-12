import { useMemo, useState } from 'react';
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
  Divider,
  IconButton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import {
  CheckCircle as VerifiedIcon,
  Close as CloseIcon,
  HourglassTop as PendingIcon,
  LocalCafe as CoffeeIcon,
  WorkspacePremium as TierIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useDonationStatus } from '../hooks/useDonationStatus';
import type { DonationStatus, SupportPlan, SupportPlanKey } from '../types';
import { openDonationUrl } from '../utils/openDonationUrl';

interface DonationModalProps {
  open: boolean;
  onClose: () => void;
  onDonationRecorded?: (status: DonationStatus) => void;
}

function getStatusColor(status: DonationStatus['supportStatus']) {
  switch (status) {
    case 'verified':
      return 'success';
    case 'pending':
      return 'info';
    case 'rejected':
      return 'warning';
    default:
      return 'default';
  }
}

function getStatusIcon(status: DonationStatus['supportStatus']) {
  if (status === 'verified') return <VerifiedIcon fontSize="small" />;
  if (status === 'pending') return <PendingIcon fontSize="small" />;
  return <TierIcon fontSize="small" />;
}

const DonationModal: React.FC<DonationModalProps> = ({ open, onClose, onDonationRecorded }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation');
  const { status, loading, error, createSupportIntent } = useDonationStatus();

  const [submittingPlan, setSubmittingPlan] = useState<SupportPlanKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const plans = status?.plans || [];

  const currentPlan = useMemo(
    () => plans.find((plan) => plan.key === status?.currentPlanKey) || null,
    [plans, status?.currentPlanKey],
  );

  const handleChoosePlan = async (plan: SupportPlan) => {
    setActionError(null);
    setActionSuccess(null);
    setSubmittingPlan(plan.key);

    try {
      const nextStatus = await createSupportIntent({
        planKey: plan.key,
        source: 'support_modal',
      });

      setActionSuccess(
        t('support.program.intentSaved', {
          defaultValue: 'Plan selection recorded. We opened Buy Me a Coffee. Access updates after validation.',
        }),
      );

      openDonationUrl(nextStatus.donationUrl);
      onDonationRecorded?.(nextStatus);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('support.program.intentFailed', { defaultValue: 'Failed to record plan selection.' }),
      );
    } finally {
      setSubmittingPlan(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: { borderRadius: 3, backgroundImage: 'none' } }}
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CoffeeIcon color="primary" />
            <Typography variant="h6" component="span" fontWeight={700}>
              {t('support.program.title', { defaultValue: 'Buy Me a Coffee Support Program' })}
            </Typography>
          </Box>
          <IconButton aria-label={t('common.close')} onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <Stack spacing={2}>
            {error && <Alert severity="warning">{error}</Alert>}

            {status && (
              <Alert severity={status.supportStatus === 'verified' ? 'success' : status.supportStatus === 'pending' ? 'info' : status.supportStatus === 'rejected' ? 'warning' : 'info'}>
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                  <Chip
                    icon={getStatusIcon(status.supportStatus)}
                    color={getStatusColor(status.supportStatus) as any}
                    label={t(`support.status.${status.supportStatus}`, {
                      defaultValue: status.supportStatus,
                    })}
                    size="small"
                    variant="outlined"
                  />
                  {status.tier !== 'none' && (
                    <Chip
                      size="small"
                      label={t(`support.tiers.${status.tier}`, { defaultValue: status.tier })}
                      variant="outlined"
                    />
                  )}
                  {currentPlan && (
                    <Typography variant="body2" color="text.secondary">
                      {t('support.program.currentPlan', {
                        defaultValue: 'Current plan: {{plan}}',
                        plan: currentPlan.title,
                      })}
                    </Typography>
                  )}
                </Stack>
              </Alert>
            )}

            <Alert severity="info">
              {t('support.program.validationHint', {
                defaultValue: 'Support access is applied after payment validation in Supabase.',
              })}
            </Alert>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  md: 'repeat(2, minmax(0, 1fr))',
                },
                gap: 1.5,
              }}
            >
              {plans.map((plan) => {
                const isCurrent = status?.currentPlanKey === plan.key && status?.supportStatus === 'verified';
                const isPending = status?.pendingPlanKey === plan.key && status?.supportStatus === 'pending';
                const isSubmitting = submittingPlan === plan.key;

                return (
                  <Box
                    key={plan.key}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: isCurrent
                        ? theme.palette.mode === 'dark'
                          ? 'rgba(76, 175, 80, 0.12)'
                          : 'rgba(76, 175, 80, 0.08)'
                        : theme.palette.background.paper,
                    }}
                  >
                    <Stack spacing={1.1}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                        <Typography variant="subtitle1" fontWeight={700}>
                          {plan.title}
                        </Typography>
                        <Chip size="small" label={plan.priceLabel} variant="outlined" />
                      </Stack>

                      {plan.trialLabel && (
                        <Typography variant="caption" color="text.secondary">
                          {plan.trialLabel}
                        </Typography>
                      )}

                      <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
                        {plan.rewards.map((reward) => (
                          <Typography component="li" key={`${plan.key}-${reward}`} variant="body2" color="text.secondary">
                            {reward}
                          </Typography>
                        ))}
                      </Stack>

                      <Button
                        variant={isCurrent ? 'outlined' : 'contained'}
                        startIcon={isSubmitting ? <CircularProgress size={14} color="inherit" /> : <CoffeeIcon />}
                        onClick={() => handleChoosePlan(plan)}
                        disabled={isSubmitting || isCurrent}
                      >
                        {isCurrent
                          ? t('support.program.currentButton', { defaultValue: 'Current Plan' })
                          : isPending
                            ? t('support.program.pendingButton', { defaultValue: 'Pending Validation' })
                            : t('support.program.chooseButton', { defaultValue: 'Choose on Buy Me a Coffee' })}
                      </Button>
                    </Stack>
                  </Box>
                );
              })}
            </Box>

            {actionError && <Alert severity="error">{actionError}</Alert>}
            {actionSuccess && <Alert severity="success">{actionSuccess}</Alert>}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>{t('support.program.actions.close', { defaultValue: 'Close' })}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DonationModal;
