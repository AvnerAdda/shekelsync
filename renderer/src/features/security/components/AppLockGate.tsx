import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import { useTranslation } from 'react-i18next';
import { signalStartupReady } from '@renderer/app/startup/startup-readiness';

type LockStatus = 'checking' | 'locked' | 'unlocked';
type LockMethod = 'touchid' | 'password' | 'windows-hello';

function getAppLockBridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.appLock : undefined;
}

/**
 * Shows the lock screen until the main process reports the app unlocked.
 * The main process enforces the lock (it refuses data requests while locked);
 * this gate only keeps the app shell, and its data requests, from mounting.
 */
const AppLockGate: React.FC<PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<LockStatus>(() => (getAppLockBridge()?.getState ? 'checking' : 'unlocked'));
  const [method, setMethod] = useState<LockMethod | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [errorKey, setErrorKey] = useState<'cancelled' | 'failed' | null>(null);
  const autoPromptedRef = useRef(false);

  const unlock = useCallback(async () => {
    const bridge = getAppLockBridge();
    if (!bridge?.unlock) return;
    setUnlocking(true);
    setErrorKey(null);
    try {
      const result = await bridge.unlock();
      if (result?.success && result.locked === false) {
        setStatus('unlocked');
        return;
      }
      setErrorKey(result?.cancelled ? 'cancelled' : 'failed');
    } catch {
      setErrorKey('failed');
    } finally {
      setUnlocking(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'checking') return undefined;
    let cancelled = false;
    const bridge = getAppLockBridge();

    (async () => {
      try {
        const state = await bridge?.getState?.();
        if (cancelled) return;
        if (state?.success && state.locked === false) {
          setStatus('unlocked');
          return;
        }
        setMethod(state?.method ?? null);
      } catch {
        // Fail closed: unlocking asks the main process, which knows the real state.
      }
      if (!cancelled) setStatus('locked');
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'locked') return;
    signalStartupReady();
    if (!autoPromptedRef.current) {
      autoPromptedRef.current = true;
      void unlock();
    }
  }, [status, unlock]);

  if (status === 'unlocked') return <>{children}</>;
  // The native startup shell stays visible while the lock state resolves.
  if (status === 'checking') return null;

  return <LockScreen method={method} unlocking={unlocking} errorKey={errorKey} onUnlock={unlock} />;
};

interface LockScreenProps {
  method: LockMethod | null;
  unlocking: boolean;
  errorKey: 'cancelled' | 'failed' | null;
  onUnlock: () => void;
}

const LockScreen: React.FC<LockScreenProps> = ({ method, unlocking, errorKey, onUnlock }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'appLock' });
  const isMacOS = Boolean(window.electronAPI?.platform?.isMacOS);
  const descriptionKey = method ?? (isMacOS ? 'touchid' : 'windows-hello');
  const MethodIcon = method === 'password' ? LockOutlinedIcon : FingerprintIcon;

  return (
    <Box
      data-testid="app-lock-screen"
      sx={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        bgcolor: 'background.default',
        WebkitAppRegion: 'drag',
      }}
    >
      {!isMacOS && (
        <Box sx={{ position: 'absolute', top: 8, insetInlineEnd: 8, display: 'flex', gap: 0.5, WebkitAppRegion: 'no-drag' }}>
          <IconButton size="small" aria-label={t('minimize')} onClick={() => void window.electronAPI?.window?.minimize?.()}>
            <RemoveIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label={t('close')} onClick={() => void window.electronAPI?.window?.close?.()}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      <Paper
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: 4,
          textAlign: 'center',
          borderRadius: 3,
          border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
          WebkitAppRegion: 'no-drag',
        }}
      >
        <Box
          sx={{
            mx: 'auto',
            mb: 2,
            width: 64,
            height: 64,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.1),
          }}
        >
          <MethodIcon sx={{ fontSize: 36 }} />
        </Box>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
          {t('title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t(`description.${descriptionKey}`)}
        </Typography>

        {errorKey && (
          <Alert severity={errorKey === 'cancelled' ? 'info' : 'error'} sx={{ mb: 2, textAlign: 'start' }}>
            {t(errorKey)}
          </Alert>
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={onUnlock}
          disabled={unlocking}
          startIcon={unlocking ? <CircularProgress size={18} color="inherit" /> : <MethodIcon />}
        >
          {unlocking ? t('unlocking') : t('unlock')}
        </Button>
      </Paper>
    </Box>
  );
};

export default AppLockGate;
