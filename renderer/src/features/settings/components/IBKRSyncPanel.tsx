import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material';
import {
  Sync as SyncIcon,
  Visibility,
  VisibilityOff,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  ShowChart as BrokerIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { apiClient } from '@/lib/api-client';

interface IBKRStatus {
  isConfigured: boolean;
  credentialId: number | null;
  lastSync: string | null;
  lastStatus: string | null;
  currentBalance: number | null;
  balanceUpdatedAt: string | null;
  accounts: Array<{
    id: number;
    account_name: string;
    account_number: string;
    currency: string;
  }>;
}

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const IBKRSyncPanel: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'settings.ibkr' });
  const { showNotification } = useNotification();

  const [status, setStatus] = useState<IBKRStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Credential form
  const [token, setToken] = useState('');
  const [queryId, setQueryId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showQueryId, setShowQueryId] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await apiClient.get<IBKRStatus & { success: boolean }>(
        '/api/investments/ibkr/status',
      );
      if (response.ok && response.data) {
        setStatus(response.data);
      }
    } catch {
      // Status check is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSaveCredentials = useCallback(async () => {
    if (!token.trim() || !queryId.trim()) {
      showNotification(t('errors.credentialsRequired'), 'warning');
      return;
    }

    setSaving(true);
    try {
      if (status?.credentialId) {
        // Update existing
        await apiClient.put('/api/credentials', {
          id: status.credentialId,
          password: token.trim(),
          identification_code: queryId.trim(),
        });
      } else {
        // Create new
        await apiClient.post('/api/credentials', {
          vendor: 'interactive_brokers',
          password: token.trim(),
          identification_code: queryId.trim(),
        });
      }

      showNotification(t('status.credentialsSaved'), 'success');
      setToken('');
      setQueryId('');
      await loadStatus();
    } catch (error) {
      showNotification(
        error instanceof Error ? error.message : t('errors.saveFailed'),
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [token, queryId, status, showNotification, t, loadStatus]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await apiClient.post<{
        success: boolean;
        summary?: {
          positionCount: number;
          totalValue: number;
          cashValue: number;
        };
        error?: string;
      }>('/api/investments/ibkr/sync');

      if (response.ok && response.data?.success) {
        const summary = response.data.summary;
        showNotification(
          t('status.syncSuccess', {
            positions: summary?.positionCount ?? 0,
            value: summary?.totalValue?.toFixed(0) ?? '0',
          }),
          'success',
        );
        await loadStatus();
      } else {
        showNotification(
          (response.data as unknown as Record<string, string>)?.error || t('errors.syncFailed'),
          'error',
        );
      }
    } catch (error) {
      showNotification(
        error instanceof Error ? error.message : t('errors.syncFailed'),
        'error',
      );
    } finally {
      setSyncing(false);
    }
  }, [showNotification, t, loadStatus]);

  const lastSyncLabel = status?.lastSync
    ? formatDistanceToNow(new Date(status.lastSync), { addSuffix: true })
    : null;

  if (loading) {
    return (
      <Box
        sx={{
          p: 3,
          borderRadius: 4,
          background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.08)} 0%, ${alpha(theme.palette.info.dark, 0.04)} 100%)`,
          border: '1px solid',
          borderColor: alpha(theme.palette.info.main, 0.15),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 120,
        }}
      >
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 3,
        borderRadius: 4,
        background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.08)} 0%, ${alpha(theme.palette.info.dark, 0.04)} 100%)`,
        backdropFilter: 'blur(20px)',
        border: '1px solid',
        borderColor: alpha(theme.palette.info.main, 0.15),
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Header */}
      <Stack direction="row" spacing={2} alignItems="flex-start" justifyContent="space-between">
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 3,
              background: `linear-gradient(135deg, ${theme.palette.info.main} 0%, ${theme.palette.info.dark} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 4px 14px 0 ${alpha(theme.palette.info.main, 0.4)}`,
            }}
          >
            <BrokerIcon sx={{ color: '#fff', fontSize: 24 }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              {t('title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {status?.isConfigured ? t('status.configured') : t('status.notConfigured')}
            </Typography>
          </Box>
        </Stack>
        <Chip
          icon={status?.isConfigured ? <CheckIcon /> : <ErrorIcon />}
          label={status?.isConfigured ? t('status.active') : t('status.setup')}
          size="small"
          sx={{
            bgcolor: alpha(
              status?.isConfigured ? theme.palette.success.main : theme.palette.warning.main,
              0.1,
            ),
            color: status?.isConfigured ? theme.palette.success.main : theme.palette.warning.main,
            fontWeight: 600,
            borderRadius: 2,
          }}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 3 }}>
        {t('description')}
      </Typography>

      {/* Last Sync Info */}
      {status?.isConfigured && lastSyncLabel && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            borderRadius: 3,
            bgcolor: alpha(
              status.lastStatus === 'success' ? theme.palette.success.main : theme.palette.error.main,
              0.08,
            ),
            border: '1px solid',
            borderColor: alpha(
              status.lastStatus === 'success' ? theme.palette.success.main : theme.palette.error.main,
              0.2,
            ),
            animation: `${fadeIn} 0.3s ease-out`,
          }}
        >
          <Typography variant="body2" fontWeight={600}>
            {t('status.lastSync', { timeAgo: lastSyncLabel })}
          </Typography>
          {status.currentBalance !== null && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('status.balance', { value: status.currentBalance.toLocaleString() })}
            </Typography>
          )}
          {status.accounts.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {status.accounts.map((a) => a.account_name).join(', ')}
            </Typography>
          )}
        </Box>
      )}

      {/* Credential Form */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={500} gutterBottom>
          {status?.isConfigured ? t('form.updateCredentials') : t('form.setupCredentials')}
        </Typography>

        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label={t('form.tokenLabel')}
            placeholder={t('form.tokenPlaceholder')}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type={showToken ? 'text' : 'password'}
            autoComplete="off"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setShowToken(!showToken)}
                    edge="end"
                  >
                    {showToken ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <TextField
            size="small"
            label={t('form.queryIdLabel')}
            placeholder={t('form.queryIdPlaceholder')}
            value={queryId}
            onChange={(e) => setQueryId(e.target.value)}
            type={showQueryId ? 'text' : 'password'}
            autoComplete="off"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setShowQueryId(!showQueryId)}
                    edge="end"
                  >
                    {showQueryId ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <Button
            variant="outlined"
            onClick={handleSaveCredentials}
            disabled={saving || (!token.trim() && !queryId.trim())}
            size="small"
          >
            {saving ? t('form.saving') : status?.isConfigured ? t('form.update') : t('form.save')}
          </Button>
        </Stack>
      </Box>

      {/* Help link */}
      <Alert
        severity="info"
        sx={{ mb: 3 }}
        action={
          <Button
            size="small"
            endIcon={<OpenInNewIcon fontSize="small" />}
            onClick={() => window.open('https://www.interactivebrokers.com/en/software/am/am/reports/activityflexqueries.htm', '_blank')}
          >
            {t('help.learnMore')}
          </Button>
        }
      >
        <Typography variant="body2">
          {t('help.howTo')}
        </Typography>
      </Alert>

      {/* Sync Button */}
      <Button
        variant="contained"
        startIcon={
          <SyncIcon
            sx={{
              animation: syncing ? `${spin} 1s linear infinite` : 'none',
            }}
          />
        }
        onClick={handleSync}
        disabled={syncing || !status?.isConfigured}
        sx={{
          background: `linear-gradient(135deg, ${theme.palette.info.main} 0%, ${theme.palette.info.dark} 100%)`,
          boxShadow: `0 4px 14px 0 ${alpha(theme.palette.info.main, 0.4)}`,
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: `0 6px 20px 0 ${alpha(theme.palette.info.main, 0.5)}`,
          },
          '&:disabled': {
            background: alpha(theme.palette.action.disabled, 0.2),
            boxShadow: 'none',
          },
        }}
      >
        {syncing ? t('status.syncing') : t('actions.syncNow')}
      </Button>
    </Box>
  );
};

export default IBKRSyncPanel;
