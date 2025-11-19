import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { startOfMonth, subMonths } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Box,
  Button,
  TextField,
  MenuItem,
  styled,
  Typography,
  Chip,
  Tooltip,
  Tabs,
  Tab,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Alert,
  InputAdornment,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import LockIcon from '@mui/icons-material/Lock';
import BusinessIcon from '@mui/icons-material/Business';
import PortfolioIcon from '@mui/icons-material/AccountBalanceWallet';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CircularProgress from '@mui/material/CircularProgress';
import SyncModal from './ScrapeModal';
import AccountPairingModal from './AccountPairingModal';
import InvestmentAccountSuggestionsCard from '@renderer/features/investments/components/InvestmentAccountSuggestionsCard';
import CreditCardSuggestionsCard from '@renderer/features/investments/components/CreditCardSuggestionsCard';
import SmartInvestmentAccountForm from '@renderer/features/investments/components/SmartInvestmentAccountForm';
import {
  CREDIT_CARD_VENDORS,
  BANK_VENDORS,
  SPECIAL_BANK_VENDORS,
  OTHER_BANK_VENDORS,
  ACCOUNT_CATEGORIES,
  INVESTMENT_ACCOUNT_TYPES
} from '@app/utils/constants';
import type { AccountCategory } from '@app/utils/constants';
import { formatDate } from '@app/utils/date';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import ModalHeader from './ModalHeader';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import { calculateSimilarity } from '@app/utils/account-matcher';
import { apiClient } from '@/lib/api-client';
import InstitutionBadge, { InstitutionMetadata, getInstitutionLabel } from '@renderer/shared/components/InstitutionBadge';

const CREDIT_CARD_VENDOR_LABELS: Record<string, string> = {
  isracard: 'Isracard',
  amex: 'American Express',
  visaCal: 'Visa Cal',
  max: 'Max',
};

const BANK_VENDOR_LABELS: Record<string, string> = {
  hapoalim: 'Bank Hapoalim',
  leumi: 'Bank Leumi',
  discount: 'Discount Bank',
  mizrahi: 'Mizrahi Tefahot',
  otsarHahayal: 'Otsar Hahayal',
  beinleumi: 'Beinleumi',
  massad: 'Massad',
  yahav: 'Bank Yahav',
  union: 'Union Bank',
  mercantile: 'Mercantile Bank',
  beyahadBishvilha: 'Beyahad Bishvilha',
  behatsdaa: 'Behatsdaa',
  pagi: 'Pagi',
  oneZero: 'One Zero',
};

const toFallbackInstitution = (vendor: string, type: 'bank' | 'credit_card'): InstitutionMetadata => {
  const label = type === 'bank'
    ? BANK_VENDOR_LABELS[vendor] || vendor
    : CREDIT_CARD_VENDOR_LABELS[vendor] || vendor;

  return {
    id: -1,
    vendor_code: vendor,
    display_name_he: label,
    display_name_en: label,
    institution_type: type,
  };
};

export interface Account {
  id: number;
  vendor: string;
  institution_id?: number | null;
  username?: string;
  userCode?: string;
  id_number?: string;
  card6_digits?: string;
  bank_account_number?: string;
  accountNumbers?: string[]; // Account numbers from transactions
  identification_code?: string;
  num?: string;
  nationalID?: string;
  email?: string;
  otpCode?: string;
  otpToken?: string;
  nickname?: string;
  password?: string;
  created_at: string;
  lastUpdate?: string;
  lastScrapeStatus?: string;
  current_balance?: number;
  balance_updated_at?: string;
  suggestedStartDate?: string;
  startDateMessage?: string;
  institution?: InstitutionMetadata | null;
}

const createEmptyCredentialAccount = (): Account => ({
  vendor: '',
  institution_id: null,
  username: '',
  userCode: '',
  id_number: '',
  card6_digits: '',
  bank_account_number: '',
  accountNumbers: [],
  identification_code: '',
  num: '',
  nationalID: '',
  email: '',
  otpCode: '',
  otpToken: '',
  nickname: '',
  password: '',
  id: 0,
  created_at: new Date().toISOString(),
});

const resetAccountCredentialFields = (account: Account): Account => ({
  ...account,
  username: '',
  userCode: '',
  id_number: '',
  card6_digits: '',
  bank_account_number: '',
  identification_code: '',
  num: '',
  nationalID: '',
  email: '',
  otpCode: '',
  otpToken: '',
  password: '',
});

const getAccountInstitutionMeta = (account: Account): InstitutionMetadata | null => {
  if (account.institution && typeof account.institution !== 'string') {
    return account.institution as InstitutionMetadata;
  }
  if ((account as any).institutionObj && typeof (account as any).institutionObj !== 'string') {
    return (account as any).institutionObj as InstitutionMetadata;
  }
  return null;
};

const isAccountOfType = (account: Account, expectedType: 'bank' | 'credit_card'): boolean => {
  const institution = getAccountInstitutionMeta(account);
  if (institution?.institution_type) {
    return institution.institution_type === expectedType;
  }

  if (expectedType === 'credit_card') {
    return CREDIT_CARD_VENDORS.includes(account.vendor);
  }

  return (
    BANK_VENDORS.includes(account.vendor) ||
    SPECIAL_BANK_VENDORS.includes(account.vendor) ||
    OTHER_BANK_VENDORS.includes(account.vendor)
  );
};

const CREDENTIAL_FIELD_CONFIG: Record<
  string,
  { key: keyof Account; label: string; type?: string; helperText?: string }
> = {
  username: { key: 'username', label: 'Username' },
  password: { key: 'password', label: 'Password', type: 'password' },
  userCode: { key: 'userCode', label: 'User Code' },
  id: { key: 'id_number', label: 'ID Number' },
  card6Digits: { key: 'card6_digits', label: 'Card last 6 digits', helperText: 'Last 6 digits printed on the card' },
  bankAccountNumber: { key: 'bank_account_number', label: 'Bank Account Number' },
  nationalID: { key: 'nationalID', label: 'National ID' },
  num: { key: 'num', label: 'Identification code (num)' },
  email: { key: 'email', label: 'Email Address' },
  otpCode: { key: 'otpCode' as keyof Account, label: 'OTP Code' },
  otpToken: { key: 'otpToken' as keyof Account, label: 'OTP Token' },
  identification_code: { key: 'identification_code', label: 'Identification Code' },
};

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

const formatFieldLabel = (fieldKey: string) => {
  return fieldKey
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
};

interface InvestmentAccount {
  id?: number;
  account_name: string;
  account_type: string;
  institution?: string | InstitutionMetadata | null; // Legacy string field or populated object
  account_number?: string;
  currency: string;
  notes?: string;
  is_liquid?: boolean;
  investment_category?: string;
  current_value?: number;
  current_value_explicit?: number | null;
  total_invested?: number | null;
  holdings_count?: number;
  last_update_date?: string;
  institution_id?: number | null;
  institutionObj?: InstitutionMetadata | null; // Backward compatibility for older API payloads
}

interface AccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const getBankingAccountValidationError = (
  account: Account,
  institution?: (InstitutionMetadata & { credentialFieldList?: string[] }) | null,
): string | null => {
  if (!account.vendor) {
    return 'Please select a known institution';
  }

  if (!institution || !institution.id || institution.id < 0) {
    return 'Please select a known institution';
  }

  if (!account.password) {
    return 'Password is required';
  }

  if (!account.nickname) {
    return 'Account nickname is required';
  }

  const credentialFields = institution?.credentialFieldList;
  if (credentialFields && credentialFields.length > 0) {
    for (const fieldKey of credentialFields) {
      const mapping = CREDENTIAL_FIELD_CONFIG[fieldKey];
      if (!mapping) continue;
      const value = account[mapping.key];
      if (!value || String(value).trim().length === 0) {
        const institutionName = institution?.display_name_en || institution?.display_name_he || account.vendor;
        return `${mapping.label} is required for ${institutionName}`;
      }
    }
    return null;
  }

  if (!account.username) {
    return 'Username is required';
  }

  return null;
};

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:nth-of-type(odd)': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const buildInitialSyncPayload = (account: Account) => {
  const startDate = startOfMonth(subMonths(new Date(), 3));
  const scrapeCredentials: Record<string, string> = {};

  if (account.id_number) scrapeCredentials.id = account.id_number;
  if (account.password) scrapeCredentials.password = account.password;
  if (account.username) scrapeCredentials.username = account.username;
  if (account.userCode) scrapeCredentials.userCode = account.userCode;
  if (account.email) scrapeCredentials.email = account.email;
  if (account.card6_digits) scrapeCredentials.card6Digits = account.card6_digits;
  if (account.num) scrapeCredentials.num = account.num;
  if (account.nationalID) scrapeCredentials.nationalID = account.nationalID;
  if (account.identification_code) scrapeCredentials.identification_code = account.identification_code;
  scrapeCredentials.nickname = account.nickname ?? '';

  return {
    options: {
      companyId: account.vendor,
      startDate: startDate.toISOString(),
      combineInstallments: false,
      showBrowser: true,
      additionalTransactionInformation: true,
    },
    credentials: scrapeCredentials,
  };
};

const SectionHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '20px 0 16px 0',
  marginBottom: '20px',
  borderBottom: `2px solid ${theme.palette.divider}`,
  background: theme.palette.mode === 'dark' 
    ? 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)'
    : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
  borderRadius: '8px 8px 0 0',
  marginLeft: '-16px',
  marginRight: '-16px',
  paddingLeft: '16px',
  paddingRight: '16px',
  '& .MuiTypography-root': {
    fontWeight: 600,
    fontSize: '20px',
  },
}));

const AccountSection = styled(Box)(({ theme }) => ({
  marginBottom: '40px',
  padding: '16px',
  borderRadius: '12px',
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.default,
  '&:last-child': {
    marginBottom: 0,
  },
}));

export default function AccountsModal({ isOpen, onClose }: AccountsModalProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionMetadata[]>([]);
  const institutionMap = useMemo(() => {
    const map = new Map<string, InstitutionMetadata>();
    institutions.forEach((institution) => {
      map.set(institution.vendor_code, institution);
    });
    return map;
  }, [institutions]);
  const [, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentAccountType, setCurrentAccountType] = useState<'banking' | 'investment'>('banking');
  const [expandedForm, setExpandedForm] = useState<'creditCard' | 'bank' | null>(null);
  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
  const [pendingSuggestionTransactions, setPendingSuggestionTransactions] = useState<any[]>([]);
  const { showNotification} = useNotification();
  const { refetch: refetchOnboardingStatus } = useOnboarding();
  const [newAccount, setNewAccount] = useState<Account>(() => createEmptyCredentialAccount());

  const [newInvestmentAccount, setNewInvestmentAccount] = useState<InvestmentAccount>({
    account_name: '',
    account_type: 'brokerage',
    currency: 'ILS',
    institution: '',
    account_number: '',
    notes: '',
    institution_id: null,
  });

  const creditCardInstitutionOptions = useMemo(() => {
    const sorted = institutions
      .filter((institution) => institution.institution_type === 'credit_card')
      .sort((a, b) => {
        const left = getInstitutionLabel(a) || a.vendor_code;
        const right = getInstitutionLabel(b) || b.vendor_code;
        return left.localeCompare(right, 'he', { sensitivity: 'base' });
      });

    if (sorted.length > 0) {
      return sorted;
    }

    return CREDIT_CARD_VENDORS.map((vendor) => toFallbackInstitution(vendor, 'credit_card'));
  }, [institutions]);

  const bankInstitutionOptions = useMemo(() => {
    const sorted = institutions
      .filter((institution) => institution.institution_type === 'bank')
      .sort((a, b) => {
        const left = getInstitutionLabel(a) || a.vendor_code;
        const right = getInstitutionLabel(b) || b.vendor_code;
        return left.localeCompare(right, 'he', { sensitivity: 'base' });
      });

    if (sorted.length > 0) {
      return sorted;
    }

    const fallbackVendors = [...BANK_VENDORS, ...SPECIAL_BANK_VENDORS, ...OTHER_BANK_VENDORS];
    return fallbackVendors.map((vendor) => toFallbackInstitution(vendor, 'bank'));
  }, [institutions]);

  const investmentInstitutionOptions = useMemo(() => {
    const allowedTypes = new Set(['investment', 'insurance', 'broker', 'crypto']);
    return institutions
      .filter((institution) => allowedTypes.has(institution.institution_type))
      .sort((a, b) => {
        const left = getInstitutionLabel(a) || a.vendor_code;
        const right = getInstitutionLabel(b) || b.vendor_code;
        return left.localeCompare(right, 'he', { sensitivity: 'base' });
      });
  }, [institutions]);

  useEffect(() => {
    if (newAccount.vendor) {
      return;
    }

    const fallbackInstitution =
      creditCardInstitutionOptions.find((institution) => institution.id && institution.id > 0) ||
      bankInstitutionOptions.find((institution) => institution.id && institution.id > 0);

    if (fallbackInstitution) {
      setNewAccount((prev) => ({
        ...prev,
        vendor: fallbackInstitution.vendor_code,
        institution_id: fallbackInstitution.id ?? null,
      }));
    }
  }, [bankInstitutionOptions, creditCardInstitutionOptions, newAccount.vendor]);

  const findInstitutionByVendor = useCallback(
    (vendor?: string | null) => {
      if (!vendor) return undefined;
      return institutionMap.get(vendor);
    },
    [institutionMap],
  );

  const renderCredentialFieldInputs = useCallback(
    (institution?: InstitutionMetadata | null) => {
      if (!institution) {
        return (
          <Grid item xs={12}>
            <Alert severity="info">Select an institution to see the required credentials.</Alert>
          </Grid>
        );
      }

      const fields = institution.credentialFieldList;
      const hasExplicitFields = Array.isArray(fields) && fields.length > 0;
      const finalFields = hasExplicitFields
        ? Array.from(new Set([...(fields || []), 'password']))
        : ['username', 'password'];

      const inputs = finalFields.map((fieldKey) => {
        const config =
          CREDENTIAL_FIELD_CONFIG[fieldKey] || ({
            key: fieldKey as keyof Account,
            label: formatFieldLabel(fieldKey),
          } as { key: keyof Account; label: string; type?: string; helperText?: string });
        const value = (newAccount[config.key] as string) ?? '';
        return (
          <Grid item xs={12} key={`${institution.vendor_code}-${fieldKey}`}>
            <TextField
              fullWidth
              label={config.label}
              type={config.type || 'text'}
              value={value}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, [config.key]: e.target.value }))}
              required
              helperText={config.helperText}
            />
          </Grid>
        );
      });

      if (!hasExplicitFields) {
        return [
          (
            <Grid item xs={12} key={`${institution.vendor_code}-fallback-info`}>
              <Alert severity="info">
                No specific credential requirements configured. Please provide a username and password.
              </Alert>
            </Grid>
          ),
          ...inputs,
        ];
      }

      return inputs;
    },
    [newAccount],
  );

  // Holdings management state
  const [existingInvestments, setExistingInvestments] = useState<any>(null);

  // Additional modal states for new features
  const [showValueUpdateModal, setShowValueUpdateModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetTab, setAssetTab] = useState(0);
  const [isAddingAsset, setIsAddingAsset] = useState(false);
  const [showSmartForm, setShowSmartForm] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<any>(null);

  // Value update state
  const [valueUpdate, setValueUpdate] = useState({
    accountId: '',
    currentValue: '',
    asOfDate: new Date().toISOString().split('T')[0],
    costBasis: '',
    currency: 'ILS',
    notes: '',
  });

  // Asset tracking state
  const [assets, setAssets] = useState<any[]>([]);
  const [assetHistory, setAssetHistory] = useState<any[]>([]);
  const [newAsset, setNewAsset] = useState({
    accountId: '',
    symbol: '',
    quantity: '',
    avgPrice: '',
    asOfDate: new Date().toISOString().split('T')[0],
  });

  // Confirmation dialog state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<{
    id: number;
    type: 'banking' | 'investment';
    name: string;
  } | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const accountsResponse = await apiClient.get('/api/accounts/last-update');
      if (!accountsResponse.ok) {
        throw new Error(accountsResponse.statusText || 'Failed to fetch accounts');
      }
      const accountsWithUpdates = Array.isArray(accountsResponse.data)
        ? accountsResponse.data
        : [];

      const credentialsResponse = await apiClient.get('/api/credentials');
      if (!credentialsResponse.ok) {
        throw new Error(credentialsResponse.statusText || 'Failed to fetch credentials');
      }
      const credentialsData = credentialsResponse.data as any;
      const credentials = Array.isArray(credentialsData) ? credentialsData : credentialsData?.items ?? [];

      const mergedAccounts = accountsWithUpdates.map((account: any) => {
        const credential = credentials.find((c: any) => c.id === account.id);
        return {
          ...credential,
          lastUpdate: account.lastUpdate,
          lastScrapeStatus: account.lastScrapeStatus,
          accountNumbers: account.accountNumbers || [], // Include account numbers from transactions
        };
      });

      console.log('Fetched accounts with updates:', mergedAccounts);
      setAccounts(mergedAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchInvestmentAccounts = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/investments/accounts');
      if (response.ok) {
        const data = response.data as any;
        setInvestmentAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      }
    } catch (err) {
      console.error('Error loading investment accounts:', err);
    }
  }, []);

  const fetchInstitutions = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/institutions');
      if (response.ok) {
        const payload = response.data as any;
        const list = Array.isArray(payload?.institutions)
          ? payload.institutions
          : (payload?.institution ? [payload.institution] : []);
        const normalized = list.map((inst: InstitutionMetadata) => ({
          ...inst,
          credentialFieldList: parseCredentialFields(inst.credential_fields),
        }));
        setInstitutions(normalized);
      }
    } catch (err) {
      console.error('Error loading institutions:', err);
    }
  }, []);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setIsAdding(false); // Close add form when switching tabs
    setError(null);
  };

  const handleAdd = async () => {
    if (currentAccountType === 'banking') {
      return handleAddBankingAccount();
    } else {
      return handleAddInvestmentAccount();
    }
  };

  const handleAddBankingAccount = async () => {
    const institution =
      newAccount.vendor && institutionMap.has(newAccount.vendor)
        ? institutionMap.get(newAccount.vendor)
        : undefined;
    const normalizedInstitution =
      institution && institution.id && institution.id > 0 ? institution : null;

    const accountPayload: Account = {
      ...newAccount,
      vendor: normalizedInstitution?.vendor_code || newAccount.vendor,
      institution_id: normalizedInstitution?.id ?? newAccount.institution_id ?? null,
    };

    const validationError = getBankingAccountValidationError(
      accountPayload,
      normalizedInstitution
        ? { ...normalizedInstitution, credentialFieldList: normalizedInstitution.credentialFieldList }
        : null,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!normalizedInstitution) {
      setError('Unable to resolve the selected institution. Please refresh the list and try again.');
      return;
    }

    try {
      const response = await apiClient.post('/api/credentials', accountPayload);

      if (!response.ok) {
        throw new Error('Failed to add account');
      }

      await fetchAccounts();
      await refetchOnboardingStatus();

      showNotification('Account added! Starting initial sync for last 3 months...', 'info');
      setIsSyncing(true);

      const syncAccount = { ...accountPayload };
      setTimeout(async () => {
        try {
          const scrapeConfig = buildInitialSyncPayload(syncAccount);
          const syncStartDate = new Date(scrapeConfig.options.startDate);

          console.log(
            '[Auto-sync] Starting 3-month sync for:',
            syncAccount.vendor,
            'from:',
            syncStartDate.toISOString(),
          );

          showNotification('Syncing transactions... This may take a few minutes.', 'info');

          const scrapeResponse = await apiClient.post('/api/scrape', scrapeConfig);
          const scrapeResult = scrapeResponse.data as any;

          if (scrapeResponse.ok && !(scrapeResult && scrapeResult.error)) {
            let transactionCount = 0;
            if (scrapeResult.accounts) {
              transactionCount = scrapeResult.accounts.reduce((sum: number, acc: any) => {
                return sum + (acc.txns ? acc.txns.length : 0);
              }, 0);
            }

            showNotification(
              `Initial sync complete! ${transactionCount} transactions imported from last 3 months.`,
              'success',
            );

            window.dispatchEvent(new CustomEvent('dataRefresh'));
            await refetchOnboardingStatus();
          } else {
            showNotification('Sync started in background. Check notifications for updates.', 'info');
          }
        } catch (syncErr) {
          console.error('[Auto-sync] Error:', syncErr);
          showNotification('Initial sync started in background', 'info');
        } finally {
          setIsSyncing(false);
        }
      }, 1000);

      setNewAccount(createEmptyCredentialAccount());
      setIsAdding(false);
      showNotification('Account added successfully!', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsSyncing(false);
    }
  };

  const handleSuggestionClick = (suggestion: any) => {
    // Open the smart form with the suggestion data
    setSelectedSuggestion(suggestion);
    setShowSmartForm(true);
  };

  const handleSmartFormSuccess = () => {
    // Refresh investment accounts and suggestions
    fetchInvestmentAccounts();
    window.dispatchEvent(new CustomEvent('dataRefresh'));
    setShowSmartForm(false);
    setSelectedSuggestion(null);
  };

  const handleSuggestionClickOld = (suggestion: any) => {
    // Switch to investment tab
    setCurrentAccountType('investment');

    // Set adding mode
    setIsAdding(true);

    const suggestedInstitution = findInstitutionByVendor(
      suggestion.suggestedInstitutionVendor || suggestion.suggestedAccountType
    );

    // Pre-populate the form with suggestion data
    setNewInvestmentAccount({
      account_name: suggestion.categoryName || suggestion.suggestedAccountName,
      account_type: suggestion.suggestedAccountType || 'other',
      currency: 'ILS',
      institution: suggestion.suggestedInstitution || '',
      account_number: '',
      notes: `Created from smart suggestion (${suggestion.transactionCount} transactions)`,
      institution_id: suggestedInstitution?.id ?? null,
    });

    // Store transactions for later linking
    setPendingSuggestionTransactions(suggestion.transactions || []);
  };

  const handleAddInvestmentAccount = async () => {
    if (!newInvestmentAccount.account_name || !newInvestmentAccount.account_type) {
      setError('Please enter account name and type');
      return;
    }

     if (!newInvestmentAccount.institution_id) {
       console.warn('[AccountsModal] Creating investment account without institution_id', newInvestmentAccount.account_type);
       showNotification('Link this investment to a known institution for richer analytics.', 'info');
     }

    try {
      const response = await apiClient.post('/api/investments/accounts', newInvestmentAccount);

      if (response.ok) {
        const data = response.data as any;
        const newAccountId = data.id;

        // Auto-link transactions if this came from a suggestion
        if (pendingSuggestionTransactions.length > 0 && newAccountId) {
          try {
            let successCount = 0;
            for (const txn of pendingSuggestionTransactions) {
              const linkResponse = await apiClient.post('/api/investments/transaction-links', {
                transaction_identifier: txn.transactionIdentifier,
                transaction_vendor: txn.transactionVendor,
                account_id: newAccountId,
                link_method: 'suggestion',
                confidence: 0.9
              });
              if (linkResponse.ok) successCount++;
            }
            showNotification(`Account created and ${successCount} transactions linked`, 'success');
            setPendingSuggestionTransactions([]);
          } catch (linkError) {
            console.error('Error linking transactions:', linkError);
            showNotification('Account created but failed to link some transactions', 'warning');
          }
        } else {
          showNotification('Investment account added successfully', 'success');
        }

        await fetchInvestmentAccounts();
        setNewInvestmentAccount({
          account_name: '',
          account_type: 'brokerage',
          currency: 'ILS',
          institution: '',
          account_number: '',
          notes: '',
          institution_id: null,
        });
        setIsAdding(false);
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        throw new Error('Failed to add investment account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  // Show confirmation dialog before deleting
  const confirmDelete = (account: Account | InvestmentAccount, type: 'banking' | 'investment') => {
    const accountName = type === 'banking'
      ? (account as Account).nickname || 'Unnamed Account'
      : (account as InvestmentAccount).account_name || 'Unnamed Investment';

    setAccountToDelete({
      id: account.id!,
      type,
      name: accountName
    });
    setConfirmDeleteOpen(true);
  };

  // Actual delete functions
  const handleDelete = async (accountID: number) => {
    try {
      const response = await apiClient.delete(`/api/credentials/${accountID}`);
      if (response.ok) {
        setAccounts(accounts.filter((account) => account.id !== accountID));
        showNotification('Banking account deleted successfully', 'success');
      } else {
        throw new Error('Failed to delete account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDeleteInvestmentAccount = async (accountID: number) => {
    try {
      const response = await apiClient.delete(`/api/investments/accounts?id=${accountID}`);
      if (response.ok) {
        setInvestmentAccounts(investmentAccounts.filter((account) => account.id !== accountID));
        showNotification('Investment account deleted successfully', 'success');
      } else {
        throw new Error('Failed to delete investment account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  // Handle confirmed deletion
  const handleConfirmDelete = async () => {
    if (!accountToDelete) return;

    if (accountToDelete.type === 'banking') {
      await handleDelete(accountToDelete.id);
    } else {
      await handleDeleteInvestmentAccount(accountToDelete.id);
    }

    setConfirmDeleteOpen(false);
    setAccountToDelete(null);
  };

  // Existing investments matching functionality
  const loadExistingInvestments = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/investments/check-existing');
      if (response.ok) {
        setExistingInvestments(response.data as any);
      }
    } catch (err) {
      console.error('Error loading existing investments:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchAccounts();
      fetchInvestmentAccounts();
      loadExistingInvestments();
      fetchInstitutions();
    }
  }, [isOpen, fetchAccounts, fetchInvestmentAccounts, loadExistingInvestments, fetchInstitutions]);

  // Check if account name matches existing investment transactions
  const isExistingInvestment = (accountName: string): { match: boolean; category?: string; count?: number; confidence?: number } => {
    if (!existingInvestments || !accountName) return { match: false };

    // PRIORITY 1: Check if account has actual linked transactions
    const linkedAccounts = existingInvestments.linkedAccounts || [];
    for (const linked of linkedAccounts) {
      const nameSimilarity = calculateSimilarity(accountName, linked.accountName);

      if (nameSimilarity > 0.8) {
        return {
          match: true,
          category: linked.accountType || 'Investment',
          count: linked.linkCount,
          confidence: 1.0 // High confidence - actual linked transactions
        };
      }
    }

    // PRIORITY 2: Try to match against vendor names (less reliable)
    const vendors = existingInvestments.vendors || [];
    for (const vendor of vendors) {
      const vendorSimilarity = calculateSimilarity(accountName, vendor.name);
      const nameSimilarity = calculateSimilarity(accountName, vendor.vendor);

      if (vendorSimilarity > 0.7 || nameSimilarity > 0.7) {
        return {
          match: true,
          category: vendor.categoryName || vendor.parentName || 'Investment',
          count: vendor.transactionCount,
          confidence: Math.max(vendorSimilarity, nameSimilarity)
        };
      }
    }

    return { match: false };
  };

  const handleSync = async (account: Account) => {
    console.log('Selected account for syncing:', account);
    setSelectedAccount(account);

    // Fetch the last transaction date for this vendor to set as default start date
    try {
      const response = await apiClient.get(`/api/accounts/last-transaction-date?vendor=${account.vendor}`);
      if (response.ok) {
        const data = response.data as any;
        console.log(`Auto-setting start date for ${account.vendor}:`, data.message);

        // Update the account with the suggested start date
        setSelectedAccount({
          ...account,
          suggestedStartDate: data.lastTransactionDate,
          startDateMessage: data.message
        });
      }
    } catch (error) {
      console.error('Failed to fetch last transaction date:', error);
      // Continue with default behavior if API fails
    }

    setIsSyncModalOpen(true);
  };

  const handleSyncSuccess = () => {
    showNotification('Sync completed successfully!', 'success');
    window.dispatchEvent(new CustomEvent('dataRefresh'));
    fetchAccounts(); // Refresh accounts to update last sync dates
  };

  // Helper to fetch last holding and calculate default values
  const fetchLastHoldingData = async (accountId: string) => {
    try {
      // Fetch last holding record
      const holdingsResponse = await apiClient.get(`/api/investments/holdings?account_id=${accountId}&includeHistory=false`);

      if (holdingsResponse.ok) {
        const holdingsData = holdingsResponse.data as any;
        const lastHolding = holdingsData.holdings?.[0];

        if (lastHolding) {
          // Pre-fill with last recorded values
          return {
            currentValue: lastHolding.current_value?.toString() || '',
            costBasis: lastHolding.cost_basis?.toString() || '',
            currency: lastHolding.currency || 'ILS',
          };
        }
      }

      // If no holdings exist, calculate cost basis from linked transactions
      const account = investmentAccounts.find(acc => acc.id?.toString() === accountId);
      if (account && account.total_invested) {
        return {
          currentValue: '',
          costBasis: Math.abs(account.total_invested).toString(),
          currency: account.currency || 'ILS',
        };
      }
    } catch (error) {
      console.error('Error fetching last holding data:', error);
    }

    return null;
  };

  // Handler for value update modal
  const handleValueUpdate = async () => {
    if (!valueUpdate.accountId || !valueUpdate.currentValue || !valueUpdate.asOfDate) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      const response = await apiClient.post('/api/investments/holdings', {
        account_id: valueUpdate.accountId,
        current_value: parseFloat(valueUpdate.currentValue),
        cost_basis: valueUpdate.costBasis ? parseFloat(valueUpdate.costBasis) : null,
        as_of_date: valueUpdate.asOfDate,
        currency: valueUpdate.currency,
        notes: valueUpdate.notes,
      });

      if (response.ok) {
        showNotification('Value update added successfully!', 'success');
        setShowValueUpdateModal(false);
        setValueUpdate({
          accountId: '',
          currentValue: '',
          asOfDate: new Date().toISOString().split('T')[0],
          costBasis: '',
          currency: 'ILS',
          notes: '',
        });
        // Refresh investment accounts to show updated values
        fetchInvestmentAccounts();
      } else {
        const errorData = (response.data as any) || {};
        setError(errorData.error || 'Failed to add value update');
      }
    } catch (error) {
      console.error('Error adding value update:', error);
      setError('Network error occurred');
    }
  };

  // Handler for adding new assets
  const handleAddAsset = async () => {
    if (!newAsset.accountId || !newAsset.symbol || !newAsset.quantity || !newAsset.asOfDate) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      const response = await apiClient.post('/api/investments/assets', {
        account_id: newAsset.accountId,
        symbol: newAsset.symbol,
        quantity: parseFloat(newAsset.quantity),
        avg_price: newAsset.avgPrice ? parseFloat(newAsset.avgPrice) : null,
        as_of_date: newAsset.asOfDate,
      });

      if (response.ok) {
        showNotification('Asset added successfully!', 'success');
        setIsAddingAsset(false);
        setNewAsset({
          accountId: '',
          symbol: '',
          quantity: '',
          avgPrice: '',
          asOfDate: new Date().toISOString().split('T')[0],
        });
        // Refresh assets list
        fetchAssets();
      } else {
        const errorData = (response.data as any) || {};
        setError(errorData.error || 'Failed to add asset');
      }
    } catch (error) {
      console.error('Error adding asset:', error);
      setError('Network error occurred');
    }
  };

  // Function to load assets and asset history
  const fetchAssets = async () => {
    try {
      const response = await apiClient.get('/api/investments/assets');
      if (response.ok) {
        const data = response.data as any;
        setAssets(Array.isArray(data?.assets) ? data.assets : []);
        setAssetHistory(Array.isArray(data?.history) ? data.history : []);
      }
    } catch (error) {
      console.error('Error fetching assets:', error);
    }
  };

  const formatLastUpdate = (lastUpdate: string, status?: string) => {
    if (!lastUpdate) return { text: 'Never', color: 'default' as const };

    const date = new Date(lastUpdate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    let text = '';
    let color: 'success' | 'warning' | 'error' | 'default' = 'default';

    if (diffDays === 0) {
      if (diffHours === 0) {
        text = 'Just now';
        color = 'success';
      } else {
        text = `${diffHours}h ago`;
        color = diffHours < 12 ? 'success' : 'warning';
      }
    } else if (diffDays === 1) {
      text = 'Yesterday';
      color = 'warning';
    } else if (diffDays < 7) {
      text = `${diffDays} days ago`;
      color = 'warning';
    } else {
      text = formatDate(lastUpdate);
      color = 'error';
    }

    // Override color based on status
    if (status === 'success') {
      color = diffDays < 1 ? 'success' : diffDays < 7 ? 'warning' : 'error';
    } else if (status === 'failed') {
      color = 'error';
    }

    return { text, color };
  };

  useEffect(() => {
    if (selectedAccount) {
      console.log('Selected account changed:', selectedAccount);
    }
  }, [selectedAccount]);

  // Separate accounts by type
  const bankAccounts = accounts.filter((account) => isAccountOfType(account, 'bank'));
  const creditAccounts = accounts.filter((account) => isAccountOfType(account, 'credit_card'));

  // Show Pair button only if both bank and credit card accounts exist
  const canPairAccounts = bankAccounts.length > 0 && creditAccounts.length > 0;

  const renderInvestmentAccountTable = (accounts: InvestmentAccount[]) => {
    if (accounts.length === 0) {
      return (
        <Box sx={{
          display: 'flex',
          justifyContent: 'center',
          padding: '32px',
          color: '#666',
          fontStyle: 'italic'
        }}>
          No accounts in this category
        </Box>
      );
    }

    return (
      <Table sx={{ bgcolor: 'background.paper', borderRadius: '8px', overflow: 'hidden' }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Account Name</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Type</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Institution</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Current Value</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Last Update</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {accounts.map((account) => {
            const accountType = INVESTMENT_ACCOUNT_TYPES.find(t => t.value === account.account_type);
            const institutionMeta = (account.institution && typeof account.institution !== 'string'
              ? account.institution as InstitutionMetadata
              : account.institutionObj) || null;
            const institutionFallback =
              typeof account.institution === 'string' ? account.institution : undefined;
            return (
              <StyledTableRow key={account.id}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight={500}>
                      {account.account_name}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    label={accountType?.label || account.account_type}
                    size="small"
                    variant="outlined"
                    color="success"
                    sx={{
                      textTransform: 'capitalize',
                    }}
                  />
                </TableCell>
                <TableCell>
                  {institutionFallback && !institutionMeta ? (
                    <Typography variant="body2">{institutionFallback}</Typography>
                  ) : (
                    <InstitutionBadge
                      institution={institutionMeta}
                      fallback={institutionFallback || '-'}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                      {account.current_value
                        ? `${account.currency} ${account.current_value.toLocaleString()}`
                        : 'Not set'
                      }
                    </Typography>
                    {account.current_value && !(account as any).current_value_explicit && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontStyle: 'italic' }}>
                        (from transactions)
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {account.last_update_date
                      ? new Date(account.last_update_date).toLocaleDateString()
                      : 'Never'
                    }
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Add Value Update">
                    <IconButton
                      onClick={async () => {
                        const accountId = account.id?.toString() || '';

                        // Fetch last holding data to pre-fill the form
                        const lastData = await fetchLastHoldingData(accountId);

                        setValueUpdate({
                          accountId,
                          currentValue: lastData?.currentValue || '',
                          costBasis: lastData?.costBasis || '',
                          currency: lastData?.currency || 'ILS',
                          asOfDate: new Date().toISOString().split('T')[0],
                          notes: '',
                        });
                        setShowValueUpdateModal(true);
                      }}
                      color="success"
                    >
                      <TrendingUpIcon />
                    </IconButton>
                  </Tooltip>
                  {account.account_type === 'brokerage' && (
                    <Tooltip title="Manage Assets">
                      <IconButton
                        onClick={() => {
                          fetchAssets(); // Load current assets
                          setShowAssetModal(true);
                        }}
                        color="info"
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Delete Account">
                    <IconButton
                      onClick={() => confirmDelete(account, 'investment')}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </StyledTableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  const renderAccountTable = (accounts: Account[], type: 'bank' | 'credit') => {
    if (accounts.length === 0) {
      return (
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          padding: '32px',
          color: '#666',
          fontStyle: 'italic'
        }}>
          No {type === 'bank' ? 'bank' : 'credit card'} accounts found
        </Box>
      );
    }

    return (
      <Table sx={{ bgcolor: 'background.paper', borderRadius: '8px', overflow: 'hidden' }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Nickname</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Vendor</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
              {type === 'bank' ? 'Username' : 'ID Number'}
            </TableCell>
            {type === 'bank' ? (
              <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Account Number</TableCell>
            ) : (
              <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Card Last Digits</TableCell>
            )}
            {type === 'bank' && (
              <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Balance</TableCell>
            )}
            <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Last Update</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {accounts.map((account) => {
            const lastUpdateInfo = formatLastUpdate(account.lastUpdate || '', account.lastScrapeStatus);
            return (
              <StyledTableRow key={account.id}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight={500}>
                      {account.nickname}
                    </Typography>
                    {account.lastScrapeStatus === 'success' && (
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 16 }} />
                    )}
                    {account.lastScrapeStatus === 'failed' && (
                      <ErrorIcon sx={{ color: 'error.main', fontSize: 16 }} />
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <InstitutionBadge
                    institution={account.institution as InstitutionMetadata | null}
                    fallback={account.vendor}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {account.username || account.id_number}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {type === 'bank' ? account.bank_account_number : (account.card6_digits || '-')}
                  </Typography>
                </TableCell>
                {type === 'bank' && (
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                      {account.current_balance !== null && account.current_balance !== undefined
                        ? `₪${account.current_balance.toLocaleString()}`
                        : '-'
                      }
                    </Typography>
                    {account.balance_updated_at && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        Updated: {new Date(account.balance_updated_at).toLocaleDateString()}
                      </Typography>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <Chip
                    label={lastUpdateInfo.text}
                    size="small"
                    color={lastUpdateInfo.color}
                    variant="outlined"
                    icon={
                      lastUpdateInfo.color === 'success' ? <CheckCircleIcon /> :
                      lastUpdateInfo.color === 'error' ? <ErrorIcon /> :
                      <AccessTimeIcon />
                    }
                  />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={isSyncing ? "Sync in progress..." : "Sync Account Data"}>
                    <span>
                      <IconButton
                        onClick={() => handleSync(account)}
                        color="primary"
                        disabled={isSyncing}
                      >
                        {isSyncing ? <CircularProgress size={20} /> : <SyncIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Delete Account">
                    <IconButton
                      onClick={() => confirmDelete(account, 'banking')}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </StyledTableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  return (
    <>
      <Dialog 
        open={isOpen} 
        onClose={() => {
          if (isAdding) {
            setIsAdding(false);
          } else {
            onClose();
          }
        }} 
        maxWidth="md" 
        fullWidth
      >
        <ModalHeader
          title="Accounts Management"
          onClose={() => {
            if (isAdding) {
              setIsAdding(false);
            } else {
              onClose();
            }
          }}
          actions={
            <Box sx={{ display: 'flex', gap: 1 }}>
              {activeTab === 0 && canPairAccounts && (
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<LinkIcon />}
                  onClick={() => setIsPairingModalOpen(true)}
                >
                  Pair Accounts
                </Button>
              )}
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => {
                  setCurrentAccountType(activeTab === 0 ? 'banking' : 'investment');
                  setIsAdding(true);
                }}
              >
                Add Account
              </Button>
            </Box>
          }
        />

        {/* Tabs for different account types */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tabs value={activeTab} onChange={handleTabChange} aria-label="account types">
            <Tab
              icon={<AccountBalanceIcon />}
              iconPosition="start"
              label="Banking & Transactions"
              sx={{ textTransform: 'none', fontWeight: 500 }}
            />
            <Tab
              icon={<TrendingUpIcon />}
              iconPosition="start"
              label="Investments & Savings"
              sx={{ textTransform: 'none', fontWeight: 500 }}
            />
          </Tabs>
        </Box>
        <DialogContent style={{ padding: '24px' }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Tab Panel Content */}
          {activeTab === 0 && (
            <Box>
              {/* Banking & Transactions Tab */}
              {isAdding && currentAccountType === 'banking' ? (
                <Box>
                  {/* Credit Card Account Form */}
                  <Accordion 
                    expanded={expandedForm === 'creditCard'} 
                    onChange={() => setExpandedForm(expandedForm === 'creditCard' ? null : 'creditCard')}
                    sx={{ mb: 2 }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{ bgcolor: 'action.hover' }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <CreditCardIcon color="secondary" />
                        <Typography variant="h6">Add Credit Card Account</Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label="Account Nickname"
                            value={newAccount.nickname}
                            onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })}
                            placeholder="e.g., My Isracard, Work Amex"
                            required
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            select
                            label="Credit Card Vendor"
                            value={
                              newAccount.vendor &&
                              creditCardInstitutionOptions.some(inst => inst.vendor_code === newAccount.vendor)
                                ? newAccount.vendor
                                : ''
                            }
                            onChange={(e) => {
                              const vendor = e.target.value;
                              const institution = findInstitutionByVendor(vendor);
                              setNewAccount((prev) => {
                                const cleared = resetAccountCredentialFields(prev);
                                return {
                                  ...cleared,
                                  vendor,
                                  institution_id: institution && institution.id > 0 ? institution.id : null,
                                };
                              });
                            }}
                          >
                            {creditCardInstitutionOptions.map((institution) => (
                              <MenuItem key={institution.vendor_code} value={institution.vendor_code}>
                                {getInstitutionLabel(institution)}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Grid>
                        {renderCredentialFieldInputs(findInstitutionByVendor(newAccount.vendor))}

                        <Grid item xs={12}>
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button onClick={() => setIsAdding(false)}>Cancel</Button>
                            <Button variant="contained" color="secondary" onClick={handleAdd}>
                              Add Credit Card
                            </Button>
                          </Box>
                        </Grid>
                      </Grid>
                    </AccordionDetails>
                  </Accordion>

                  {/* Bank Account Form */}
                  <Accordion 
                    expanded={expandedForm === 'bank'} 
                    onChange={() => setExpandedForm(expandedForm === 'bank' ? null : 'bank')}
                    sx={{ mb: 2 }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{ bgcolor: 'action.hover' }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <AccountBalanceIcon color="primary" />
                        <Typography variant="h6">Add Bank Account</Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label="Account Nickname"
                            value={newAccount.nickname}
                            onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })}
                            placeholder="e.g., Main Checking, Salary Account"
                            required
                          />
                        </Grid>
                        <Grid item xs={12}>
                        <TextField
                          fullWidth
                          select
                          label="Bank"
                          value={
                            newAccount.vendor &&
                            bankInstitutionOptions.some(inst => inst.vendor_code === newAccount.vendor)
                              ? newAccount.vendor
                              : ''
                          }
                          onChange={(e) => {
                            const vendor = e.target.value;
                            const institution = findInstitutionByVendor(vendor);
                            setNewAccount((prev) => {
                              const cleared = resetAccountCredentialFields(prev);
                              return {
                                ...cleared,
                                vendor,
                                institution_id: institution && institution.id > 0 ? institution.id : null,
                              };
                            });
                          }}
                        >
                            {bankInstitutionOptions.map((institution) => (
                              <MenuItem key={institution.vendor_code} value={institution.vendor_code}>
                                {getInstitutionLabel(institution)}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Grid>

                        {renderCredentialFieldInputs(findInstitutionByVendor(newAccount.vendor))}

                        <Grid item xs={12}>
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button onClick={() => setIsAdding(false)}>Cancel</Button>
                            <Button variant="contained" color="primary" onClick={handleAdd}>
                              Add Bank Account
                            </Button>
                          </Box>
                        </Grid>
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                </Box>
              ) : (
                <>
                  {/* Bank Accounts Section */}
                  <AccountSection>
                    <SectionHeader>
                      <AccountBalanceIcon color="primary" sx={{ fontSize: '24px' }} />
                      <Typography variant="h6" color="primary">
                        Bank Accounts ({bankAccounts.length})
                      </Typography>
                    </SectionHeader>
                    {renderAccountTable(bankAccounts, 'bank')}
                  </AccountSection>

                  {/* Credit Card Accounts Section */}
                  <AccountSection>
                    <SectionHeader>
                      <CreditCardIcon color="secondary" sx={{ fontSize: '24px' }} />
                      <Typography variant="h6" color="secondary">
                        Credit Card Accounts ({creditAccounts.length})
                      </Typography>
                    </SectionHeader>

                    {/* Smart Credit Card Suggestions - Show when no credit cards exist */}
                    {creditAccounts.length === 0 && <CreditCardSuggestionsCard />}

                    {renderAccountTable(creditAccounts, 'credit')}
                  </AccountSection>
                </>
              )}
            </Box>
          )}

          {activeTab === 1 && (
            <Box>
              {/* Investments & Savings Tab */}

              {/* Smart Investment Account Suggestions - Show at top */}
              {!isAdding && (
                <InvestmentAccountSuggestionsCard
                  onSuggestionCreated={() => {
                    fetchInvestmentAccounts();
                    window.dispatchEvent(new CustomEvent('dataRefresh'));
                  }}
                  onCreateAccountClick={handleSuggestionClick}
                />
              )}

              {isAdding && currentAccountType === 'investment' ? (
                <Card sx={{ mb: 3 }}>
                  <CardHeader title="Add Investment Account" />
                  <CardContent>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        {(() => {
                          const investmentMatch = newInvestmentAccount.account_name ? isExistingInvestment(newInvestmentAccount.account_name) : { match: false };
                          return (
                            <Box>
                              <TextField
                                fullWidth
                                label="Account Name"
                                value={newInvestmentAccount.account_name}
                                onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_name: e.target.value })}
                                placeholder="e.g., Interactive Brokers, Migdal Pension"
                                required
                                sx={{
                                  '& .MuiOutlinedInput-root': {
                                    '& fieldset': {
                                      borderColor: investmentMatch.match ? '#4caf50' : undefined,
                                      borderWidth: investmentMatch.match ? '2px' : '1px',
                                    },
                                  },
                                }}
                              />
                              {investmentMatch.match && (
                                <Alert severity="success" sx={{ mt: 1, py: 0.5 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                      ✓ Found in transactions!
                                    </Typography>
                                    <Chip
                                      label={investmentMatch.category || 'Investment'}
                                      size="small"
                                      color="success"
                                      sx={{ height: '20px', fontSize: '0.65rem' }}
                                    />
                                    {investmentMatch.count && (
                                      <Typography variant="caption" color="text.secondary">
                                        {investmentMatch.count} transactions
                                      </Typography>
                                    )}
                                  </Box>
                                </Alert>
                              )}
                            </Box>
                          );
                        })()}
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          select
                          label="Account Type"
                          value={newInvestmentAccount.account_type}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_type: e.target.value })}
                          required
                        >
                          {INVESTMENT_ACCOUNT_TYPES.map((type) => (
                            <MenuItem key={type.value} value={type.value}>
                              {type.label} ({type.label_he})
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Institution"
                          value={newInvestmentAccount.institution}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, institution: e.target.value })}
                          placeholder="e.g., Migdal, Meitav Dash"
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          select
                          label="Known Institution (optional)"
                          value={newInvestmentAccount.institution_id ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            const selectedId = value ? Number(value) : null;
                            const selectedInstitution = investmentInstitutionOptions.find(
                              (institution) => institution.id === selectedId
                            );

                            const currentName =
                              typeof newInvestmentAccount.institution === 'string'
                                ? newInvestmentAccount.institution
                                : '';
                            const updatedName = selectedInstitution
                              ? (selectedInstitution.display_name_he ||
                                  selectedInstitution.display_name_en ||
                                  currentName)
                              : currentName;

                            setNewInvestmentAccount({
                              ...newInvestmentAccount,
                              institution_id: selectedId,
                              institution: updatedName,
                            });
                          }}
                          SelectProps={{ displayEmpty: true }}
                          helperText="Select from registry or leave blank for a custom institution"
                        >
                          <MenuItem value="">
                            <em>None</em>
                          </MenuItem>
                          {investmentInstitutionOptions.map((institution) => (
                            <MenuItem key={institution.id} value={institution.id}>
                              {getInstitutionLabel(institution)} ({institution.institution_type})
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Account Number"
                          value={newInvestmentAccount.account_number}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_number: e.target.value })}
                          placeholder="Optional"
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          select
                          label="Currency"
                          value={newInvestmentAccount.currency}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, currency: e.target.value })}
                        >
                          <MenuItem value="ILS">ILS (₪)</MenuItem>
                          <MenuItem value="USD">USD ($)</MenuItem>
                          <MenuItem value="EUR">EUR (€)</MenuItem>
                        </TextField>
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          multiline
                          rows={2}
                          label="Notes"
                          value={newInvestmentAccount.notes}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, notes: e.target.value })}
                          placeholder="Any additional information..."
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <Button onClick={() => setIsAdding(false)}>Cancel</Button>
                          <Button variant="contained" onClick={handleAdd}>Add Account</Button>
                        </Box>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Investment Accounts organized by category */}
                  {Object.entries(
                    (ACCOUNT_CATEGORIES.INVESTMENTS.subcategories ??
                      {}) as Record<string, AccountCategory>,
                  ).map(([key, subcategory]) => {
                    const allowedTypes = subcategory.types ?? [];
                    const categoryAccounts = investmentAccounts.filter((acc) =>
                      allowedTypes.includes(acc.account_type),
                    );

                    if (categoryAccounts.length === 0) return null;

                    return (
                      <AccountSection key={key}>
                        <SectionHeader>
                          {subcategory.id === 'liquid' && <TrendingUpIcon sx={{ color: subcategory.color, fontSize: '24px' }} />}
                          {subcategory.id === 'restricted' && <LockIcon sx={{ color: subcategory.color, fontSize: '24px' }} />}
                          {subcategory.id === 'alternative' && <BusinessIcon sx={{ color: subcategory.color, fontSize: '24px' }} />}
                          <Typography variant="h6" sx={{ color: subcategory.color }}>
                            {subcategory.label} ({categoryAccounts.length})
                          </Typography>
                        </SectionHeader>
                        {renderInvestmentAccountTable(categoryAccounts)}
                      </AccountSection>
                    );
                  })}

                  {investmentAccounts.length === 0 && (
                    <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                      <PortfolioIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
                      <Typography variant="h6" gutterBottom>
                        No investment accounts yet
                      </Typography>
                      <Typography variant="body2">
                        Add your pension funds, brokerage accounts, and other investments to track your portfolio
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Value Update Modal */}
      <Dialog open={showValueUpdateModal} onClose={() => setShowValueUpdateModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Add Value Update
          <IconButton
            onClick={() => setShowValueUpdateModal(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  select
                  label="Investment Account"
                  value={valueUpdate.accountId}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, accountId: e.target.value })}
                  required
                >
                  {investmentAccounts.map((account) => (
                    <MenuItem key={account.id} value={account.id}>
                      {account.account_name} ({account.account_type})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Current Value"
                  value={valueUpdate.currentValue}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, currentValue: e.target.value })}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>,
                  }}
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="As of Date"
                  value={valueUpdate.asOfDate}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, asOfDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Cost Basis (Optional)"
                  value={valueUpdate.costBasis}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, costBasis: e.target.value })}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>,
                  }}
                  helperText="Total amount invested"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  select
                  label="Currency"
                  value={valueUpdate.currency}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, currency: e.target.value })}
                >
                  <MenuItem value="ILS">ILS (₪)</MenuItem>
                  <MenuItem value="USD">USD ($)</MenuItem>
                  <MenuItem value="EUR">EUR (€)</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Notes (Optional)"
                  value={valueUpdate.notes}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, notes: e.target.value })}
                  placeholder="Any additional notes about this update..."
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowValueUpdateModal(false)}>Cancel</Button>
          <Button
            onClick={handleValueUpdate}
            variant="contained"
            disabled={!valueUpdate.accountId || !valueUpdate.currentValue || !valueUpdate.asOfDate}
          >
            Add Update
          </Button>
        </DialogActions>
      </Dialog>

      {/* Asset Management Modal */}
      <Dialog open={showAssetModal} onClose={() => setShowAssetModal(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Manage Assets
          <IconButton
            onClick={() => setShowAssetModal(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Tabs value={assetTab} onChange={(e, v) => setAssetTab(v)} sx={{ mb: 3 }}>
              <Tab label="Individual Assets" />
              <Tab label="Asset History" />
            </Tabs>

            {assetTab === 0 && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Individual Assets</Typography>
                  <Button
                    startIcon={<AddIcon />}
                    onClick={() => setIsAddingAsset(true)}
                    variant="outlined"
                  >
                    Add Asset
                  </Button>
                </Box>

                {isAddingAsset && (
                  <Card sx={{ mb: 3, bgcolor: 'action.hover' }}>
                    <CardContent>
                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            fullWidth
                            select
                            label="Investment Account"
                            value={newAsset.accountId}
                            onChange={(e) => setNewAsset({ ...newAsset, accountId: e.target.value })}
                            required
                          >
                            {investmentAccounts.filter(acc => acc.account_type === 'brokerage').map((account) => (
                              <MenuItem key={account.id} value={account.id}>
                                {account.account_name}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            fullWidth
                            label="Asset Symbol/Name"
                            value={newAsset.symbol}
                            onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value })}
                            placeholder="e.g., AAPL, Tesla Inc."
                            required
                          />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                          <TextField
                            fullWidth
                            type="number"
                            label="Quantity"
                            value={newAsset.quantity}
                            onChange={(e) => setNewAsset({ ...newAsset, quantity: e.target.value })}
                            required
                          />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                          <TextField
                            fullWidth
                            type="number"
                            label="Average Price"
                            value={newAsset.avgPrice}
                            onChange={(e) => setNewAsset({ ...newAsset, avgPrice: e.target.value })}
                            InputProps={{
                              startAdornment: <InputAdornment position="start">$</InputAdornment>,
                            }}
                          />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                          <TextField
                            fullWidth
                            type="date"
                            label="As of Date"
                            value={newAsset.asOfDate}
                            onChange={(e) => setNewAsset({ ...newAsset, asOfDate: e.target.value })}
                            InputLabelProps={{ shrink: true }}
                            required
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button onClick={handleAddAsset} variant="contained" size="small">
                              Add Asset
                            </Button>
                            <Button onClick={() => setIsAddingAsset(false)} size="small">
                              Cancel
                            </Button>
                          </Box>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                )}

                {assets.length > 0 ? (
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Symbol</TableCell>
                          <TableCell align="right">Quantity</TableCell>
                          <TableCell align="right">Avg Price</TableCell>
                          <TableCell align="right">Total Value</TableCell>
                          <TableCell>Account</TableCell>
                          <TableCell>Last Updated</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {assets.map((asset) => (
                          <TableRow key={asset.id}>
                            <TableCell sx={{ fontWeight: 500 }}>{asset.symbol}</TableCell>
                            <TableCell align="right">{asset.quantity}</TableCell>
                            <TableCell align="right">${asset.avg_price}</TableCell>
                            <TableCell align="right">
                              ${(asset.quantity * asset.avg_price).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {investmentAccounts.find(acc => acc.id === asset.account_id)?.account_name}
                            </TableCell>
                            <TableCell>{new Date(asset.as_of_date).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                    <Typography>No individual assets tracked yet</Typography>
                  </Box>
                )}
              </Box>
            )}

            {assetTab === 1 && (
              <Box>
                <Typography variant="h6" gutterBottom>Asset History</Typography>
                {assetHistory.length > 0 ? (
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell>Account</TableCell>
                          <TableCell>Symbol</TableCell>
                          <TableCell align="right">Quantity</TableCell>
                          <TableCell align="right">Price</TableCell>
                          <TableCell align="right">Total Value</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {assetHistory.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell>{new Date(record.as_of_date).toLocaleDateString()}</TableCell>
                            <TableCell>
                              {investmentAccounts.find(acc => acc.id === record.account_id)?.account_name}
                            </TableCell>
                            <TableCell>{record.symbol}</TableCell>
                            <TableCell align="right">{record.quantity}</TableCell>
                            <TableCell align="right">${record.avg_price}</TableCell>
                            <TableCell align="right">
                              ${(record.quantity * record.avg_price).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                    <Typography>No asset history available</Typography>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAssetModal(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <SyncModal
        isOpen={isSyncModalOpen}
        onClose={() => {
          setIsSyncModalOpen(false);
          setSelectedAccount(null);
        }}
        onSuccess={handleSyncSuccess}
        onStart={() => setIsSyncing(true)}
        onComplete={() => setIsSyncing(false)}
        initialConfig={selectedAccount ? {
          options: {
            companyId: selectedAccount.vendor,
            startDate: selectedAccount.suggestedStartDate ? new Date(selectedAccount.suggestedStartDate) : new Date(),
            combineInstallments: false,
            showBrowser: true,
            additionalTransactionInformation: true
          },
          credentials: {
            id: selectedAccount.id_number,
            card6Digits: selectedAccount.card6_digits,
            password: selectedAccount.password,
            username: selectedAccount.username,
            bankAccountNumber: selectedAccount.bank_account_number,
            identification_code: selectedAccount.identification_code,
            nickname: selectedAccount.nickname
          }
        } : undefined}
      />

      {/* Account Pairing Modal */}
      <AccountPairingModal
        isOpen={isPairingModalOpen}
        onClose={() => setIsPairingModalOpen(false)}
        creditCardAccounts={creditAccounts}
        bankAccounts={bankAccounts}
      />

      {/* Confirmation Dialog for Delete Operations */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Confirm Account Deletion
          <IconButton
            onClick={() => setConfirmDeleteOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body1" gutterBottom>
              Are you sure you want to delete this account?
            </Typography>
            <Box sx={{
              bgcolor: 'warning.light',
              border: 1,
              borderColor: 'warning.main',
              borderRadius: 1,
              p: 2,
              mt: 2
            }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                Account: {accountToDelete?.name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                Type: {accountToDelete?.type === 'banking' ? 'Banking Account' : 'Investment Account'}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ mt: 2, color: 'error.main' }}>
              ⚠️ This action cannot be undone. All associated data will be permanently removed.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)} variant="outlined">
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
            startIcon={<DeleteIcon />}
          >
            Delete Account
          </Button>
        </DialogActions>
      </Dialog>

      {/* Smart Investment Account Form */}
      <SmartInvestmentAccountForm
        open={showSmartForm}
        onClose={() => setShowSmartForm(false)}
        suggestion={selectedSuggestion}
        onSuccess={handleSmartFormSuccess}
      />
    </>
  );
}
