import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Divider,
  IconButton,
  Tooltip,
  CircularProgress,
  Chip,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Security as SecurityIcon,
  Lock as LockIcon,
  VpnKey as KeyIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';

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
  };
  authentication: {
    isActive: boolean;
    method: string | null;
    lastAuthenticated: string | null;
  };
  biometric: {
    available: boolean;
    type: string | null;
  };
  platform: {
    os: string;
    osName: string;
  };
}

interface SecurityStatusCardProps {
  onViewDetails?: () => void;
}

const SecurityStatusCard: React.FC<SecurityStatusCardProps> = ({ onViewDetails }) => {
  const theme = useTheme();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSecurityStatus = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/security/status');

      if (response.ok && response.data) {
        const responseData = response.data as { success: boolean; data: SecurityStatus };
        setStatus(responseData.data);
        setError(null);
      } else {
        setError('Failed to fetch security status');
      }
    } catch (err) {
      console.error('[SecurityStatusCard] Error fetching status:', err);
      setError('Error loading security status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecurityStatus();

    // Refresh every 30 seconds
    const interval = setInterval(fetchSecurityStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getSecurityLevel = () => {
    if (!status) return 'unknown';

    const authRequired = status.biometric.available;
    const authOk = !authRequired || status.authentication.isActive;
    const keychainRequired = status.platform.os !== 'linux';
    const keychainOk = keychainRequired ? status.keychain.status === 'connected' : true;

    const checks = {
      encryption: status.encryption.status === 'active',
      keychain: keychainOk,
      authenticated: authOk,
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
        return <CheckIcon sx={{ color, fontSize: 20 }} />;
      case 'warning':
        return <WarningIcon sx={{ color, fontSize: 20 }} />;
      case 'error':
        return <ErrorIcon sx={{ color, fontSize: 20 }} />;
      default:
        return <InfoIcon sx={{ color, fontSize: 20 }} />;
    }
  };

  const getStatusText = () => {
    const level = getSecurityLevel();
    switch (level) {
      case 'secure':
        return 'Secure';
      case 'warning':
        return 'Warning';
      case 'error':
        return 'At Risk';
      default:
        return 'Unknown';
    }
  };

  if (loading) {
    return (
      <Paper
        sx={{
          p: 2,
          borderRadius: 3,
          backgroundColor: alpha(theme.palette.background.paper, 0.4),
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper
        sx={{
          p: 2,
          borderRadius: 3,
          backgroundColor: alpha(theme.palette.background.paper, 0.4),
          border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
        }}
      >
        <Typography variant="caption" color="error" align="center">
          {error}
        </Typography>
      </Paper>
    );
  }

  if (!status) return null;

  const keychainRequired = status.platform.os !== 'linux';
  const keychainOk = keychainRequired ? status.keychain.status === 'connected' : true;
  const usesEnvKey = status.encryption.keyStorage === 'environment';
  const keychainLabel = status.keychain.status === 'connected'
    ? status.keychain.type
    : (keychainRequired ? 'Fallback' : (usesEnvKey ? 'Environment Key' : 'Optional'));

  return (
    <Paper
      sx={{
        p: 2,
        borderRadius: 3,
        backgroundColor: alpha(theme.palette.background.paper, 0.4),
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        transition: 'all 0.2s',
        '&:hover': {
          backgroundColor: alpha(theme.palette.background.paper, 0.6),
          borderColor: alpha(getSecurityColor(), 0.3),
        },
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              p: 0.8,
              borderRadius: 2,
              backgroundColor: alpha(getSecurityColor(), 0.1),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SecurityIcon sx={{ fontSize: 20, color: getSecurityColor() }} />
          </Box>
          <Typography variant="body2" fontWeight={600}>
            Security
          </Typography>
        </Box>
        {onViewDetails && (
          <Tooltip title="View details">
            <IconButton size="small" onClick={onViewDetails}>
              <ViewIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Status Badge */}
      <Box sx={{ mb: 1.5 }}>
        <Chip
          icon={getSecurityIcon()}
          label={getStatusText()}
          size="small"
          sx={{
            fontWeight: 600,
            fontSize: '0.75rem',
            backgroundColor: alpha(getSecurityColor(), 0.1),
            color: getSecurityColor(),
            borderColor: alpha(getSecurityColor(), 0.3),
          }}
          variant="outlined"
        />
      </Box>

      <Divider sx={{ my: 1.5, borderColor: alpha(theme.palette.divider, 0.1) }} />

      {/* Status Items */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* Encryption */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              p: 0.8,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.text.primary, 0.05),
              display: 'flex',
            }}
          >
            <LockIcon
              fontSize="small"
              color={status.encryption.status === 'active' ? 'success' : 'error'}
            />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1 }}>
              Encryption
            </Typography>
            <Typography variant="body2" fontWeight={600} fontSize="0.85rem">
              {status.encryption.status === 'active' ? 'Active' : 'Inactive'}
            </Typography>
          </Box>
        </Box>

        {/* Keychain */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              p: 0.8,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.text.primary, 0.05),
              display: 'flex',
            }}
          >
            <KeyIcon
              fontSize="small"
              color={keychainOk ? 'success' : 'warning'}
            />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1 }}>
              Key Storage
            </Typography>
            <Typography variant="body2" fontWeight={600} fontSize="0.85rem">
              {keychainLabel}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
};

export default SecurityStatusCard;
