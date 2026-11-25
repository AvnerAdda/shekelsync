import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';

type Step = 'phone' | 'code';

interface StartVerificationResponse {
  sessionId: string;
  expiresAt: string;
  maskedPhoneNumber: string;
}

interface VerificationErrorBody {
  error?: string;
  code?: string | null;
  attemptsRemaining?: number;
}

const KNOWN_ERROR_CODES = new Set([
  'invalid_phone_number',
  'sms_send_failed',
  'invalid_code',
  'code_rejected',
  'too_many_attempts',
  'session_expired',
  'session_not_found',
]);

// Errors after which the current SMS can no longer be used.
const RESTART_ERROR_CODES = new Set(['too_many_attempts', 'session_expired', 'session_not_found']);

export interface OneZeroVerificationDialogProps {
  open: boolean;
  credentialId: number | null;
  accountLabel?: string | null;
  onClose: () => void;
  onVerified: () => void;
}

export function OneZeroVerificationDialog({
  open,
  credentialId,
  accountLabel,
  onClose,
  onVerified,
}: OneZeroVerificationDialogProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'accountsModal.oneZeroVerification' });
  const [step, setStep] = useState<Step>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [session, setSession] = useState<StartVerificationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('phone');
      setCode('');
      setSession(null);
      setError(null);
      setBusy(false);
    }
  }, [open, credentialId]);

  const describeError = (body: VerificationErrorBody | null | undefined) => {
    const errorCode = body?.code || '';
    if (KNOWN_ERROR_CODES.has(errorCode)) {
      return t(`errors.${errorCode}`, { count: body?.attemptsRemaining ?? 0 });
    }
    return t('errors.generic');
  };

  const handleSendCode = async () => {
    if (!credentialId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<StartVerificationResponse | VerificationErrorBody>(
        `/api/credentials/${credentialId}/one-zero/verification`,
        { phoneNumber },
      );
      if (!response.ok) {
        setError(describeError(response.data as VerificationErrorBody));
        return;
      }
      setSession(response.data as StartVerificationResponse);
      setCode('');
      setStep('code');
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!credentialId || !session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<{ verified: boolean } | VerificationErrorBody>(
        `/api/credentials/${credentialId}/one-zero/verification/confirm`,
        { sessionId: session.sessionId, code },
      );
      if (!response.ok) {
        const body = response.data as VerificationErrorBody;
        setError(describeError(body));
        if (RESTART_ERROR_CODES.has(body?.code || '')) {
          setSession(null);
          setStep('phone');
        }
        return;
      }
      onVerified();
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const canSend = phoneNumber.trim().length >= 9;
  const canVerify = /^\d{4,8}$/.test(code.replace(/\s+/g, ''));

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {accountLabel ? (
            <Typography variant="subtitle2" color="text.secondary">
              {accountLabel}
            </Typography>
          ) : null}
          <Typography variant="body2">{t('intro')}</Typography>

          {step === 'phone' ? (
            <TextField
              label={t('phoneLabel')}
              placeholder={t('phonePlaceholder')}
              helperText={t('phoneHelper')}
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSend) {
                  event.preventDefault();
                  void handleSendCode();
                }
              }}
              type="tel"
              autoComplete="tel"
              autoFocus
              fullWidth
              disabled={busy}
              slotProps={{ htmlInput: { dir: 'ltr', 'data-testid': 'one-zero-phone' } }}
            />
          ) : (
            <>
              <Typography variant="body2">
                {t('codeSentTo', { phone: session?.maskedPhoneNumber ?? '' })}
              </Typography>
              <TextField
                label={t('codeLabel')}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, ''))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canVerify) {
                    event.preventDefault();
                    void handleVerify();
                  }
                }}
                autoComplete="one-time-code"
                autoFocus
                fullWidth
                disabled={busy}
                slotProps={{
                  htmlInput: { dir: 'ltr', inputMode: 'numeric', maxLength: 10, 'data-testid': 'one-zero-code' },
                }}
              />
            </>
          )}

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('actions.later')}
        </Button>
        {step === 'code' ? (
          <Button onClick={handleSendCode} disabled={busy}>
            {t('actions.resend')}
          </Button>
        ) : null}
        {step === 'phone' ? (
          <Button
            variant="contained"
            onClick={handleSendCode}
            disabled={busy || !canSend}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {busy ? t('actions.sending') : t('actions.sendCode')}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleVerify}
            disabled={busy || !canVerify}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {busy ? t('actions.verifying') : t('actions.verify')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default OneZeroVerificationDialog;
