import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useUsageAnalyticsSettings } from '../hooks/useUsageAnalyticsSettings';
import UsageAnalyticsDetails from './UsageAnalyticsDetails';

const PROMPT_DELAY_MS = 8000;

interface UsageAnalyticsConsentDialogProps {
  /** Hold the prompt while another dialog (e.g. the donation reminder) is open. */
  suppressed?: boolean;
}

const UsageAnalyticsConsentDialog: React.FC<UsageAnalyticsConsentDialogProps> = ({ suppressed = false }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'usageAnalytics' });
  const { t: tCommon } = useTranslation('translation', { keyPrefix: 'common' });
  const { loading, available, decided, saving, error, setEnabled } = useUsageAnalyticsSettings();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), PROMPT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const open = ready && !loading && available && !decided && !suppressed && !dismissed;
  const dismiss = () => setDismissed(true);

  return (
    <Dialog open={open} onClose={dismiss} maxWidth="sm" fullWidth aria-labelledby="usage-analytics-consent-title">
      <DialogTitle id="usage-analytics-consent-title" sx={{ pr: 6 }}>{t('consent.title')}</DialogTitle>
      <IconButton aria-label={tCommon('close')} onClick={dismiss} sx={{ position: 'absolute', top: 8, right: 8 }}>
        <CloseIcon />
      </IconButton>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t('consent.message')}
          </Typography>
          <UsageAnalyticsDetails />
          <Typography variant="caption" color="text.secondary">
            {t('consent.changeLater')}
          </Typography>
          {error && <Alert severity="error">{t('panel.saveFailed')}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={() => void setEnabled(false)} disabled={saving}>
          {t('consent.decline')}
        </Button>
        <Button variant="contained" onClick={() => void setEnabled(true)} disabled={saving}>
          {t('consent.accept')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UsageAnalyticsConsentDialog;
