import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import CoffeeIcon from '@mui/icons-material/LocalCafe';
import { useTranslation } from 'react-i18next';
import { DONATION_OPEN_MODAL_EVENT } from '../constants';
import type { DonationStatus } from '../types';

interface DonationReminderDialogProps {
  open: boolean;
  status: DonationStatus | null;
  busy?: boolean;
  onDismissForMonth: () => Promise<void> | void;
}

const DonationReminderDialog: React.FC<DonationReminderDialogProps> = ({
  open,
  busy = false,
  onDismissForMonth,
}) => {
  const { t } = useTranslation('translation');

  const handleDonate = async () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(DONATION_OPEN_MODAL_EVENT));
    }
    await onDismissForMonth();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        onDismissForMonth();
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{t('support.reminder.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {t('support.reminder.message')}
          </Typography>
          <Alert severity="info">
            {t('support.reminder.monthlyHint')}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={() => onDismissForMonth()} disabled={busy}>
          {t('support.reminder.actions.later')}
        </Button>
        <Button variant="contained" onClick={handleDonate} disabled={busy} startIcon={<CoffeeIcon />}>
          {t('support.reminder.actions.donateNow')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DonationReminderDialog;
