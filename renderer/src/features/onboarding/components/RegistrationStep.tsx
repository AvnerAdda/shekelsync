import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  InputAdornment,
  alpha,
  useTheme,
  Stack,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HowToReg as HowToRegIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface RegistrationStepProps {
  onComplete?: () => void;
  onSkip?: () => void;
}

// Check if we're running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;

const RegistrationStep: React.FC<RegistrationStepProps> = ({ onComplete, onSkip }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const [teudatZehut, setTeudatZehut] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; error?: string } | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // Debounced validation
  useEffect(() => {
    if (!teudatZehut || teudatZehut.length < 9) {
      setValidation(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsValidating(true);
      try {
        if (isElectron) {
          const result = await window.electronAPI.license.validateTeudatZehut(teudatZehut);
          if (result.success) {
            setValidation(result.data);
          } else {
            setValidation({ valid: false, error: result.error });
          }
        } else {
          // Basic client-side validation
          const cleanId = teudatZehut.replace(/[\s-]/g, '');
          if (!/^\d{9}$/.test(cleanId)) {
            setValidation({ valid: false, error: t('registration.invalidId') });
          } else {
            setValidation({ valid: true });
          }
        }
      } catch (err) {
        console.error('Validation error:', err);
        setValidation({ valid: false, error: t('registration.validationError') });
      } finally {
        setIsValidating(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [teudatZehut, t]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digits, max 9 characters
    const value = e.target.value.replace(/\D/g, '').slice(0, 9);
    setTeudatZehut(value);
    setRegistrationError(null);
  }, []);

  const handleRegister = useCallback(async () => {
    if (!validation?.valid || isRegistering) return;

    setIsRegistering(true);
    setRegistrationError(null);

    try {
      if (isElectron) {
        const result = await window.electronAPI.license.register(teudatZehut);
        if (result.success) {
          onComplete?.();
        } else {
          setRegistrationError(result.error || t('registration.registrationFailed'));
        }
      } else {
        // Non-Electron environment
        setRegistrationError(t('registration.electronRequired'));
      }
    } catch (err) {
      console.error('Registration error:', err);
      setRegistrationError(t('registration.registrationFailed'));
    } finally {
      setIsRegistering(false);
    }
  }, [validation, isRegistering, teudatZehut, onComplete, t]);

  const getInputEndAdornment = () => {
    if (isValidating) {
      return (
        <InputAdornment position="end">
          <CircularProgress size={20} />
        </InputAdornment>
      );
    }

    if (validation?.valid) {
      return (
        <InputAdornment position="end">
          <CheckCircleIcon sx={{ color: theme.palette.success.main }} />
        </InputAdornment>
      );
    }

    if (validation && !validation.valid) {
      return (
        <InputAdornment position="end">
          <ErrorIcon sx={{ color: theme.palette.error.main }} />
        </InputAdornment>
      );
    }

    return null;
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        p: 3,
        backgroundColor: theme.palette.background.default,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          maxWidth: 480,
          width: '100%',
          borderRadius: 3,
          backgroundColor: theme.palette.background.paper,
        }}
      >
        <Stack spacing={3} alignItems="center">
          {/* Icon */}
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              backgroundColor: alpha(theme.palette.primary.main, 0.1),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <HowToRegIcon sx={{ fontSize: 40, color: theme.palette.primary.main }} />
          </Box>

          {/* Title and description */}
          <Box textAlign="center">
            <Typography variant="h5" fontWeight={600} gutterBottom>
              {t('registration.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('registration.description')}
            </Typography>
          </Box>

          {/* Input field */}
          <TextField
            fullWidth
            label={t('registration.teudatZehut')}
            placeholder={t('registration.digits')}
            value={teudatZehut}
            onChange={handleInputChange}
            error={Boolean(validation && !validation.valid)}
            helperText={validation && !validation.valid ? validation.error : ' '}
            InputProps={{
              endAdornment: getInputEndAdornment(),
              inputProps: {
                maxLength: 9,
                inputMode: 'numeric',
                pattern: '[0-9]*',
                style: {
                  letterSpacing: '0.3em',
                  fontWeight: 500,
                  fontSize: '1.1rem',
                },
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
              },
            }}
          />

          {/* Registration error */}
          {registrationError && (
            <Alert severity="error" sx={{ width: '100%' }}>
              {registrationError}
            </Alert>
          )}

          {/* Register button */}
          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleRegister}
            disabled={!validation?.valid || isRegistering}
            sx={{
              py: 1.5,
              borderRadius: 2,
              fontWeight: 600,
              textTransform: 'none',
            }}
          >
            {isRegistering ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              t('registration.startTrial')
            )}
          </Button>

          {/* Privacy notice */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1,
              p: 2,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.info.main, 0.08),
              width: '100%',
            }}
          >
            <SecurityIcon sx={{ fontSize: 18, color: theme.palette.info.main, mt: 0.25 }} />
            <Typography variant="caption" color="text.secondary">
              {t('registration.privacyNotice')}
            </Typography>
          </Box>

          {/* Trial info */}
          <Box textAlign="center">
            <Typography variant="body2" color="text.secondary">
              {t('registration.trialInfo')}
            </Typography>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
};

export default RegistrationStep;
