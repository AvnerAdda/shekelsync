import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Security as SecurityIcon,
  Lock as LockIcon,
  VpnKey as KeyIcon,
  Fingerprint as FingerprintIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Visibility as ViewIcon,
  TouchApp as TouchAppIcon,
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';
import SecurityDetailsModal from '@renderer/features/security/components/SecurityDetailsModal';

interface SecurityStatus {
  encryption: {
    status: 'active' | 'inactive' | 'error';
    algorithm: string;
    keyStorage: string;
  };
  keychain: {
    status: 'connected' | 'fallback' | 'error';
    type: string;
    available: boolean;
    fallbackMode: boolean;
  };
  authentication: {
    isActive: boolean;
    method: string | null;
    lastAuthenticated: string | null;
    requiresReauth: boolean;
  };
  biometric: {
    available: boolean;
    type: string | null;
    reason: string | null;
  };
  platform: {
    os: string;
    osName: string;
  };
}

const SecuritySettingsPanel: React.FC = () => {
  const theme = useTheme();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [authResult, setAuthResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchSecurityStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/security/status');

      if (response.ok && response.data) {
        const responseData = response.data as { success: boolean; data: SecurityStatus };
        setStatus(responseData.data);
      } else {
        setError('Failed to fetch security status');
      }
    } catch (err) {
      console.error('[SecuritySettingsPanel] Error fetching status:', err);
      setError('Error loading security status');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthenticate = async () => {
    try {
      setAuthenticating(true);
      setAuthResult(null);

      // Check if biometric auth is available
      const biometricBridge = window.electronAPI?.biometricAuth;
      if (!biometricBridge) {
        setAuthResult({ success: false, message: 'Biometric authentication not available' });
        return;
      }

      const availabilityResult = await biometricBridge.isAvailable();
      if (!availabilityResult.available) {
        setAuthResult({ success: false, message: 'Biometric authentication not available on this system' });
        return;
      }

      const result = await biometricBridge.authenticate('Authenticate to verify your identity');
      if (result.success) {
        setAuthResult({ success: true, message: `Authentication successful using ${result.method}` });
        // Refresh status after authentication
        await fetchSecurityStatus();
      } else {
        setAuthResult({ success: false, message: result.error || 'Authentication failed' });
      }
    } catch (err) {
      console.error('[SecuritySettingsPanel] Authentication error:', err);
      setAuthResult({ success: false, message: 'Authentication error occurred' });
    } finally {
      setAuthenticating(false);
    }
  };

  React.useEffect(() => {
    fetchSecurityStatus();
  }, []);

  const getSecurityLevel = () => {
    if (!status) return 'unknown';

    const checks = {
      encryption: status.encryption.status === 'active',
      keychain: status.keychain.status === 'connected',
      authenticated: status.authentication.isActive,
    };

    const passed = Object.values(checks).filter(Boolean).length;

    if (passed === 3) return 'secure';
    if (passed === 2) return 'warning';
    return 'error';
  };

  const getSecurityColor = () => {
    const level = getSecurityLevel();
    switch (level) {
      case 'secure':
        return theme.palette.success.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'error':
        return theme.palette.error.main;
      default:
        return theme.palette.text.disabled;
    }
  };

  const getSecurityIcon = () => {
    const level = getSecurityLevel();
    const color = getSecurityColor();

    switch (level) {
      case 'secure':
        return <CheckIcon sx={{ color }} />;
      case 'warning':
        return <WarningIcon sx={{ color }} />;
      case 'error':
        return <ErrorIcon sx={{ color }} />;
      default:
        return <SecurityIcon sx={{ color }} />;
    }
  };

  const getSecurityText = () => {
    const level = getSecurityLevel();
    switch (level) {
      case 'secure':
        return 'All Security Checks Passed';
      case 'warning':
        return 'Some Security Warnings';
      case 'error':
        return 'Security Issues Detected';
      default:
        return 'Security Status Unknown';
    }
  };

  return (
    <>
      <Paper id="security" sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <SecurityIcon color="primary" />
          <Typography variant="h6">Security & Authentication</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Manage security settings, encryption, and biometric authentication for ShekelSync.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={32} />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
            <Button size="small" onClick={fetchSecurityStatus} sx={{ ml: 2 }}>
              Retry
            </Button>
          </Alert>
        ) : status ? (
          <>
            {/* Security Status Overview */}
            <Box
              sx={{
                p: 2,
                borderRadius: 2,
                backgroundColor: alpha(getSecurityColor(), 0.1),
                border: `1px solid ${alpha(getSecurityColor(), 0.3)}`,
                mb: 3,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {getSecurityIcon()}
                  <Typography variant="subtitle1" fontWeight={600}>
                    {getSecurityText()}
                  </Typography>
                </Box>
                <Chip
                  label={getSecurityLevel().toUpperCase()}
                  size="small"
                  sx={{
                    backgroundColor: getSecurityColor(),
                    color: 'white',
                    fontWeight: 600,
                  }}
                />
              </Box>
              <Typography variant="body2" color="text.secondary">
                Running on {status.platform.osName}
              </Typography>
            </Box>

            {/* Security Features List */}
            <List dense>
              <ListItem>
                <ListItemIcon>
                  {status.encryption.status === 'active' ? (
                    <CheckIcon color="success" />
                  ) : (
                    <ErrorIcon color="error" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary="Encryption"
                  secondary={
                    status.encryption.status === 'active'
                      ? `${status.encryption.algorithm} encryption active`
                      : 'Encryption not active'
                  }
                />
              </ListItem>

              <ListItem>
                <ListItemIcon>
                  {status.keychain.status === 'connected' ? (
                    <CheckIcon color="success" />
                  ) : (
                    <WarningIcon color="warning" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary="Secure Key Storage"
                  secondary={
                    status.keychain.status === 'connected'
                      ? `${status.keychain.type} - Keys stored in OS keychain`
                      : 'Using fallback storage'
                  }
                />
              </ListItem>

              <ListItem>
                <ListItemIcon>
                  {status.biometric.available ? (
                    <CheckIcon color="success" />
                  ) : (
                    <WarningIcon color="warning" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary="Biometric Authentication"
                  secondary={
                    status.biometric.available
                      ? `${status.biometric.type === 'touchid' ? 'Touch ID' : status.biometric.type} available`
                      : status.biometric.reason || 'Not available on this system'
                  }
                />
              </ListItem>
            </List>

            <Divider sx={{ my: 2 }} />

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                startIcon={<ViewIcon />}
                onClick={() => setDetailsOpen(true)}
                sx={{ flex: '1 1 auto' }}
              >
                View Security Details
              </Button>

              {status.biometric.available && (
                <Button
                  variant="contained"
                  startIcon={authenticating ? <CircularProgress size={16} color="inherit" /> : <TouchAppIcon />}
                  onClick={handleAuthenticate}
                  disabled={authenticating}
                  sx={{ flex: '1 1 auto' }}
                >
                  {authenticating ? 'Authenticating...' : 'Test Biometric Auth'}
                </Button>
              )}
            </Box>

            {/* Authentication Result */}
            {authResult && (
              <Alert
                severity={authResult.success ? 'success' : 'error'}
                sx={{ mt: 2 }}
                onClose={() => setAuthResult(null)}
              >
                {authResult.message}
              </Alert>
            )}

            {/* Security Info */}
            <Alert severity="info" icon={<SecurityIcon />} sx={{ mt: 3 }}>
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Security Features
              </Typography>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                • All credentials are encrypted at rest using AES-256-GCM
              </Typography>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                • Encryption keys are stored securely in your OS keychain
              </Typography>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                • Biometric authentication is used when available (macOS Touch ID)
              </Typography>
              <Typography variant="caption" display="block">
                • Security events are logged for audit purposes
              </Typography>
            </Alert>
          </>
        ) : null}
      </Paper>

      <SecurityDetailsModal open={detailsOpen} onClose={() => setDetailsOpen(false)} />
    </>
  );
};

export default SecuritySettingsPanel;
