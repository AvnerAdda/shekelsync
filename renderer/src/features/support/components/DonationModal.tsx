import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import {
  CheckCircle as VerifiedIcon,
  Close as CloseIcon,
  HourglassTop as PendingIcon,
  LocalCafe as CoffeeIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useDonationStatus } from '../hooks/useDonationStatus';
import type { DonationStatus } from '../types';
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
      return 'info';
  }
}

function getStatusIcon(status: DonationStatus['supportStatus']) {
  if (status === 'verified') return <VerifiedIcon fontSize="small" />;
  if (status === 'pending') return <PendingIcon fontSize="small" />;
  return <CoffeeIcon fontSize="small" />;
}

const DonationModal: React.FC<DonationModalProps> = ({ open, onClose, onDonationRecorded }) => {
  const { t } = useTranslation('translation');
  const { status, loading, error, createSupportIntent } = useDonationStatus();

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleDonate = async () => {
    setActionError(null);
    setActionSuccess(null);
    setSubmitting(true);

    try {
      const nextStatus = await createSupportIntent({
        source: 'support_modal',
      });

      setActionSuccess(
        t('support.program.intentSaved', {
          defaultValue: 'Buy Me a Coffee opened. We will grant access automatically after payment sync.',
        }),
      );

      openDonationUrl(nextStatus.donationUrl);
      onDonationRecorded?.(nextStatus);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('support.program.intentFailed', { defaultValue: 'Failed to open donation flow.' }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { borderRadius: 3, backgroundImage: 'none' } }}
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CoffeeIcon color="primary" />
            <Typography variant="h6" component="span" fontWeight={700}>
              {t('support.program.title', { defaultValue: 'Support ShekelSync' })}
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
              <Alert severity={getStatusColor(status.supportStatus)} icon={getStatusIcon(status.supportStatus)}>
                {t(`support.status.${status.supportStatus}`, {
                  defaultValue: status.supportStatus,
                })}
              </Alert>
            )}

            <Alert severity="info">
              {t('support.program.validationHint', {
                defaultValue: 'Any paid donation unlocks access automatically after sync.',
              })}
            </Alert>

            <Button
              variant="contained"
              startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : <CoffeeIcon />}
              onClick={handleDonate}
              disabled={submitting}
            >
              {t('support.program.chooseButton', { defaultValue: 'Open Buy Me a Coffee' })}
            </Button>

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
