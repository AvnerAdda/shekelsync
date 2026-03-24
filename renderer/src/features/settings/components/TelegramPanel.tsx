import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import TelegramIcon from '@mui/icons-material/Telegram';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SyncIcon from '@mui/icons-material/Sync';
import { useTranslation } from 'react-i18next';
import { useNotification } from '@renderer/features/notifications/NotificationContext';

const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  enabled: false,
  deliveryMode: 'both',
  pushOnScheduledSync: true,
  localeMode: 'app',
};

const POLL_INTERVAL_MS = 3_000;

const TelegramPanel: React.FC = () => {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const settingsBridge = typeof window !== 'undefined' ? window.electronAPI?.settings : undefined;
  const telegramApi = typeof window !== 'undefined' ? window.electronAPI?.telegram : undefined;
  const [settings, setSettings] = useState<TelegramSettings>(DEFAULT_TELEGRAM_SETTINGS);
  const [status, setStatus] = useState<ElectronTelegramStatus | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingToken, setSavingToken] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backgroundSync = status?.syncStatus?.backgroundSync;
  const keepRunningInTray = status?.syncStatus?.keepRunningInTray;
  const supportsTelegram = Boolean(settingsBridge?.get && settingsBridge?.update && telegramApi?.getStatus);

  const applyIncomingSettings = useCallback((nextSettings?: ElectronAppSettings) => {
    setSettings({
      ...DEFAULT_TELEGRAM_SETTINGS,
      ...(nextSettings?.telegram || {}),
    });
  }, []);

  const loadStatus = useCallback(async () => {
    if (!telegramApi?.getStatus) {
      return;
    }
    const result = await telegramApi.getStatus();
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to load Telegram status');
    }
    setStatus(result.status || null);
  }, [telegramApi]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!supportsTelegram) {
        setLoading(false);
        setError(t('settings.telegram.unsupported', { defaultValue: 'Telegram controls are not available in this build.' }));
        return;
      }

      try {
        const settingsResult = await settingsBridge?.get?.();
        if (cancelled) return;
        if (settingsResult?.success) {
          applyIncomingSettings(settingsResult.settings);
        }
        await loadStatus();
        if (!cancelled) {
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load Telegram settings');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    const unsubscribe = settingsBridge?.onChange?.((nextSettings) => {
      applyIncomingSettings(nextSettings);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [applyIncomingSettings, loadStatus, settingsBridge, supportsTelegram, t]);

  useEffect(() => {
    if (!status?.pairingCode || !telegramApi?.getStatus) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void loadStatus().catch(() => {
        // Surface via next explicit action instead of noisy interval errors.
      });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadStatus, status?.pairingCode, telegramApi]);

  const saveSettings = useCallback(async (patch: Partial<TelegramSettings>) => {
    if (!settingsBridge?.update) {
      throw new Error('Telegram settings bridge is unavailable');
    }

    const next = {
      ...settings,
      ...patch,
    };
    const result = await settingsBridge.update({ telegram: next });
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to save Telegram settings');
    }
    applyIncomingSettings(result.settings);
  }, [applyIncomingSettings, settings, settingsBridge]);

  const handleSaveToken = useCallback(async () => {
    if (!telegramApi?.saveBotToken) {
      return;
    }
    setSavingToken(true);
    setError(null);
    try {
      const result = await telegramApi.saveBotToken(tokenInput);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to save Telegram bot token');
      }
      setStatus(result.status || null);
      showNotification(
        t('settings.telegram.messages.tokenSaved', { defaultValue: 'Telegram bot token saved securely.' }),
        'success',
      );
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save Telegram bot token';
      setError(message);
      showNotification(message, 'error');
    } finally {
      setSavingToken(false);
    }
  }, [showNotification, t, telegramApi, tokenInput]);

  const handleBeginPairing = useCallback(async () => {
    if (!telegramApi?.beginPairing) {
      return;
    }
    setPairing(true);
    setError(null);
    try {
      const result = await telegramApi.beginPairing();
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to start Telegram pairing');
      }
      setStatus(result.status || null);
      showNotification(
        t('settings.telegram.messages.pairingStarted', { defaultValue: 'Pairing started. Send the pairing code to your Telegram bot.' }),
        'info',
      );
    } catch (pairingError) {
      const message = pairingError instanceof Error ? pairingError.message : 'Failed to start Telegram pairing';
      setError(message);
      showNotification(message, 'error');
    } finally {
      setPairing(false);
    }
  }, [showNotification, t, telegramApi]);

  const handleDisconnect = useCallback(async () => {
    if (!telegramApi?.disconnect) {
      return;
    }
    setDisconnecting(true);
    setError(null);
    try {
      const result = await telegramApi.disconnect();
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to disconnect Telegram');
      }
      setStatus(result.status || null);
      setTokenInput('');
      showNotification(
        t('settings.telegram.messages.disconnected', { defaultValue: 'Telegram disconnected.' }),
        'info',
      );
    } catch (disconnectError) {
      const message = disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect Telegram';
      setError(message);
      showNotification(message, 'error');
    } finally {
      setDisconnecting(false);
    }
  }, [showNotification, t, telegramApi]);

  const handleSendTest = useCallback(async () => {
    if (!telegramApi?.sendTestMessage) {
      return;
    }
    setSendingTest(true);
    setError(null);
    try {
      const result = await telegramApi.sendTestMessage();
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to send Telegram test message');
      }
      setStatus(result.status || null);
      showNotification(
        t('settings.telegram.messages.testSent', { defaultValue: 'Telegram test message sent.' }),
        'success',
      );
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Failed to send Telegram test message';
      setError(message);
      showNotification(message, 'error');
    } finally {
      setSendingTest(false);
    }
  }, [showNotification, t, telegramApi]);

  const pairingInstruction = useMemo(() => {
    if (!status?.pairingCode || !status?.botUsername) {
      return null;
    }
    return `Open @${status.botUsername} and send: /start ${status.pairingCode}`;
  }, [status?.botUsername, status?.pairingCode]);

  const keepRunningWarning = Boolean(
    settings.enabled
    && backgroundSync?.enabled
    && keepRunningInTray === false,
  );

  if (loading) {
    return (
      <Paper sx={{ p: 3, mb: 4 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <CircularProgress size={20} />
          <Typography variant="body2">
            {t('settings.telegram.loading', { defaultValue: 'Loading Telegram settings…' })}
          </Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <TelegramIcon color="primary" />
        <Typography variant="h6">
          {t('settings.telegram.title', { defaultValue: 'Telegram' })}
        </Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('settings.telegram.description', {
          defaultValue: 'Use a local-only Telegram bot for read-only commands and scheduled sync digests while the desktop app is running.',
        })}
      </Typography>

      {!supportsTelegram && (
        <Alert severity="warning">
          {error || t('settings.telegram.unsupported', { defaultValue: 'Telegram controls are not available in this build.' })}
        </Alert>
      )}

      {supportsTelegram && (
        <Stack spacing={2}>
          <Alert severity="info">
            {t('settings.telegram.localOnly', {
              defaultValue: 'Telegram delivery works only while ShekelSync is running on this machine.',
            })}
          </Alert>

          {keepRunningWarning && (
            <Alert severity="warning">
              {t('settings.telegram.keepRunningWarning', {
                defaultValue: 'Background sync is enabled but the app is allowed to exit on close. Telegram delivery stops when the app process stops.',
              })}
            </Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={status?.configured ? 'Bot token saved' : 'Bot token missing'} color={status?.configured ? 'success' : 'default'} />
            <Chip label={status?.paired ? 'Chat paired' : 'Chat not paired'} color={status?.paired ? 'success' : 'default'} />
            <Chip label={status?.runtimeActive ? 'Runtime active' : 'Runtime idle'} color={status?.runtimeActive ? 'success' : 'default'} />
            <Chip label={settings.pushOnScheduledSync ? 'Scheduled digests on' : 'Scheduled digests off'} color={settings.pushOnScheduledSync ? 'primary' : 'default'} />
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={Boolean(settings.enabled)}
                onChange={(event) => {
                  const nextEnabled = event.target.checked;
                  void saveSettings({ enabled: nextEnabled }).catch((saveError) => {
                    const message = saveError instanceof Error ? saveError.message : 'Failed to update Telegram settings';
                    setError(message);
                    showNotification(message, 'error');
                  });
                }}
                disabled={!status?.paired}
              />
            }
            label={
              <Box>
                <Typography variant="body2" fontWeight="bold">
                  {t('settings.telegram.enableLabel', { defaultValue: 'Enable Telegram bot and scheduled digests' })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('settings.telegram.enableHint', { defaultValue: 'Requires a saved bot token and a paired private chat.' })}
                </Typography>
              </Box>
            }
          />

          <FormControlLabel
            control={
              <Switch
                checked={Boolean(settings.pushOnScheduledSync)}
                onChange={(event) => {
                  void saveSettings({ pushOnScheduledSync: event.target.checked }).catch((saveError) => {
                    const message = saveError instanceof Error ? saveError.message : 'Failed to update Telegram settings';
                    setError(message);
                    showNotification(message, 'error');
                  });
                }}
                disabled={!status?.paired}
              />
            }
            label={
              <Box>
                <Typography variant="body2" fontWeight="bold">
                  {t('settings.telegram.digestLabel', { defaultValue: 'Send scheduled sync digests' })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('settings.telegram.digestHint', { defaultValue: 'Only scheduled syncs send Telegram messages automatically. Manual syncs stay in-app.' })}
                </Typography>
              </Box>
            }
          />

          <TextField
            fullWidth
            type="password"
            label={t('settings.telegram.botTokenLabel', { defaultValue: 'Telegram Bot Token' })}
            placeholder="123456:ABC..."
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            helperText={t('settings.telegram.botTokenHint', {
              defaultValue: 'Stored in encrypted local storage, not in generic app settings.',
            })}
            autoComplete="off"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="contained"
              startIcon={savingToken ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              onClick={() => void handleSaveToken()}
              disabled={savingToken || tokenInput.trim().length === 0}
            >
              {t('settings.telegram.saveToken', { defaultValue: 'Save Bot Token' })}
            </Button>
            <Button
              variant="outlined"
              startIcon={pairing ? <CircularProgress size={16} color="inherit" /> : <LinkIcon />}
              onClick={() => void handleBeginPairing()}
              disabled={pairing || !status?.configured}
            >
              {t('settings.telegram.pairButton', { defaultValue: 'Pair Telegram Chat' })}
            </Button>
            <Button
              variant="outlined"
              startIcon={sendingTest ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
              onClick={() => void handleSendTest()}
              disabled={sendingTest || !status?.paired}
            >
              {t('settings.telegram.testButton', { defaultValue: 'Send Test Message' })}
            </Button>
            <Button
              color="error"
              variant="outlined"
              startIcon={disconnecting ? <CircularProgress size={16} color="inherit" /> : <LinkOffIcon />}
              onClick={() => void handleDisconnect()}
              disabled={disconnecting || (!status?.configured && !status?.paired)}
            >
              {t('settings.telegram.disconnectButton', { defaultValue: 'Disconnect' })}
            </Button>
          </Stack>

          {status?.pairingCode && (
            <Alert severity="info">
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                {t('settings.telegram.pairingCode', { defaultValue: 'Pairing code' })}: {status.pairingCode}
              </Typography>
              {pairingInstruction && (
                <Typography variant="body2">{pairingInstruction}</Typography>
              )}
              {status.pairingExpiresAt && (
                <Typography variant="caption" color="text.secondary">
                  {t('settings.telegram.pairingExpiry', {
                    defaultValue: 'Expires at {{time}}',
                    time: new Date(status.pairingExpiresAt).toLocaleString(),
                  })}
                </Typography>
              )}
            </Alert>
          )}

          {status?.botUsername && (
            <Typography variant="body2">
              {t('settings.telegram.botIdentity', {
                defaultValue: 'Bot: @{{username}}',
                username: status.botUsername,
              })}
            </Typography>
          )}

          {(status?.chatTitle || status?.chatUsername) && (
            <Typography variant="body2">
              {t('settings.telegram.chatIdentity', {
                defaultValue: 'Paired chat: {{chat}}',
                chat: status.chatTitle || status.chatUsername,
              })}
            </Typography>
          )}

          {settings.lastDigestResult?.status && (
            <Alert severity={settings.lastDigestResult.status === 'failed' ? 'error' : 'info'}>
              <Typography variant="body2">
                {t('settings.telegram.lastDigestStatus', {
                  defaultValue: 'Last digest result: {{status}}',
                  status: settings.lastDigestResult.status,
                })}
              </Typography>
              {settings.lastDigestResult.message && (
                <Typography variant="caption" color="text.secondary">
                  {settings.lastDigestResult.message}
                </Typography>
              )}
            </Alert>
          )}

          {status?.lastError && (
            <Alert severity="warning">
              {t('settings.telegram.runtimeError', {
                defaultValue: 'Last Telegram runtime error: {{message}}',
                message: status.lastError,
              })}
            </Alert>
          )}
        </Stack>
      )}
    </Paper>
  );
};

export default TelegramPanel;
