import React from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import type { InvestmentPosition } from '@renderer/types/investments';

interface PositionCloseDialogProps {
  position: InvestmentPosition | null;
  onClose: () => void;
  onClosed: () => void | Promise<void>;
}

const PositionCloseDialog: React.FC<PositionCloseDialogProps> = ({
  position,
  onClose,
  onClosed,
}) => {
  const { t } = useTranslation('translation');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setError(null), [position?.id]);
  const closeFailedMessage = t(
    'investmentsPage.holdings.closeDialog.errors.closeFailed',
    'Failed to close holding',
  );

  const closePosition = async () => {
    if (!position) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.delete(
        `/api/investments/positions?id=${encodeURIComponent(String(position.id))}`,
      );
      if (!response.ok) {
        const body = response.data as { error?: string } | undefined;
        throw new Error(body?.error || response.statusText || closeFailedMessage);
      }
      await onClosed();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : closeFailedMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(position)} onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle>{t('investmentsPage.holdings.closeDialog.title', 'Close holding?')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        <DialogContentText>
          {t(
            'investmentsPage.holdings.closeDialog.message',
            'This stops tracking {{name}} as an open item. Existing activity and account valuation snapshots are kept.',
            { name: position?.position_name || '' },
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
        <Button color="error" variant="contained" onClick={() => void closePosition()} disabled={saving || !position}>
          {t('investmentsPage.holdings.actions.close', 'Close holding')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PositionCloseDialog;
