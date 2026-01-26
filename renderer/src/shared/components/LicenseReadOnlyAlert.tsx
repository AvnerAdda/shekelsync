import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert,
} from '@mui/material';
import {
  Block as BlockIcon,
  Star as StarIcon,
  Wifi as WifiIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface LicenseReadOnlyAlertProps {
  open: boolean;
  onClose: () => void;
  reason?: 'trial_expired' | 'offline_grace_expired' | 'not_registered' | string;
  onUpgrade?: () => void;
}

/**
 * Alert dialog shown when a write operation fails due to license being in read-only mode.
 */
const LicenseReadOnlyAlert: React.FC<LicenseReadOnlyAlertProps> = ({
  open,
  onClose,
  reason,
  onUpgrade,
}) => {
  const { t } = useTranslation();

  const getReasonInfo = () => {
    switch (reason) {
      case 'trial_expired':
      case 'Trial period expired':
        return {
          icon: <BlockIcon sx={{ fontSize: 48 }} />,
          title: t('license.trialExpired'),
          message: t('licenseAlert.trialExpiredMessage'),
          showUpgrade: true,
        };
      case 'offline_grace_expired':
      case 'Offline grace period expired':
        return {
          icon: <WifiIcon sx={{ fontSize: 48 }} />,
          title: t('license.offlineMode'),
          message: t('licenseAlert.offlineGraceExpiredMessage'),
          showUpgrade: false,
        };
      case 'not_registered':
      case 'No license registered':
        return {
          icon: <BlockIcon sx={{ fontSize: 48 }} />,
          title: t('licenseAlert.notRegisteredTitle'),
          message: t('licenseAlert.notRegisteredMessage'),
          showUpgrade: false,
        };
      default:
        return {
          icon: <BlockIcon sx={{ fontSize: 48 }} />,
          title: t('licenseAlert.readOnlyTitle'),
          message: t('license.readOnlyMode'),
          showUpgrade: true,
        };
    }
  };

  const { icon, title, message, showUpgrade } = getReasonInfo();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ color: 'error.main' }}>{icon}</Box>
          <Typography variant="h6" component="span">
            {title}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('licenseAlert.operationBlocked')}
        </Alert>
        <Typography variant="body1" color="text.secondary">
          {message}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          {t('common.close')}
        </Button>
        {showUpgrade && onUpgrade && (
          <Button
            onClick={() => {
              onUpgrade();
              onClose();
            }}
            variant="contained"
            color="primary"
            startIcon={<StarIcon />}
          >
            {t('license.upgradeToPro')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

/**
 * Check if an API response indicates a license read-only error.
 */
export function isLicenseReadOnlyError(responseData: unknown): { isReadOnly: boolean; reason?: string } {
  if (!responseData || typeof responseData !== 'object') {
    return { isReadOnly: false };
  }

  const data = responseData as Record<string, unknown>;

  // Check for LICENSE_READ_ONLY error code from the backend
  if (data.code === 'LICENSE_READ_ONLY') {
    return {
      isReadOnly: true,
      reason: (data.reason as string) || undefined,
    };
  }

  // Check for the error message pattern
  if (
    data.error === 'License is in read-only mode' ||
    (typeof data.message === 'string' && data.message.includes('read-only mode'))
  ) {
    return {
      isReadOnly: true,
      reason: (data.reason as string) || undefined,
    };
  }

  return { isReadOnly: false };
}

export default LicenseReadOnlyAlert;
