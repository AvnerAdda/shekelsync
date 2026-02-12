import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import LockIcon from '@mui/icons-material/Lock';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import Typography from '@mui/material/Typography';
import ListSubheader from '@mui/material/ListSubheader';
import CircularProgress from '@mui/material/CircularProgress';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { useScrapeProgress } from '@/hooks/useScrapeProgress';
import ModalHeader from './ModalHeader';
import { apiClient } from '@/lib/api-client';
import InstitutionBadge, { InstitutionMetadata, getInstitutionLabel } from '@renderer/shared/components/InstitutionBadge';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '../components/LicenseReadOnlyAlert';

interface ScraperConfig {
  options: {
    companyId: string;
    startDate: Date;
    combineInstallments: boolean;
    showBrowser: boolean;
    additionalTransactionInformation: boolean;
  };
  credentials: {
    // Common fields
    password?: string;
    nickname?: string;
    
    // ID-based authentication
    id?: string;
    
    // Username-based authentication
    username?: string;
    userCode?: string;
    
    // Additional authentication fields
    card6Digits?: string;
    nationalID?: string;
    num?: string;
    identification_code?: string;
    
    // Bank-specific
    bankAccountNumber?: string;
    
    // Email-based (oneZero)
    email?: string;
    otpCode?: string;
    otpToken?: string;
  };
}

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onStart?: () => void;
  onComplete?: () => void;
  initialConfig?: ScraperConfig;
}

const createEmptyCredentials = () => ({
  password: '',
  nickname: '',
  id: '',
  username: '',
  userCode: '',
  card6Digits: '',
  nationalID: '',
  num: '',
  identification_code: '',
  bankAccountNumber: '',
  email: '',
  otpCode: '',
  otpToken: '',
});

const parseCredentialFields = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value));
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value));
      }
    } catch {
      // ignore parse errors
    }
  }
  return [];
};

const formatFieldLabel = (fieldKey: string) =>
  fieldKey
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

const SCRAPER_FIELD_CONFIG: Record<
  string,
  { labelKey: string; type?: string; helperTextKey?: string }
> = {
  username: { labelKey: 'fields.username' },
  password: { labelKey: 'fields.password', type: 'password' },
  userCode: { labelKey: 'fields.userCode' },
  id: { labelKey: 'fields.id' },
  card6Digits: { labelKey: 'fields.card6Digits', helperTextKey: 'fields.card6Helper' },
  bankAccountNumber: { labelKey: 'fields.bankAccountNumber' },
  nationalID: { labelKey: 'fields.nationalID' },
  num: { labelKey: 'fields.num' },
  email: { labelKey: 'fields.email', type: 'email' },
  otpCode: { labelKey: 'fields.otpCode' },
  otpToken: { labelKey: 'fields.otpToken' },
  identification_code: { labelKey: 'fields.identification_code' },
};

const createDefaultConfig = (): ScraperConfig => ({
  options: {
    companyId: '',
    startDate: new Date(),
    combineInstallments: false,
    showBrowser: true,
    additionalTransactionInformation: true
  },
  credentials: createEmptyCredentials(),
});

function formatRetryAfter(retryAfterSeconds?: number): string | null {
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds === undefined || retryAfterSeconds <= 0) {
    return null;
  }
  const seconds = Math.ceil(retryAfterSeconds);
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  const hours = Math.ceil(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function formatLocalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString();
}

export default function SyncModal({ isOpen, onClose, onSuccess, onStart, onComplete, initialConfig }: SyncModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>(undefined);
  const { showNotification } = useNotification();
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'scrapeModal' });
  const [config, setConfig] = useState<ScraperConfig>(initialConfig || createDefaultConfig());
  const [institutions, setInstitutions] = useState<InstitutionMetadata[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [institutionsError, setInstitutionsError] = useState<string | null>(null);
  const { latestEvent, isRunning, lastCompletedAt } = useScrapeProgress();

  const lastCompletedLabel = useMemo(() => {
    if (!lastCompletedAt) {
      return t('status.firstSync');
    }
    return t('status.lastCompleted', { timeAgo: formatDistanceToNow(lastCompletedAt, { addSuffix: true }) });
  }, [lastCompletedAt, t]);

  const primaryActionLabel = isLoading
    ? t('status.primary.starting')
    : isRunning
      ? t('status.primary.inProgress')
      : t('status.primary.start');
  const primaryActionDisabled = isLoading || isRunning;

  const resolvedProgress = useMemo(() => {
    if (typeof latestEvent?.progress !== 'number') {
      return null;
    }
    const value = latestEvent.progress;
    const percentage = value > 1 ? value : value * 100;
    return Math.min(100, Math.max(0, Math.round(percentage)));
  }, [latestEvent]);

  const statusMessage = useMemo(() => {
    if (!isRunning) {
      return lastCompletedLabel;
    }
    const vendorPart = latestEvent?.vendor ? ` ${t('status.forVendor', { vendor: latestEvent.vendor })}` : '';
    const messagePart = latestEvent?.message ? ` – ${latestEvent.message}` : '';
    return `${t('status.inProgress')}${vendorPart}${messagePart}`;
  }, [isRunning, lastCompletedLabel, latestEvent?.vendor, latestEvent?.message, t]);

  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
    }
  }, [initialConfig]);

  useEffect(() => {
    let isMounted = true;

    const loadInstitutions = async () => {
      setInstitutionsLoading(true);
      try {
        const response = await apiClient.get('/api/institutions/tree?scrapable=true');
        if (!response.ok) {
          throw new Error(response.statusText || t('errors.loadInstitutions'));
        }
        const payload = response.data as { nodes?: Array<InstitutionMetadata & { node_type: string }> };
        const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
        const leaves = nodes.filter((n) => n.node_type === 'institution');
        if (leaves.length === 0) {
          throw new Error('No institution leaves returned from tree');
        }
        const normalized = leaves.map((inst: InstitutionMetadata) => ({
          ...inst,
          credentialFieldList: parseCredentialFields(inst.credential_fields),
        }));
        if (isMounted) {
          setInstitutions(normalized);
          setInstitutionsError(null);
        }
      } catch (fetchError) {
        console.error('[SyncModal] Failed to load institution tree, falling back to flat list', fetchError);
        try {
          const fallback = await apiClient.get('/api/institutions?scrapable=true');
          const payload = fallback.data as { institutions?: InstitutionMetadata[]; institution?: InstitutionMetadata };
          const list = Array.isArray(payload?.institutions)
            ? payload.institutions
            : payload?.institution
              ? [payload.institution]
              : [];
          const normalized = list.map((inst: InstitutionMetadata) => ({
            ...inst,
            credentialFieldList: parseCredentialFields(inst.credential_fields),
          }));
          if (isMounted) {
            setInstitutions(normalized);
            setInstitutionsError(null);
          }
        } catch (fallbackError) {
          console.error('[SyncModal] Failed to load institutions', fallbackError);
        if (isMounted) {
          setInstitutions([]);
          setInstitutionsError(t('errors.loadInstitutionsRetry'));
        }
        }
      } finally {
        if (isMounted) {
          setInstitutionsLoading(false);
        }
      }
    };

    loadInstitutions();

    return () => {
      isMounted = false;
    };
  }, [t]);

  useEffect(() => {
    if (initialConfig || config.options.companyId || institutions.length === 0) {
      return;
    }

    setConfig((prev) => ({
      ...prev,
      options: {
        ...prev.options,
        companyId: institutions[0]?.vendor_code || '',
      },
    }));
  }, [initialConfig, institutions, config.options.companyId]);

  const selectedInstitution = useMemo(
    () => institutions.find((inst) => inst.vendor_code === config.options.companyId) || null,
    [institutions, config.options.companyId],
  );

  // Compute the select value - only use companyId if it's in the institutions list
  // This prevents MUI warnings about out-of-range values while institutions are loading
  const selectValue = useMemo(() => {
    if (!config.options.companyId) return '';
    if (institutions.length === 0) return ''; // Still loading
    return institutions.some((inst) => inst.vendor_code === config.options.companyId)
      ? config.options.companyId
      : '';
  }, [config.options.companyId, institutions]);

  const vendorSections = useMemo(() => {
    const sections = [
      { key: 'credit_card', label: 'כרטיסי אשראי - Credit Cards' },
      { key: 'bank', label: 'בנקים - Banks' },
    ];

    return sections
      .map((section) => ({
        ...section,
        institutions: institutions
          .filter((inst) => inst.institution_type === section.key)
          .sort((a, b) => {
            const left = getInstitutionLabel(a) || a.vendor_code;
            const right = getInstitutionLabel(b) || b.vendor_code;
            return left.localeCompare(right, 'he', { sensitivity: 'base' });
          }),
      }))
      .filter((section) => section.institutions.length > 0);
  }, [institutions]);

  useEffect(() => {
    if (!isOpen) {
      setConfig(initialConfig || createDefaultConfig());
      setError(null);
      setIsLoading(false);
      setShowPassword(false);
    }
  }, [isOpen, initialConfig]);

  const handleConfigChange = (field: string, value: any) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setConfig(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent as keyof ScraperConfig],
          [child]: value
        }
      }));
    } else {
      setConfig(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  const handleSync = async () => {
    setIsLoading(true);
    setError(null);
    onStart?.();

    try {
      const response = await apiClient.post('/api/scrape', config);
      if (!response.ok) {
        const errorData = response.data as any;

        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }

        if (response.status === 429) {
          const retryAfter = Number(errorData?.retryAfter);
          const retryIn = formatRetryAfter(retryAfter);
          const nextAllowedAt = formatLocalTimestamp(errorData?.nextAllowedAt);
          const isAccountCooldown = errorData?.reason === 'account_recently_scraped';

          const details = [
            typeof errorData?.message === 'string' && errorData.message.trim().length > 0
              ? errorData.message
              : (isAccountCooldown
                ? 'This account was synced recently and is temporarily cooling down.'
                : 'Too many sync attempts were sent in a short time.'),
            isAccountCooldown
              ? 'This is expected and resets automatically.'
              : null,
            retryIn ? `Please try again in ${retryIn}.` : null,
            nextAllowedAt ? `Next retry time: ${nextAllowedAt}.` : null,
          ]
            .filter(Boolean)
            .join(' ');

          throw new Error(details);
        }

        const backendMessage =
          typeof errorData?.message === 'string' && errorData.message.trim().length > 0
            ? errorData.message
            : (typeof errorData?.error === 'string' && errorData.error.trim().length > 0
              ? errorData.error
              : null);
        throw new Error(backendMessage || response.statusText || t('errors.startFailed'));
      }

      showNotification(t('notifications.syncStarted'), 'success');
      onClose();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setIsLoading(false);
      onComplete?.();
    }
  };

  const renderCredentialFields = () => {
    if (institutionsLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      );
    }

    if (!selectedInstitution) {
      return (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('forms.selectPrompt')}
        </Alert>
      );
    }

    const fields = selectedInstitution.credentialFieldList ?? [];
    const hasExplicitFields = fields.length > 0;
    const finalFields = hasExplicitFields
      ? Array.from(new Set([...fields, 'password']))
      : ['username', 'password'];

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
        {!hasExplicitFields && (
          <Alert severity="info">
            {t('forms.missingMetadata')}
          </Alert>
        )}
        {finalFields.map((fieldKey) => {
          const configEntry = SCRAPER_FIELD_CONFIG[fieldKey] || {
            labelKey: '',
          };
          const label = configEntry.labelKey ? t(configEntry.labelKey) : formatFieldLabel(fieldKey);
          const helperText = configEntry.helperTextKey ? t(configEntry.helperTextKey) : undefined;
          const value = (config.credentials as Record<string, string | undefined>)[fieldKey] ?? '';
          const isPasswordField = fieldKey === 'password';
          const inputType = isPasswordField
            ? (showPassword ? 'text' : 'password')
            : (configEntry.type || 'text');

          return (
            <TextField
              key={`${selectedInstitution.vendor_code}-${fieldKey}`}
              label={label}
              type={inputType}
              value={value}
              onChange={(e) => handleConfigChange(`credentials.${fieldKey}`, e.target.value)}
              fullWidth
              required
              helperText={helperText}
              InputProps={isPasswordField
                ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          onClick={() => setShowPassword((prev) => !prev)}
                          onMouseDown={(event) => event.preventDefault()}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }
                : undefined}
            />
          );
        })}
        <Alert
          severity="info"
          icon={<LockIcon fontSize="small" />}
          sx={{ mt: 1 }}
        >
          {t('security.localStorageWarning')}
        </Alert>
      </Box>
    );
  };

  const renderNewScrapeForm = () => (
    <>
      {institutionsError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {institutionsError}
        </Alert>
      )}
      <FormControl fullWidth>
        <InputLabel>{t('forms.institutionLabel')}</InputLabel>
        <Select
          value={selectValue}
          label={t('forms.institutionLabel')}
          onChange={(e) => {
            const vendor = e.target.value as string;
            setConfig((prev) => ({
              ...prev,
              options: {
                ...prev.options,
                companyId: vendor,
              },
              credentials: {
                ...createEmptyCredentials(),
                nickname: prev.credentials.nickname,
              },
            }));
          }}
          disabled={vendorSections.length === 0 || institutionsLoading}
        >
          {vendorSections.length === 0 ? (
            <MenuItem value="" disabled>
              {institutionsLoading ? t('forms.loadingInstitutions') : t('forms.noInstitutions')}
            </MenuItem>
          ) : (
            [
              !selectValue ? (
                <MenuItem key="placeholder" value="" disabled>
                  {t('forms.selectInstitution')}
                </MenuItem>
              ) : null,
              ...vendorSections.flatMap((section) => [
                <ListSubheader key={`${section.key}-header`}>{section.label}</ListSubheader>,
                ...section.institutions.map((institution) => (
                  <MenuItem key={institution.vendor_code} value={institution.vendor_code}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <InstitutionBadge institution={institution} fallback={institution.vendor_code} />
                      <Typography variant="body2">{getInstitutionLabel(institution)}</Typography>
                    </Box>
                  </MenuItem>
                )),
              ]),
            ]
          )}
        </Select>
      </FormControl>

      {selectedInstitution && (
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <InstitutionBadge institution={selectedInstitution} fallback={selectedInstitution.vendor_code} />
          <Typography variant="caption" color="text.secondary">
            {getInstitutionLabel(selectedInstitution)}
          </Typography>
        </Box>
      )}

      {renderCredentialFields()}
    </>
  );

  const renderExistingAccountForm = () => {
    const creds = config.credentials;
    const institutionFields = selectedInstitution?.credentialFieldList ?? [];
    const hasExplicitFields = institutionFields.length > 0;
    const displayFields = hasExplicitFields
      ? Array.from(new Set([...institutionFields, 'password']))
      : Object.keys(creds).filter((fieldKey) => fieldKey !== 'nickname');
    
    return (
      <>
        {selectedInstitution && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <InstitutionBadge institution={selectedInstitution} fallback={selectedInstitution.vendor_code} />
            <Typography variant="caption" color="text.secondary">
              {getInstitutionLabel(selectedInstitution)}
            </Typography>
          </Box>
        )}
        {creds.nickname && (
          <TextField
            label={t('forms.accountNickname')}
            value={creds.nickname}
            disabled
            fullWidth
          />
        )}
        {displayFields.map((fieldKey) => {
          const value = (creds as Record<string, string | undefined>)[fieldKey] ?? '';
          if (!value) return null;

          const configEntry = SCRAPER_FIELD_CONFIG[fieldKey] || {
            labelKey: '',
          };
          const label = configEntry.labelKey ? t(configEntry.labelKey) : formatFieldLabel(fieldKey);
          const isPasswordField = fieldKey === 'password';

          return (
            <TextField
              key={`existing-${fieldKey}`}
              label={label}
              type={isPasswordField && !showPassword ? 'password' : 'text'}
              value={value}
              fullWidth
              disabled={!isPasswordField}
              InputProps={isPasswordField
                ? {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          onClick={() => setShowPassword((prev) => !prev)}
                          onMouseDown={(event) => event.preventDefault()}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }
                : undefined}
            />
          );
        })}
      </>
    );
  };

  return (
    <>
    <Dialog
      open={isOpen}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        style: {
          backgroundColor: theme.palette.background.paper,
          borderRadius: '24px',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.5)'
            : '0 8px 32px rgba(0, 0, 0, 0.1)'
        }
      }}
    >
      <ModalHeader title={t('title')} onClose={onClose} />
      <DialogContent style={{ padding: '0 24px 24px' }}>
        <Alert
          severity={isRunning ? 'info' : 'success'}
          sx={{ mt: 2 }}
        >
          <Typography variant="body2" fontWeight={500}>
            {statusMessage}
          </Typography>
          {isRunning && (resolvedProgress !== null || typeof latestEvent?.transactions === 'number') && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {resolvedProgress !== null ? t('status.progressLabel', { progress: resolvedProgress }) : null}
              {resolvedProgress !== null && typeof latestEvent?.transactions === 'number' ? ' • ' : ''}
              {typeof latestEvent?.transactions === 'number'
                ? t('status.transactionsSynced', { count: latestEvent.transactions })
                : null}
            </Typography>
          )}
          {isRunning ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('status.background')}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('status.startHint')}
            </Typography>
          )}
        </Alert>

        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
          {initialConfig ? renderExistingAccountForm() : renderNewScrapeForm()}
        </Box>
      </DialogContent>
      <DialogActions style={{ padding: '16px 24px' }}>
        <Button 
          onClick={onClose}
          sx={{ color: theme.palette.text.secondary }}
        >
          {t('actions.cancel')}
        </Button>
        <Button
          onClick={handleSync}
          variant="contained"
          disabled={primaryActionDisabled}
          sx={{
            backgroundColor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            padding: '8px 24px',
            borderRadius: '8px',
            textTransform: 'none',
            fontWeight: 500,
            '&:hover': {
              backgroundColor: theme.palette.primary.dark,
            }
          }}
        >
          {primaryActionLabel}
        </Button>
      </DialogActions>
    </Dialog>

    {/* License Read-Only Alert */}
    <LicenseReadOnlyAlert
      open={licenseAlertOpen}
      onClose={() => setLicenseAlertOpen(false)}
      reason={licenseAlertReason}
    />
    </>
  );
} 
