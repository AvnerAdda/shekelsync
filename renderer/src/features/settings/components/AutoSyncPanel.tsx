import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  FormControlLabel,
  Skeleton,
  Stack,
  Switch,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material';
import {
  Schedule as ScheduleIcon,
  Sync as SyncIcon,
  Event as EventIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { addHours, formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { apiClient } from '@/lib/api-client';
import { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';

type IntervalHours = 24 | 48 | 168;

interface BackgroundSyncSettings {
  enabled: boolean;
  intervalHours: IntervalHours;
  runOnStartup: boolean;
  keepRunningInTray: boolean;
  headless: boolean;
  lastRunAt?: string;
  lastResult?: {
    status: 'success' | 'failed' | 'skipped' | 'blocked';
    message?: string;
    totals?: {
      totalProcessed: number;
      successCount: number;
      failureCount: number;
      totalTransactions: number;
    };
  };
}

const DEFAULT_SETTINGS: BackgroundSyncSettings = {
  enabled: false,
  intervalHours: 24,
  runOnStartup: true,
  keepRunningInTray: true,
  headless: true,
};

const INTERVAL_OPTIONS: Array<{ value: IntervalHours; labelKey: string; hours: number }> = [
  { value: 24, labelKey: 'intervals.daily', hours: 24 },
  { value: 48, labelKey: 'intervals.twoDays', hours: 48 },
  { value: 168, labelKey: 'intervals.weekly', hours: 168 },
];

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const AutoSyncPanel: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'settings.autoSync' });
  const { showNotification } = useNotification();
  const [backgroundSync, setBackgroundSync] = useState<BackgroundSyncSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const settingsBridge = typeof window !== 'undefined' ? window.electronAPI?.settings : undefined;

  const applyIncomingSettings = useCallback((settings?: Partial<BackgroundSyncSettings>) => {
    setBackgroundSync((prev) => ({
      ...prev,
      ...(settings || {}),
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      if (!settingsBridge?.get) {
        setLoading(false);
        setError(t('errors.notSupported'));
        return;
      }
      try {
        const response = await settingsBridge.get();
        if (cancelled) return;
        applyIncomingSettings((response?.settings as any)?.backgroundSync);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t('errors.loadFailed'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSettings();

    const unsubscribe = settingsBridge?.onChange?.((nextSettings: any) => {
      applyIncomingSettings(nextSettings?.backgroundSync);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [applyIncomingSettings, settingsBridge, t]);

  const updateBackgroundSync = useCallback(
    async (patch: Partial<BackgroundSyncSettings>) => {
      if (!settingsBridge?.update) {
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const next = { ...backgroundSync, ...patch };
        const response = await settingsBridge.update({ backgroundSync: next });
        if (!response?.success) {
          throw new Error(response?.error || t('errors.saveFailed'));
        }
        applyIncomingSettings((response?.settings as any)?.backgroundSync);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : t('errors.saveFailed'));
      } finally {
        setSaving(false);
      }
    },
    [applyIncomingSettings, backgroundSync, settingsBridge, t],
  );

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await apiClient.post('/api/scrape/bulk', {});
      if (!response.ok) {
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          showNotification(licenseCheck.reason || t('errors.readOnly'), 'warning');
          setSyncing(false);
          return;
        }
        throw new Error(response.statusText || t('errors.syncFailed'));
      }
      const result = response.data as any;
      if (result?.success) {
        showNotification(result.message || t('status.syncStarted'), 'success');
      } else {
        showNotification(result.message || t('errors.syncFailed'), 'error');
      }
    } catch (syncError) {
      showNotification(
        syncError instanceof Error ? syncError.message : t('errors.syncFailed'),
        'error',
      );
    } finally {
      setSyncing(false);
    }
  }, [showNotification, t]);

  const lastRunLabel = useMemo(() => {
    if (!backgroundSync.lastRunAt) {
      return null;
    }
    const date = new Date(backgroundSync.lastRunAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return formatDistanceToNow(date, { addSuffix: true });
  }, [backgroundSync.lastRunAt]);

  const nextSyncLabel = useMemo(() => {
    if (!backgroundSync.enabled || !backgroundSync.lastRunAt) {
      return null;
    }
    const lastRun = new Date(backgroundSync.lastRunAt);
    if (Number.isNaN(lastRun.getTime())) {
      return null;
    }
    const nextSync = addHours(lastRun, backgroundSync.intervalHours);
    return formatDistanceToNow(nextSync, { addSuffix: true });
  }, [backgroundSync.enabled, backgroundSync.lastRunAt, backgroundSync.intervalHours]);

  const lastResult = backgroundSync.lastResult;
  const lastResultColor = lastResult?.status === 'success'
    ? theme.palette.success
    : lastResult?.status === 'failed'
      ? theme.palette.error
      : lastResult?.status === 'blocked'
        ? theme.palette.warning
        : theme.palette.info;

  if (loading) {
    return (
      <Box
        sx={{
          p: 3,
          mb: 4,
          borderRadius: 4,
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.dark, 0.04)} 100%)`,
          backdropFilter: 'blur(20px)',
          border: '1px solid',
          borderColor: alpha(theme.palette.primary.main, 0.15),
        }}
      >
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Skeleton variant="circular" width={48} height={48} />
          <Box flex={1}>
            <Skeleton variant="text" width="40%" height={28} />
            <Skeleton variant="text" width="60%" height={20} sx={{ mt: 0.5 }} />
          </Box>
        </Stack>
        <Box sx={{ mt: 3 }}>
          <Skeleton variant="rounded" width="100%" height={80} sx={{ borderRadius: 3 }} />
        </Box>
        <Box sx={{ mt: 2 }}>
          <Skeleton variant="rounded" width="100%" height={56} sx={{ borderRadius: 3 }} />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 3,
        mb: 4,
        borderRadius: 4,
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.dark, 0.04)} 100%)`,
        backdropFilter: 'blur(20px)',
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.15),
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Header with Icon, Title, and Status */}
      <Stack direction="row" spacing={2} alignItems="flex-start" justifyContent="space-between">
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 3,
              background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 4px 14px 0 ${alpha(theme.palette.primary.main, 0.4)}`,
            }}
          >
            <ScheduleIcon sx={{ color: '#fff', fontSize: 24 }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              {t('title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {backgroundSync.enabled ? t('status.enabled') : t('status.disabled')}
            </Typography>
          </Box>
        </Stack>
        <Chip
          label={backgroundSync.enabled ? t('status.active') : t('status.paused')}
          size="small"
          sx={{
            bgcolor: alpha(backgroundSync.enabled ? theme.palette.success.main : theme.palette.warning.main, 0.1),
            color: backgroundSync.enabled ? theme.palette.success.main : theme.palette.warning.main,
            fontWeight: 600,
            borderRadius: 2,
          }}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 2 }}>
        {t('description')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Enable Toggle */}
      <FormControlLabel
        control={
          <Switch
            checked={backgroundSync.enabled}
            onChange={(event) => updateBackgroundSync({ enabled: event.target.checked })}
            disabled={saving}
          />
        }
        label={t('enableLabel')}
        sx={{
          mb: 2,
          '& .MuiFormControlLabel-label': {
            fontWeight: 500,
          },
        }}
      />

      {/* Next Sync Time Display */}
      {backgroundSync.enabled && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            borderRadius: 3,
            border: '1px dashed',
            borderColor: alpha(theme.palette.primary.main, 0.3),
            bgcolor: alpha(theme.palette.primary.main, 0.02),
            animation: `${fadeIn} 0.3s ease-out`,
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <EventIcon sx={{ color: theme.palette.primary.main, fontSize: 20 }} />
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('status.nextSync')}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {nextSyncLabel || t('status.pending')}
              </Typography>
            </Box>
          </Stack>
        </Box>
      )}

      {/* Interval Selection Cards */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom fontWeight={500}>
          {t('intervalLabel')}
        </Typography>
        <Stack direction="row" spacing={1.5}>
          {INTERVAL_OPTIONS.map((option) => {
            const isSelected = backgroundSync.intervalHours === option.value;
            return (
              <Box
                key={option.value}
                onClick={() => !saving && updateBackgroundSync({ intervalHours: option.value })}
                sx={{
                  flex: 1,
                  p: 2,
                  borderRadius: 3,
                  border: '2px solid',
                  borderColor: isSelected
                    ? theme.palette.primary.main
                    : alpha(theme.palette.divider, 0.2),
                  bgcolor: isSelected
                    ? alpha(theme.palette.primary.main, 0.08)
                    : alpha(theme.palette.background.paper, 0.4),
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                  textAlign: 'center',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    transform: saving ? 'none' : 'translateY(-2px)',
                    borderColor: isSelected
                      ? theme.palette.primary.main
                      : alpha(theme.palette.primary.main, 0.3),
                    boxShadow: saving
                      ? 'none'
                      : `0 4px 12px -4px ${alpha(theme.palette.primary.main, 0.2)}`,
                  },
                }}
              >
                <Typography
                  variant="h5"
                  fontWeight={700}
                  sx={{ color: isSelected ? theme.palette.primary.main : 'text.primary' }}
                >
                  {option.hours}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  {t(option.labelKey)}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      </Box>

      {/* Advanced Settings (Collapsible) */}
      {backgroundSync.enabled && (
        <>
          <Box
            onClick={() => setAdvancedOpen(!advancedOpen)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              mb: advancedOpen ? 2 : 0,
              '&:hover': {
                '& .MuiTypography-root': {
                  color: theme.palette.primary.main,
                },
              },
            }}
          >
            <Typography
              variant="subtitle2"
              fontWeight={500}
              sx={{ transition: 'color 0.2s' }}
            >
              {t('advancedSettings')}
            </Typography>
            {advancedOpen ? (
              <ExpandLessIcon sx={{ ml: 0.5, fontSize: 20 }} />
            ) : (
              <ExpandMoreIcon sx={{ ml: 0.5, fontSize: 20 }} />
            )}
          </Box>
          <Collapse in={advancedOpen}>
            <Box
              sx={{
                p: 2,
                borderRadius: 3,
                bgcolor: alpha(theme.palette.background.paper, 0.3),
                mb: 3,
              }}
            >
              <Box sx={{ mb: 1.5 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={backgroundSync.keepRunningInTray}
                      onChange={(event) => updateBackgroundSync({ keepRunningInTray: event.target.checked })}
                      disabled={saving}
                      size="small"
                    />
                  }
                  label={t('keepRunningLabel')}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 6 }}>
                  {t('keepRunningHint')}
                </Typography>
              </Box>
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={backgroundSync.headless}
                      onChange={(event) => updateBackgroundSync({ headless: event.target.checked })}
                      disabled={saving}
                      size="small"
                    />
                  }
                  label={t('headlessLabel')}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 6 }}>
                  {t('headlessHint')}
                </Typography>
              </Box>
            </Box>
          </Collapse>
        </>
      )}

      {/* Last Result Display (only when lastRunAt exists) */}
      {backgroundSync.lastRunAt && lastResult && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            borderRadius: 3,
            bgcolor: alpha(lastResultColor.main, 0.08),
            border: '1px solid',
            borderColor: alpha(lastResultColor.main, 0.2),
            animation: `${fadeIn} 0.3s ease-out`,
          }}
        >
          <Typography variant="body2" fontWeight={600} sx={{ color: lastResultColor.main }}>
            {t('status.lastRun', { timeAgo: lastRunLabel })}
          </Typography>
          {lastResult.message && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {lastResult.message}
            </Typography>
          )}
          {lastResult.totals && (
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              {lastResult.totals.successCount > 0 && (
                <Typography
                  variant="caption"
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.success.main, 0.1),
                    color: theme.palette.success.main,
                    fontWeight: 600,
                  }}
                >
                  {t('results.success', { count: lastResult.totals.successCount })}
                </Typography>
              )}
              {lastResult.totals.failureCount > 0 && (
                <Typography
                  variant="caption"
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.error.main, 0.1),
                    color: theme.palette.error.main,
                    fontWeight: 600,
                  }}
                >
                  {t('results.failed', { count: lastResult.totals.failureCount })}
                </Typography>
              )}
            </Stack>
          )}
        </Box>
      )}

      {/* Enhanced Sync Now Button */}
      <Button
        variant="contained"
        startIcon={
          <SyncIcon
            sx={{
              animation: syncing ? `${spin} 1s linear infinite` : 'none',
            }}
          />
        }
        onClick={handleSyncNow}
        disabled={syncing}
        sx={{
          background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
          boxShadow: `0 4px 14px 0 ${alpha(theme.palette.primary.main, 0.4)}`,
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: `0 6px 20px 0 ${alpha(theme.palette.primary.main, 0.5)}`,
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

export default AutoSyncPanel;
