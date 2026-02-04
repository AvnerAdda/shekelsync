import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Box,
  Typography,
  Divider,
  Paper,
  Button,
  TextField,
  LinearProgress,
  CircularProgress,
  alpha,
  useTheme,
  Alert,
} from '@mui/material';
import {
  Close as CloseIcon,
  Star as StarIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
  Block as BlockIcon,
  PersonAdd as PersonAddIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useLicense } from '../hooks/useLicense';

interface LicenseDetailsModalProps {
  open: boolean;
  onClose: () => void;
}

const TRIAL_DAYS = 30;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const LicenseDetailsModal: React.FC<LicenseDetailsModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    status,
    loading,
    refetch,
    register,
    validateEmail,
    activatePro,
    isRegistered,
    isReadOnly,
  } = useLicense();

  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  const handleEmailChange = async (value: string) => {
    const cleanValue = value.trimStart();
    setEmail(cleanValue);
    setValidationError(null);
    setRegistrationError(null);

    const normalized = cleanValue.trim();
    if (normalized.length >= 5 && normalized.includes('@')) {
      setIsValidating(true);
      const result = await validateEmail(normalized);
      setIsValidating(false);
      if (!result.valid) {
        setValidationError(result.error || t('registration.invalidEmail'));
      }
    }
  };

  const handleRegister = async () => {
    const normalized = email.trim();
    if (!EMAIL_REGEX.test(normalized.toLowerCase())) {
      setValidationError(t('registration.invalidEmail'));
      return;
    }

    setIsRegistering(true);
    setRegistrationError(null);

    const result = await register(normalized);

    setIsRegistering(false);

    if (result.success) {
      setRegistrationSuccess(true);
      setEmail('');
    } else {
      setRegistrationError(result.error || 'Registration failed');
    }
  };

  const handleUpgrade = async () => {
    // For now, just show a message. In production, this would open a payment flow.
    const result = await activatePro();
    if (!result.success) {
      console.error('Activation failed:', result.error);
    }
  };

  const getStatusInfo = () => {
    if (!status) return { icon: <ScheduleIcon />, color: theme.palette.grey[500], label: 'Unknown' };

    switch (status.licenseType) {
      case 'pro':
        return {
          icon: <CheckCircleIcon />,
          color: theme.palette.success.main,
          label: t('license.proActive', 'Pro License Active'),
        };
      case 'trial':
        if (status.trialDaysRemaining !== undefined && status.trialDaysRemaining <= 7) {
          return {
            icon: <WarningIcon />,
            color: theme.palette.warning.main,
            label: t('license.trialExpiring', 'Trial Expiring Soon'),
          };
        }
        return {
          icon: <ScheduleIcon />,
          color: theme.palette.primary.main,
          label: t('license.trialActive', 'Trial Active'),
        };
      case 'expired':
        return {
          icon: <BlockIcon />,
          color: theme.palette.error.main,
          label: t('license.trialExpired', 'Trial Expired'),
        };
      case 'none':
      default:
        return {
          icon: <PersonAddIcon />,
          color: theme.palette.info.main,
          label: t('license.registrationRequired', 'Registration Required'),
        };
    }
  };

  const statusInfo = getStatusInfo();
  const progress = status?.trialDaysRemaining !== undefined
    ? ((TRIAL_DAYS - status.trialDaysRemaining) / TRIAL_DAYS) * 100
    : 0;
  const normalizedEmail = email.trim();
  const isEmailValid = EMAIL_REGEX.test(normalizedEmail.toLowerCase());

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <StarIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>
              {t('license.title', 'License')}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ py: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* License Status Section */}
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: 2,
                backgroundColor: alpha(statusInfo.color, 0.08),
                borderColor: alpha(statusInfo.color, 0.3),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    backgroundColor: alpha(statusInfo.color, 0.15),
                    color: statusInfo.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {React.cloneElement(statusInfo.icon, { sx: { fontSize: 32 } })}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h6" fontWeight={600} sx={{ color: statusInfo.color }}>
                    {statusInfo.label}
                  </Typography>
                  {status?.licenseType === 'trial' && status.trialDaysRemaining !== undefined && (
                    <Typography variant="body2" color="text.secondary">
                      {t('license.daysRemaining', { days: status.trialDaysRemaining })}
                    </Typography>
                  )}
                  {status?.licenseType === 'pro' && (
                    <Typography variant="body2" color="text.secondary">
                      {t('license.proDescription', 'Full access to all features')}
                    </Typography>
                  )}
                  {status?.licenseType === 'expired' && (
                    <Typography variant="body2" color="text.secondary">
                      {t('license.readOnlyMode', 'App is in read-only mode')}
                    </Typography>
                  )}
                </Box>
              </Box>

              {/* Trial Progress Bar */}
              {status?.licenseType === 'trial' && status.trialDaysRemaining !== undefined && (
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('license.trialProgress', 'Trial Progress')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {TRIAL_DAYS - status.trialDaysRemaining} / {TRIAL_DAYS} {t('license.days', 'days')}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={progress}
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: alpha(statusInfo.color, 0.2),
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: statusInfo.color,
                        borderRadius: 4,
                      },
                    }}
                  />
                </Box>
              )}
            </Paper>

            {/* Registration Section - Show only if not registered */}
            {!isRegistered && status?.licenseType === 'none' && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: alpha(theme.palette.background.paper, 0.5),
                }}
              >
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('license.registerTitle', 'Start Your Free Trial')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('license.registerDescription', 'Enter your email to start a 30-day free trial with full access to all features.')}
                </Typography>

                {registrationSuccess ? (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    {t('license.registrationSuccess', 'Registration successful! Your 30-day trial has started.')}
                  </Alert>
                ) : (
                  <>
                    <TextField
                      fullWidth
                      label={t('license.email', 'Email')}
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      error={!!validationError}
                      helperText={validationError || (isValidating ? t('license.validating', 'Validating...') : ' ')}
                      placeholder="you@example.com"
                      type="email"
                      inputProps={{ autoComplete: 'email' }}
                      sx={{ mb: 2 }}
                    />

                    {registrationError && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        {registrationError}
                      </Alert>
                    )}

                    <Button
                      variant="contained"
                      fullWidth
                      onClick={handleRegister}
                      disabled={!isEmailValid || !!validationError || isRegistering || isValidating}
                      startIcon={isRegistering ? <CircularProgress size={20} color="inherit" /> : <PersonAddIcon />}
                    >
                      {isRegistering ? t('license.registering', 'Registering...') : t('license.register', 'Start Free Trial')}
                    </Button>
                  </>
                )}

                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
                  {t('license.privacyNote', 'Your email is used only for license verification and is stored securely.')}
                </Typography>
              </Paper>
            )}

            {/* Upgrade Section - Show for trial or expired */}
            {(status?.licenseType === 'trial' || status?.licenseType === 'expired') && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: alpha(theme.palette.primary.main, 0.05),
                  borderColor: alpha(theme.palette.primary.main, 0.2),
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <StarIcon sx={{ color: theme.palette.warning.main }} />
                  <Typography variant="subtitle1" fontWeight={600}>
                    {t('license.upgradeTitle', 'Upgrade to Pro')}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('license.upgradeDescription', 'Get unlimited access with no time restrictions. Support development and unlock all features permanently.')}
                </Typography>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleUpgrade}
                  startIcon={<StarIcon />}
                  sx={{ textTransform: 'none' }}
                >
                  {t('license.upgradeToPro', 'Upgrade to Pro')}
                </Button>
              </Paper>
            )}

            {/* Features List */}
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {status?.licenseType === 'pro'
                  ? t('license.includedFeatures', 'Your Pro license includes:')
                  : t('license.trialFeatures', 'Trial includes full access to:')}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: 'text.secondary' }}>
                <Typography component="li" variant="body2">
                  {t('license.feature1', 'Unlimited bank & credit card connections')}
                </Typography>
                <Typography component="li" variant="body2">
                  {t('license.feature2', 'Automatic transaction sync')}
                </Typography>
                <Typography component="li" variant="body2">
                  {t('license.feature3', 'Advanced analytics & reports')}
                </Typography>
                <Typography component="li" variant="body2">
                  {t('license.feature4', 'Investment portfolio tracking')}
                </Typography>
                <Typography component="li" variant="body2">
                  {t('license.feature5', 'Data export & backups')}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          {t('common.close', 'Close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LicenseDetailsModal;
