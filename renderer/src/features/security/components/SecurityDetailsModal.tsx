import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Divider,
  Chip,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Close as CloseIcon,
  Security as SecurityIcon,
  Lock as LockIcon,
  VpnKey as KeyIcon,
  Fingerprint as FingerprintIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';

interface SecurityDetailsModalProps {
  open: boolean;
  onClose: () => void;
}

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

const SecurityDetailsModal: React.FC<SecurityDetailsModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchSecurityStatus();
    }
  }, [open]);

  const fetchSecurityStatus = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/security/status');

      if (response.ok && response.data) {
        const responseData = response.data as { success: boolean; data: SecurityStatus };
        setStatus(responseData.data);
      }
    } catch (err) {
      console.error('[SecurityDetailsModal] Error fetching status:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (isGood: boolean, fallback: 'warning' | 'info' = 'warning') => {
    return isGood ? (
      <CheckIcon sx={{ color: theme.palette.success.main }} />
    ) : (
      fallback === 'info'
        ? <InfoIcon sx={{ color: theme.palette.info.main }} />
        : <WarningIcon sx={{ color: theme.palette.warning.main }} />
    );
  };

  const getBiometricLabel = (type: string | null) => {
    if (!type || type === 'none') return 'Biometric';
    if (type === 'touchid') return 'Touch ID';
    if (type === 'windows-hello') return 'Windows Hello';
    return type;
  };

  const formatLastAuth = (lastAuth: string | null) => {
    if (!lastAuth) return 'Never';
    const date = new Date(lastAuth);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return 'Less than 1 hour ago';
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

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
            <SecurityIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>
              Security & Privacy
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
        ) : status ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Encryption Section */}
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                backgroundColor: alpha(theme.palette.background.paper, 0.5),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <LockIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" fontWeight={600}>
                  Encryption
                </Typography>
              </Box>
              <List dense disablePadding>
                <ListItem disablePadding>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {getStatusIcon(status.encryption.status === 'active')}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      status.encryption.status === 'active'
                        ? `${status.encryption.algorithm} Active`
                        : 'Encryption Inactive'
                    }
                    secondary="All credentials are encrypted at rest"
                  />
                </ListItem>
              </List>
            </Paper>

            {/* Key Storage Section */}
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                backgroundColor: alpha(theme.palette.background.paper, 0.5),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <KeyIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" fontWeight={600}>
                  Key Storage
                </Typography>
              </Box>
              <List dense disablePadding>
                <ListItem disablePadding>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {getStatusIcon(status.keychain.status === 'connected')}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      status.keychain.status === 'connected'
                        ? status.keychain.type
                        : 'Fallback Mode'
                    }
                    secondary={
                      status.keychain.status === 'connected'
                        ? 'Keys stored securely in OS keychain'
                        : 'OS keychain unavailable. Enable system keychain support.'
                    }
                  />
                </ListItem>
              </List>
              {status.keychain.fallbackMode && (
                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.5,
                    borderRadius: 1,
                    backgroundColor: alpha(theme.palette.warning.main, 0.1),
                  }}
                >
                  <Typography variant="caption" color="warning.main" display="flex" alignItems="center" gap={0.5}>
                    <InfoIcon sx={{ fontSize: 14 }} />
                    Keys are never stored in plain text files
                  </Typography>
                </Box>
              )}
            </Paper>

            {/* Biometric Authentication Section */}
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                backgroundColor: alpha(theme.palette.background.paper, 0.5),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <FingerprintIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" fontWeight={600}>
                  Biometric Authentication
                </Typography>
              </Box>
              <List dense disablePadding>
                <ListItem disablePadding>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {getStatusIcon(status.biometric.available, 'info')}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      status.biometric.available
                        ? `${getBiometricLabel(status.biometric.type)} Available`
                        : 'Not Available'
                    }
                    secondary={
                      status.biometric.reason || `Platform: ${status.platform.osName}`
                    }
                  />
                </ListItem>
                {status.authentication.isActive && (
                  <ListItem disablePadding sx={{ mt: 1 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <CheckIcon sx={{ color: theme.palette.success.main }} />
                    </ListItemIcon>
                    <ListItemText
                      primary="Authenticated"
                      secondary={`Last authenticated: ${formatLastAuth(status.authentication.lastAuthenticated)}`}
                    />
                  </ListItem>
                )}
              </List>
            </Paper>

            {/* Platform Info */}
            <Box sx={{ textAlign: 'center', pt: 2 }}>
              <Chip
                label={`Running on ${status.platform.osName}`}
                size="small"
                variant="outlined"
                sx={{ borderRadius: 1.5 }}
              />
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary" align="center">
            Failed to load security information
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SecurityDetailsModal;
