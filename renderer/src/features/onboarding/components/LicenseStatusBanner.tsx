import React from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Typography,
  alpha,
  useTheme,
  Collapse,
} from '@mui/material';
import {
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
  Block as BlockIcon,
  Star as StarIcon,
  WifiOff as WifiOffIcon,
  CheckCircle as CheckCircleIcon,
  PersonAdd as PersonAddIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface LicenseStatusBannerProps {
  status: {
    registered: boolean;
    licenseType: 'trial' | 'pro' | 'expired' | 'none';
    trialDaysRemaining?: number;
    isReadOnly: boolean;
    offlineMode: boolean;
    offlineGraceDaysRemaining?: number | null;
  } | null;
  onUpgradeClick?: () => void;
  compact?: boolean;
}

const TRIAL_DAYS = 30;

const LicenseStatusBanner: React.FC<LicenseStatusBannerProps> = ({
  status,
  onUpgradeClick,
  compact = false,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();

  if (!status) {
    return null;
  }

  const { licenseType, trialDaysRemaining, isReadOnly, offlineMode, offlineGraceDaysRemaining } = status;

  // Determine alert severity and content
  let severity: 'info' | 'warning' | 'error' | 'success' = 'info';
  let icon: React.ReactNode = <ScheduleIcon />;
  let title = '';
  let message = '';
  let showUpgradeButton = true;

  if (licenseType === 'pro') {
    severity = 'success';
    icon = <CheckCircleIcon />;
    title = t('license.proActive', 'Pro License Active');
    message = t('license.proDescription', 'You have full access to all features');
    showUpgradeButton = false;
  } else if (licenseType === 'none') {
    severity = 'info';
    icon = <PersonAddIcon />;
    title = t('license.registrationRequired', 'Registration Required');
    message = t('license.registrationDescription', 'Register to start your 30-day free trial');
  } else if (licenseType === 'expired' || isReadOnly) {
    severity = 'error';
    icon = <BlockIcon />;
    title = t('license.trialExpired');
    message = t('license.readOnlyMode');
  } else if (offlineMode && offlineGraceDaysRemaining !== null && offlineGraceDaysRemaining !== undefined) {
    severity = 'warning';
    icon = <WifiOffIcon />;
    title = t('license.offlineMode');
    message = t('license.offlineGraceRemaining', { days: offlineGraceDaysRemaining });
  } else if (trialDaysRemaining !== undefined && trialDaysRemaining <= 7) {
    severity = 'warning';
    icon = <WarningIcon />;
    title = t('license.trialExpiring');
    message = t('license.daysRemaining', { days: trialDaysRemaining });
  } else if (trialDaysRemaining !== undefined) {
    severity = 'info';
    icon = <ScheduleIcon />;
    title = t('license.trialActive');
    message = t('license.daysRemaining', { days: trialDaysRemaining });
  }

  const progress = trialDaysRemaining !== undefined
    ? ((TRIAL_DAYS - trialDaysRemaining) / TRIAL_DAYS) * 100
    : 0;

  const progressColor =
    severity === 'error'
      ? theme.palette.error.main
      : severity === 'warning'
        ? theme.palette.warning.main
        : severity === 'success'
          ? theme.palette.success.main
          : theme.palette.primary.main;

  if (compact) {
    return (
      <Collapse in={true}>
        <Alert
          severity={severity === 'success' ? 'success' : severity}
          icon={icon}
          action={
            showUpgradeButton ? (
              <Button
                color="inherit"
                size="small"
                onClick={onUpgradeClick}
                startIcon={<StarIcon />}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {t('license.upgradeToPro')}
              </Button>
            ) : undefined
          }
          sx={{
            borderRadius: 0,
            py: 0.5,
            '& .MuiAlert-message': {
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            },
          }}
        >
          <Typography variant="body2" fontWeight={500}>
            {title}
          </Typography>
          <Typography variant="body2" color="inherit" sx={{ opacity: 0.8 }}>
            {message}
          </Typography>
        </Alert>
      </Collapse>
    );
  }

  const getBackgroundColor = () => {
    switch (severity) {
      case 'error': return alpha(theme.palette.error.main, 0.08);
      case 'warning': return alpha(theme.palette.warning.main, 0.08);
      case 'success': return alpha(theme.palette.success.main, 0.08);
      default: return alpha(theme.palette.primary.main, 0.08);
    }
  };

  const getBorderColor = () => {
    switch (severity) {
      case 'error': return alpha(theme.palette.error.main, 0.2);
      case 'warning': return alpha(theme.palette.warning.main, 0.2);
      case 'success': return alpha(theme.palette.success.main, 0.2);
      default: return alpha(theme.palette.primary.main, 0.2);
    }
  };

  const getIconColor = () => {
    switch (severity) {
      case 'error': return theme.palette.error.main;
      case 'warning': return theme.palette.warning.main;
      case 'success': return theme.palette.success.main;
      default: return theme.palette.primary.main;
    }
  };

  return (
    <Collapse in={true}>
      <Box
        sx={{
          p: 2,
          borderRadius: 2,
          backgroundColor: getBackgroundColor(),
          border: `1px solid ${getBorderColor()}`,
          mb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Box
            sx={{
              color: getIconColor(),
              mt: 0.25,
            }}
          >
            {icon}
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {message}
            </Typography>

            {licenseType === 'trial' && trialDaysRemaining !== undefined && (
              <Box sx={{ mb: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('license.trialProgress')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {TRIAL_DAYS - trialDaysRemaining} / {TRIAL_DAYS} {t('license.days')}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={progress}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: alpha(progressColor, 0.2),
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: progressColor,
                      borderRadius: 3,
                    },
                  }}
                />
              </Box>
            )}

            {showUpgradeButton && (
              <Button
                variant={isReadOnly ? 'contained' : 'outlined'}
                size="small"
                onClick={onUpgradeClick}
                startIcon={<StarIcon />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 500,
                }}
              >
                {isReadOnly ? t('license.purchasePro') : t('license.upgradeToPro')}
              </Button>
            )}
          </Box>
        </Box>
      </Box>
    </Collapse>
  );
};

export default LicenseStatusBanner;
