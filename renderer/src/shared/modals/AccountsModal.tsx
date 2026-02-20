import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import SecurityIcon from '@mui/icons-material/Security';
import PortfolioIcon from '@mui/icons-material/AccountBalanceWallet';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
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
import { useTranslation } from 'react-i18next';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '../components/LicenseReadOnlyAlert';

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

type InstitutionTreeNode = {
  id: number;
  parent_id: number | null;
  vendor_code: string | null;
  node_type: 'root' | 'group' | 'institution';
  institution_type: string;
  category?: string | null;
  subcategory?: string | null;
  display_name_he: string;
  display_name_en: string;
  is_scrapable?: number;
  logo_url?: string | null;
  scraper_company_id?: string | null;
  credential_fields?: string | null;
  is_active?: number;
  display_order?: number;
  hierarchy_path?: string | null;
  depth_level?: number;
};

const normalizeLocale = (value?: string) => value?.toLowerCase().split('-')[0];

const getInstitutionTreeNodeLabel = (node: InstitutionTreeNode, locale?: string): string => {
  const normalized = normalizeLocale(locale) || 'he';
  const heName = node.display_name_he;
  const enName = node.display_name_en;

  if (normalized === 'he') return heName || enName || node.vendor_code || '';
  return enName || heName || node.vendor_code || '';
};

const mapInstitutionLeafToManualAccountType = (leaf: InstitutionTreeNode): string => {
  if (leaf.institution_type === 'broker') return 'brokerage';
  if (leaf.institution_type === 'crypto') return 'crypto';
  if (leaf.institution_type === 'insurance') return 'insurance';

  if (leaf.institution_type === 'investment') {
    if (leaf.subcategory === 'pension') return 'pension';
    if (leaf.subcategory === 'provident') return 'provident';
    if (leaf.subcategory === 'cash') return 'savings';
    return 'other';
  }

  return 'other';
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
  institutionObj?: InstitutionMetadata | null;
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

interface ScrapeResponseData {
  success?: boolean;
  accounts?: Array<{ txns?: unknown[] }>;
  error?: string;
  errorType?: string;
  message?: string;
}

interface InstitutionTreeResponse {
  nodes?: InstitutionTreeNode[];
}

interface InstitutionListResponse {
  institutions?: InstitutionMetadata[];
  institution?: InstitutionMetadata;
}

const getAccountInstitutionMeta = (account: Account): InstitutionMetadata | null => {
  if (account.institution && typeof account.institution !== 'string') {
    return account.institution as InstitutionMetadata;
  }
  if (account.institutionObj && typeof account.institutionObj !== 'string') {
    return account.institutionObj;
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
        const institutionName = getInstitutionLabel(institution) || account.vendor;
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

const resolveAccountCredentialValue = (account: Account, fieldKey: string): string | undefined => {
  switch (fieldKey) {
    case 'id':
      return account.id_number;
    case 'password':
      return account.password;
    case 'username':
      return account.username;
    case 'userCode':
      return account.userCode || account.username;
    case 'email':
      return account.email || account.username;
    case 'otpCode':
      return account.otpCode;
    case 'otpToken':
      return account.otpToken || account.identification_code;
    case 'card6Digits':
      return account.card6_digits;
    case 'nationalID':
      return account.nationalID || account.identification_code;
    case 'num':
      return account.num || account.identification_code;
    case 'identification_code':
      return account.identification_code;
    case 'bankAccountNumber':
      return account.bank_account_number;
    default:
      return undefined;
  }
};

const buildSyncCredentialsForSelectedAccount = (
  account: Account,
  credentialFieldList?: string[] | null,
): Record<string, string> => {
  const fallbackFields = [
    'username',
    'id',
    'card6Digits',
    'bankAccountNumber',
    'identification_code',
    'otpCode',
  ];
  const requiredFields =
    Array.isArray(credentialFieldList) && credentialFieldList.length > 0
      ? credentialFieldList
      : fallbackFields;
  const fields = Array.from(new Set([...requiredFields, 'password']));

  const credentials: Record<string, string> = {};
  for (const fieldKey of fields) {
    const value = resolveAccountCredentialValue(account, fieldKey);
    if (typeof value === 'string' && value.trim().length > 0) {
      credentials[fieldKey] = value;
    }
  }

  if (account.nickname && account.nickname.trim().length > 0) {
    credentials.nickname = account.nickname;
  }

  return credentials;
};

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:nth-of-type(odd)': {
    backgroundColor: theme.palette.action.hover,
  },
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' 
      ? 'rgba(255, 255, 255, 0.08)' 
      : 'rgba(0, 0, 0, 0.04)',
    transform: 'scale(1.005)',
    boxShadow: theme.palette.mode === 'dark'
      ? '0 2px 8px rgba(0, 0, 0, 0.4)'
      : '0 2px 8px rgba(0, 0, 0, 0.1)',
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
  if (account.otpCode) scrapeCredentials.otpCode = account.otpCode;
  if (account.otpToken) scrapeCredentials.otpToken = account.otpToken;
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
      showBrowser: false,
      additionalTransactionInformation: true,
    },
    credentials: scrapeCredentials,
  };
};

const SectionHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '20px 24px 16px 24px',
  marginBottom: '24px',
  borderBottom: `2px solid ${theme.palette.divider}`,
  background: theme.palette.mode === 'dark' 
    ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)'
    : 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(139, 92, 246, 0.02) 100%)',
  borderRadius: '12px 12px 0 0',
  marginLeft: '-16px',
  marginRight: '-16px',
  boxShadow: theme.palette.mode === 'dark'
    ? '0 4px 12px rgba(0, 0, 0, 0.3)'
    : '0 2px 8px rgba(0, 0, 0, 0.05)',
  position: 'relative',
  overflow: 'hidden',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '3px',
    background: theme.palette.mode === 'dark'
      ? 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)'
      : 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)',
  },
  '& .MuiTypography-root': {
    fontWeight: 700,
    fontSize: '20px',
    letterSpacing: '0.02em',
  },
}));

const AccountSection = styled(Box)(({ theme }) => ({
  marginBottom: '48px',
  padding: '16px',
  borderRadius: '16px',
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.default,
  boxShadow: theme.palette.mode === 'dark'
    ? '0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)'
    : '0 2px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.02)',
  transition: 'all 0.3s ease-in-out',
  '&:hover': {
    boxShadow: theme.palette.mode === 'dark'
      ? '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)'
      : '0 4px 20px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04)',
    transform: 'translateY(-2px)',
  },
  '&:last-child': {
    marginBottom: 0,
  },
}));

export default function AccountsModal({ isOpen, onClose }: AccountsModalProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionMetadata[]>([]);
  const [institutionNodes, setInstitutionNodes] = useState<InstitutionTreeNode[]>([]);
  const institutionMap = useMemo(() => {
    const map = new Map<string, InstitutionMetadata>();
    institutions.forEach((institution) => {
      map.set(institution.vendor_code, institution);
    });
    return map;
  }, [institutions]);
  const [, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>(undefined);
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentAccountType, setCurrentAccountType] = useState<'banking' | 'investment'>('banking');
  const [expandedForm, setExpandedForm] = useState<'creditCard' | 'bank' | null>(null);
  const [addInstitutionPath, setAddInstitutionPath] = useState<number[]>([]);
  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
  const [pendingSuggestionTransactions, setPendingSuggestionTransactions] = useState<any[]>([]);
  const { showNotification} = useNotification();
  const { refetch: refetchOnboardingStatus } = useOnboarding();
  const [newAccount, setNewAccount] = useState<Account>(() => createEmptyCredentialAccount());
  const [showNewAccountPassword, setShowNewAccountPassword] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  const [isCredentialsUpdateOpen, setIsCredentialsUpdateOpen] = useState(false);
  const [credentialsUpdateAccount, setCredentialsUpdateAccount] = useState<Account | null>(null);
  const [credentialsUpdateSaving, setCredentialsUpdateSaving] = useState(false);
  const [credentialsUpdateError, setCredentialsUpdateError] = useState<string | null>(null);
  const [credentialsUpdateShowOptional, setCredentialsUpdateShowOptional] = useState(false);
  const [showCredentialsUpdatePassword, setShowCredentialsUpdatePassword] = useState(false);
  const [credentialsUpdateDraft, setCredentialsUpdateDraft] = useState({
    nickname: '',
    loginIdentifier: '',
    password: '',
    id: '',
    card6Digits: '',
    bankAccountNumber: '',
    extraCode: '',
  });
  const [credentialsUpdateInitial, setCredentialsUpdateInitial] = useState({
    nickname: '',
    loginIdentifier: '',
    password: '',
    id: '',
    card6Digits: '',
    bankAccountNumber: '',
    extraCode: '',
  });

  const [newInvestmentAccount, setNewInvestmentAccount] = useState<InvestmentAccount>({
    account_name: '',
    account_type: 'brokerage',
    currency: 'ILS',
    institution: '',
    account_number: '',
    notes: '',
    institution_id: null,
  });

  const [initialValue, setInitialValue] = useState({
    currentValue: '',
    costBasis: '',
    asOfDate: new Date().toISOString().split('T')[0],
  });

  const { t, i18n } = useTranslation('translation', { keyPrefix: 'accountsModal' });
  const locale = normalizeLocale(i18n.language) || 'he';

  const creditCardInstitutionOptions = useMemo(() => {
    const sorted = institutions
      .filter((institution) => institution.institution_type === 'credit_card')
      .sort((a, b) => {
        const left = getInstitutionLabel(a, locale) || a.vendor_code;
        const right = getInstitutionLabel(b, locale) || b.vendor_code;
        return left.localeCompare(right, locale, { sensitivity: 'base' });
      });

    if (sorted.length > 0) {
      return sorted;
    }

    return CREDIT_CARD_VENDORS.map((vendor) => toFallbackInstitution(vendor, 'credit_card'));
  }, [institutions, locale]);

  const bankInstitutionOptions = useMemo(() => {
    const sorted = institutions
      .filter((institution) => institution.institution_type === 'bank')
      .sort((a, b) => {
        const left = getInstitutionLabel(a, locale) || a.vendor_code;
        const right = getInstitutionLabel(b, locale) || b.vendor_code;
        return left.localeCompare(right, locale, { sensitivity: 'base' });
      });

    if (sorted.length > 0) {
      return sorted;
    }

    const fallbackVendors = [...BANK_VENDORS, ...SPECIAL_BANK_VENDORS, ...OTHER_BANK_VENDORS];
    return fallbackVendors.map((vendor) => toFallbackInstitution(vendor, 'bank'));
  }, [institutions, locale]);

  const investmentInstitutionOptions = useMemo(() => {
    const allowedTypes = new Set(['investment', 'insurance', 'broker', 'crypto']);
    return institutions
      .filter((institution) => allowedTypes.has(institution.institution_type))
      .sort((a, b) => {
        const left = getInstitutionLabel(a, locale) || a.vendor_code;
        const right = getInstitutionLabel(b, locale) || b.vendor_code;
        return left.localeCompare(right, locale, { sensitivity: 'base' });
      });
  }, [institutions, locale]);

  const institutionNodeById = useMemo(() => {
    const map = new Map<number, InstitutionTreeNode>();
    institutionNodes.forEach((node) => {
      map.set(node.id, node);
    });
    return map;
  }, [institutionNodes]);

  const institutionChildrenByParentId = useMemo(() => {
    const map = new Map<number | null, InstitutionTreeNode[]>();
    institutionNodes.forEach((node) => {
      const parentId = node.parent_id ?? null;
      const bucket = map.get(parentId);
      if (bucket) {
        bucket.push(node);
      } else {
        map.set(parentId, [node]);
      }
    });

    for (const [, children] of map.entries()) {
      children.sort((a, b) => {
        const orderA = a.display_order ?? 0;
        const orderB = b.display_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return getInstitutionTreeNodeLabel(a, locale)
          .localeCompare(getInstitutionTreeNodeLabel(b, locale), locale, { sensitivity: 'base' });
      });
    }

    return map;
  }, [institutionNodes, locale]);

  const addWizardSelectedNode = useMemo(() => {
    if (addInstitutionPath.length === 0) return null;
    const lastId = addInstitutionPath[addInstitutionPath.length - 1];
    return institutionNodeById.get(lastId) || null;
  }, [addInstitutionPath, institutionNodeById]);

  const addWizardSelectedInstitution = useMemo(() => {
    if (!addWizardSelectedNode) return null;
    return addWizardSelectedNode.node_type === 'institution' ? addWizardSelectedNode : null;
  }, [addWizardSelectedNode]);

  const addWizardSelectedInstitutionMeta = useMemo(() => {
    if (!addWizardSelectedInstitution?.vendor_code) return null;
    return institutionMap.get(addWizardSelectedInstitution.vendor_code) || null;
  }, [addWizardSelectedInstitution, institutionMap]);

  const addWizardMode = useMemo<'banking' | 'investment' | null>(() => {
    if (!addWizardSelectedInstitution) return null;
    const institutionType = addWizardSelectedInstitution.institution_type;
    if (institutionType === 'bank' || institutionType === 'credit_card') {
      return 'banking';
    }
    return 'investment';
  }, [addWizardSelectedInstitution]);

  const addWizardPathNodes = useMemo(() => {
    return addInstitutionPath
      .map((id) => institutionNodeById.get(id))
      .filter((node): node is InstitutionTreeNode => Boolean(node));
  }, [addInstitutionPath, institutionNodeById]);

  const addWizardSelectedBadgeInstitution = useMemo<InstitutionMetadata | null>(() => {
    if (addWizardSelectedInstitutionMeta) return addWizardSelectedInstitutionMeta;
    if (!addWizardSelectedInstitution || !addWizardSelectedInstitution.vendor_code) return null;
    return {
      id: addWizardSelectedInstitution.id,
      vendor_code: addWizardSelectedInstitution.vendor_code,
      display_name_he: addWizardSelectedInstitution.display_name_he,
      display_name_en: addWizardSelectedInstitution.display_name_en,
      institution_type: addWizardSelectedInstitution.institution_type,
      category: addWizardSelectedInstitution.category ?? undefined,
      subcategory: addWizardSelectedInstitution.subcategory ?? null,
      parent_id: addWizardSelectedInstitution.parent_id ?? null,
      hierarchy_path: addWizardSelectedInstitution.hierarchy_path ?? undefined,
      depth_level: addWizardSelectedInstitution.depth_level,
      node_type: addWizardSelectedInstitution.node_type,
      logo_url: addWizardSelectedInstitution.logo_url ?? null,
      is_scrapable: addWizardSelectedInstitution.is_scrapable ?? 0,
      scraper_company_id: addWizardSelectedInstitution.scraper_company_id ?? null,
      display_order: addWizardSelectedInstitution.display_order ?? null,
      credential_fields: addWizardSelectedInstitution.credential_fields ?? null,
      credentialFieldList: parseCredentialFields(addWizardSelectedInstitution.credential_fields),
    };
  }, [addWizardSelectedInstitution, addWizardSelectedInstitutionMeta]);

  useEffect(() => {
    if (!isAdding) return;
    if (!addWizardSelectedInstitution) return;
    if (!addWizardSelectedInstitution.vendor_code) return;

    const institutionType = addWizardSelectedInstitution.institution_type;

    if (institutionType === 'bank' || institutionType === 'credit_card') {
      setCurrentAccountType('banking');
      setShowNewAccountPassword(false);
      setNewAccount((prev) => ({
        ...resetAccountCredentialFields(prev),
        vendor: addWizardSelectedInstitution.vendor_code || '',
        institution_id: addWizardSelectedInstitution.id,
      }));
      return;
    }

    setCurrentAccountType('investment');
    const suggestedType = mapInstitutionLeafToManualAccountType(addWizardSelectedInstitution);
    const localizedInstitutionName = getInstitutionTreeNodeLabel(addWizardSelectedInstitution, locale);

    setNewInvestmentAccount((prev) => ({
      ...prev,
      institution_id: addWizardSelectedInstitution.id,
      account_type: suggestedType,
      institution: localizedInstitutionName || prev.institution,
      account_name: prev.account_name || localizedInstitutionName || prev.account_name,
    }));
  }, [addWizardSelectedInstitution, isAdding, locale]);

  useEffect(() => {
    if (isAdding) {
      return;
    }
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
  }, [bankInstitutionOptions, creditCardInstitutionOptions, isAdding, newAccount.vendor]);

  useEffect(() => {
    setShowNewAccountPassword(false);
  }, [newAccount.vendor]);

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
          <Grid size={{ xs: 12 }}>
            <Alert severity="info">{t('helpers.selectInstitution')}</Alert>
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
        const label = t(`credentials.${fieldKey}`, { defaultValue: config.label });
        const helperText = config.helperText
          ? t(`credentials.${fieldKey}Helper`, { defaultValue: config.helperText })
          : undefined;
        const isPasswordField = config.type === 'password';
        return (
          <Grid size={{ xs: 12 }} key={`${institution.vendor_code}-${fieldKey}`}>
            <TextField
              fullWidth
              label={label}
              type={isPasswordField ? (showNewAccountPassword ? 'text' : 'password') : (config.type || 'text')}
              value={value}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, [config.key]: e.target.value }))}
              required
              helperText={helperText}
              InputProps={isPasswordField
                ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          onClick={() => setShowNewAccountPassword((prev) => !prev)}
                          onMouseDown={(event) => event.preventDefault()}
                          aria-label={showNewAccountPassword ? 'Hide password' : 'Show password'}
                        >
                          {showNewAccountPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }
                : undefined}
            />
          </Grid>
        );
      });

      const retryLimitWarning = (
        <Grid size={{ xs: 12 }} key={`${institution.vendor_code}-retry-limit-warning`}>
          <Alert severity="warning" icon={<LockIcon fontSize="small" />}>
            {t('helpers.retryLimitWarning')}
          </Alert>
        </Grid>
      );

      if (!hasExplicitFields) {
        return [
          (
            <Grid size={{ xs: 12 }} key={`${institution.vendor_code}-fallback-info`}>
              <Alert severity="info">
                {t('helpers.noSpecificCredentials')}
              </Alert>
            </Grid>
          ),
          ...inputs,
          retryLimitWarning,
        ];
      }

      return [...inputs, retryLimitWarning];
    },
    [newAccount, showNewAccountPassword, t],
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
      const response = await apiClient.get('/api/institutions/tree');
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to load institution tree');
      }
      const payload = response.data as InstitutionTreeResponse;
      const nodes: InstitutionTreeNode[] = Array.isArray(payload?.nodes) ? payload.nodes : [];
      setInstitutionNodes(nodes);
      const leaves = nodes.filter((n) => n.node_type === 'institution' && typeof n.vendor_code === 'string' && n.vendor_code.length > 0);
      if (leaves.length === 0) {
        throw new Error('No institution leaves returned from tree');
      }
      const normalized: InstitutionMetadata[] = leaves.map((leaf) => ({
        id: leaf.id,
        vendor_code: leaf.vendor_code as string,
        display_name_he: leaf.display_name_he,
        display_name_en: leaf.display_name_en,
        institution_type: leaf.institution_type,
        category: leaf.category ?? undefined,
        subcategory: leaf.subcategory ?? null,
        parent_id: leaf.parent_id ?? null,
        hierarchy_path: leaf.hierarchy_path ?? undefined,
        depth_level: leaf.depth_level,
        node_type: leaf.node_type,
        logo_url: leaf.logo_url ?? null,
        is_scrapable: leaf.is_scrapable ?? 0,
        scraper_company_id: leaf.scraper_company_id ?? null,
        display_order: leaf.display_order ?? null,
        credential_fields: leaf.credential_fields ?? null,
        credentialFieldList: parseCredentialFields(leaf.credential_fields),
      }));
      setInstitutions(normalized);
    } catch (err) {
      console.error('Error loading institutions (tree and fallback):', err);
      try {
        const fallback = await apiClient.get('/api/institutions');
        if (fallback.ok) {
          const payload = fallback.data as InstitutionListResponse;
          const list = Array.isArray(payload?.institutions)
            ? payload.institutions
            : (payload?.institution ? [payload.institution] : []);
          const normalized = list.map((inst: InstitutionMetadata) => ({
            ...inst,
            credentialFieldList: parseCredentialFields(inst.credential_fields),
          }));
          setInstitutions(normalized);
        }
      } catch (fallbackErr) {
        console.error('Fallback institution fetch failed:', fallbackErr);
      }
    }
  }, []);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setIsAdding(false); // Close add form when switching tabs
    setError(null);
  };

  const beginAddAccountFlow = () => {
    setError(null);
    setAddInstitutionPath([]);
    setExpandedForm(null);
    setCurrentAccountType('banking');
    setNewAccount(createEmptyCredentialAccount());
    setShowNewAccountPassword(false);
    setNewInvestmentAccount({
      account_name: '',
      account_type: 'brokerage',
      currency: 'ILS',
      institution: '',
      account_number: '',
      notes: '',
      institution_id: null,
    });
    setInitialValue({
      currentValue: '',
      costBasis: '',
      asOfDate: new Date().toISOString().split('T')[0],
    });
    setIsAdding(true);
  };

  const institutionSelectLevels = useMemo(() => {
    const levels: Array<{
      parentId: number | null;
      options: InstitutionTreeNode[];
      selectedId: number | null;
    }> = [];

    let parentId: number | null = null;

    for (let levelIndex = 0; levelIndex < 10; levelIndex += 1) {
      const options = institutionChildrenByParentId.get(parentId) || [];
      if (options.length === 0) break;

      const selectedId = addInstitutionPath[levelIndex] ?? null;
      levels.push({ parentId, options, selectedId });

      if (!selectedId) break;
      const selectedNode = institutionNodeById.get(selectedId);
      if (!selectedNode || selectedNode.node_type === 'institution') break;
      parentId = selectedNode.id;
    }

    return levels;
  }, [addInstitutionPath, institutionChildrenByParentId, institutionNodeById]);

  const setInstitutionSelectionAtLevel = useCallback((levelIndex: number, rawValue: string) => {
    if (!rawValue) {
      setAddInstitutionPath((prev) => prev.slice(0, levelIndex));
      return;
    }

    const nextId = Number(rawValue);
    if (!Number.isFinite(nextId)) {
      return;
    }

    setAddInstitutionPath((prev) => [...prev.slice(0, levelIndex), nextId]);
  }, [setAddInstitutionPath]);

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
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error('Failed to add account');
      }

      await fetchAccounts();
      await refetchOnboardingStatus();

      showNotification('Account added! Starting initial sync for last 3 months...', 'info');
      setIsSyncing(true);

      const syncAccount = { ...accountPayload };
      syncTimeoutRef.current = setTimeout(async () => {
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

          const scrapeResponse = await apiClient.post<ScrapeResponseData>('/api/scrape', scrapeConfig);
          const scrapeResult = scrapeResponse.data;

          if (scrapeResponse.ok && !(scrapeResult && scrapeResult.error)) {
            let transactionCount = 0;
            if (scrapeResult?.accounts) {
              transactionCount = scrapeResult.accounts.reduce((sum, acc) => {
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
      setShowNewAccountPassword(false);
      setActiveTab(0);
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

        // Create initial holding if initial value is provided
        if (newAccountId && initialValue.currentValue) {
          try {
            const holdingResponse = await apiClient.post('/api/investments/holdings', {
              account_id: newAccountId,
              current_value: parseFloat(initialValue.currentValue),
              cost_basis: initialValue.costBasis ? parseFloat(initialValue.costBasis) : null,
              as_of_date: initialValue.asOfDate,
              currency: newInvestmentAccount.currency,
            });
            if (!holdingResponse.ok) {
              console.error('Failed to create initial holding:', holdingResponse);
            }
          } catch (holdingError) {
            console.error('Error creating initial holding:', holdingError);
          }
        }

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
        setInitialValue({
          currentValue: '',
          costBasis: '',
          asOfDate: new Date().toISOString().split('T')[0],
        });
        setActiveTab(1);
        setIsAdding(false);
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
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
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
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
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
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

  const handleOpenCredentialsUpdate = (account: Account) => {
    setCredentialsUpdateAccount(account);
    setCredentialsUpdateError(null);
    setCredentialsUpdateSaving(false);
    setCredentialsUpdateShowOptional(false);
    setShowCredentialsUpdatePassword(false);

    const draft = {
      nickname: account.nickname ?? '',
      loginIdentifier: account.username ?? '',
      password: '',
      id: account.id_number ?? '',
      card6Digits: account.card6_digits ?? '',
      bankAccountNumber: account.bank_account_number ?? '',
      extraCode: account.identification_code ?? '',
    };

    setCredentialsUpdateDraft(draft);
    setCredentialsUpdateInitial(draft);
    setIsCredentialsUpdateOpen(true);
  };

  const handleCloseCredentialsUpdate = () => {
    setIsCredentialsUpdateOpen(false);
    setCredentialsUpdateAccount(null);
    setCredentialsUpdateError(null);
    setCredentialsUpdateShowOptional(false);
    setShowCredentialsUpdatePassword(false);
  };

  const handleSaveCredentialsUpdate = async () => {
    if (!credentialsUpdateAccount) return;

    const institution = institutionMap.get(credentialsUpdateAccount.vendor);
    const credentialFieldList = institution?.credentialFieldList ?? [];
    const required = new Set(Array.isArray(credentialFieldList) ? credentialFieldList : []);

    const requiresLoginIdentifier =
      required.has('username') || required.has('userCode') || required.has('email');
    const requiresId = required.has('id');
    const requiresCard6Digits = required.has('card6Digits');
    const requiresBankAccountNumber = required.has('bankAccountNumber');
    const requiresExtraCode =
      required.has('num') || required.has('nationalID') || required.has('identification_code') || required.has('otpToken');

    const effectivePassword =
      credentialsUpdateDraft.password?.trim().length > 0
        ? credentialsUpdateDraft.password
        : (credentialsUpdateAccount.password ?? '');

    if (requiresLoginIdentifier && credentialsUpdateDraft.loginIdentifier.trim().length === 0) {
      setCredentialsUpdateError(t('credentialsUpdate.validation.loginIdentifierRequired'));
      return;
    }

    if (effectivePassword.trim().length === 0) {
      setCredentialsUpdateError(t('credentialsUpdate.validation.passwordRequired'));
      return;
    }

    if (requiresId && credentialsUpdateDraft.id.trim().length === 0) {
      setCredentialsUpdateError(t('credentialsUpdate.validation.idRequired'));
      return;
    }

    if (requiresCard6Digits && credentialsUpdateDraft.card6Digits.trim().length === 0) {
      setCredentialsUpdateError(t('credentialsUpdate.validation.card6DigitsRequired'));
      return;
    }

    if (requiresBankAccountNumber && credentialsUpdateDraft.bankAccountNumber.trim().length === 0) {
      setCredentialsUpdateError(t('credentialsUpdate.validation.bankAccountNumberRequired'));
      return;
    }

    if (requiresExtraCode && credentialsUpdateDraft.extraCode.trim().length === 0) {
      setCredentialsUpdateError(t('credentialsUpdate.validation.extraCodeRequired'));
      return;
    }

    const patch: Record<string, unknown> = {};

    if (credentialsUpdateDraft.nickname !== credentialsUpdateInitial.nickname) {
      patch.nickname = credentialsUpdateDraft.nickname;
    }
    if (credentialsUpdateDraft.loginIdentifier !== credentialsUpdateInitial.loginIdentifier) {
      patch.username = credentialsUpdateDraft.loginIdentifier;
    }
    if (credentialsUpdateDraft.id !== credentialsUpdateInitial.id) {
      patch.id_number = credentialsUpdateDraft.id;
    }
    if (credentialsUpdateDraft.card6Digits !== credentialsUpdateInitial.card6Digits) {
      patch.card6_digits = credentialsUpdateDraft.card6Digits;
    }
    if (credentialsUpdateDraft.bankAccountNumber !== credentialsUpdateInitial.bankAccountNumber) {
      patch.bank_account_number = credentialsUpdateDraft.bankAccountNumber;
    }
    if (credentialsUpdateDraft.extraCode !== credentialsUpdateInitial.extraCode) {
      patch.identification_code = credentialsUpdateDraft.extraCode;
    }
    if (credentialsUpdateDraft.password.trim().length > 0) {
      patch.password = credentialsUpdateDraft.password;
    }

    if (Object.keys(patch).length === 0) {
      showNotification(t('credentialsUpdate.notifications.noChanges'), 'info');
      handleCloseCredentialsUpdate();
      return;
    }

    setCredentialsUpdateSaving(true);
    setCredentialsUpdateError(null);
    try {
      const response = await apiClient.put(`/api/credentials/${credentialsUpdateAccount.id}`, patch);
      if (!response.ok) {
        const errorData = response.data as any;
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData?.error || errorData?.message || response.statusText || 'Failed to update credentials');
      }

      showNotification(t('credentialsUpdate.notifications.updated'), 'success');
      handleCloseCredentialsUpdate();
      await fetchAccounts();
    } catch (err) {
      setCredentialsUpdateError(err instanceof Error ? err.message : t('credentialsUpdate.errors.saveFailed'));
    } finally {
      setCredentialsUpdateSaving(false);
    }
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

  const syncInitialConfig = useMemo(() => {
    if (!selectedAccount) {
      return undefined;
    }

    const institution = institutionMap.get(selectedAccount.vendor);

    return {
      options: {
        companyId: selectedAccount.vendor,
        startDate: selectedAccount.suggestedStartDate ? new Date(selectedAccount.suggestedStartDate) : new Date(),
        combineInstallments: false,
        showBrowser: false,
        additionalTransactionInformation: true,
      },
      credentials: buildSyncCredentialsForSelectedAccount(
        selectedAccount,
        institution?.credentialFieldList,
      ),
    };
  }, [selectedAccount, institutionMap]);

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
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
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
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
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
    if (!lastUpdate) return { text: t('lastUpdate.never'), color: 'default' as const };

    const date = new Date(lastUpdate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    let text = '';
    let color: 'success' | 'warning' | 'error' | 'default' = 'default';

    if (diffDays === 0) {
      if (diffHours === 0) {
        text = t('lastUpdate.justNow');
        color = 'success';
      } else {
        text = t('lastUpdate.hoursAgo', { count: diffHours });
        color = diffHours < 12 ? 'success' : 'warning';
      }
    } else if (diffDays === 1) {
      text = t('lastUpdate.yesterday');
      color = 'warning';
    } else if (diffDays < 7) {
      text = t('lastUpdate.daysAgo', { count: diffDays });
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
          padding: '48px 32px',
          color: 'text.secondary',
          fontStyle: 'italic',
          backgroundColor: 'action.hover',
          borderRadius: '12px',
        }}>
          {t('tables.investment.empty')}
        </Box>
      );
    }

    return (
      <TableContainer 
        component={Paper} 
        sx={{ 
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 4px 16px rgba(0, 0, 0, 0.4)'
            : '0 2px 12px rgba(0, 0, 0, 0.08)',
          border: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Table sx={{ bgcolor: 'background.paper' }}>
          <TableHead>
            <TableRow 
              sx={{ 
                bgcolor: (theme) => theme.palette.mode === 'dark'
                  ? 'rgba(99, 102, 241, 0.15)'
                  : 'rgba(99, 102, 241, 0.08)',
                borderBottom: (theme) => `2px solid ${theme.palette.divider}`,
              }}
            >
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.investment.account')}</TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.investment.type')}</TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.investment.institution')}</TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.investment.currentValue')}</TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.investment.lastUpdate')}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.common.actions')}</TableCell>
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
                <TableCell sx={{ py: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {account.account_name}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ py: 2 }}>
                  <Chip
                    label={accountType?.label || account.account_type}
                    size="small"
                    variant="outlined"
                    color="success"
                    sx={{
                      textTransform: 'capitalize',
                      fontWeight: 500,
                      borderRadius: '8px',
                    }}
                  />
                </TableCell>
                <TableCell sx={{ py: 2 }}>
                  {institutionFallback && !institutionMeta ? (
                    <Typography variant="body2">{institutionFallback}</Typography>
                  ) : (
                    <InstitutionBadge
                      institution={institutionMeta}
                      fallback={institutionFallback || '-'}
                    />
                  )}
                </TableCell>
                <TableCell sx={{ py: 2 }}>
                  <Box>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {account.current_value
                        ? `${account.currency} ${account.current_value.toLocaleString()}`
                        : t('tables.investment.notSet')
                      }
                    </Typography>
                    {account.current_value && !(account as any).current_value_explicit && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontStyle: 'italic' }}>
                        {t('tables.investment.fromTransactions')}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                    {account.last_update_date
                      ? new Date(account.last_update_date).toLocaleDateString()
                      : t('lastUpdate.never')
                    }
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ py: 2 }}>
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                    <Tooltip title={t('tooltips.addValueUpdate')}>
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
                        size="small"
                        sx={{
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            transform: 'scale(1.1)',
                          },
                        }}
                      >
                        <TrendingUpIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {account.account_type === 'brokerage' && (
                      <Tooltip title={t('tooltips.manageAssets')}>
                        <IconButton
                          onClick={() => {
                            fetchAssets(); // Load current assets
                            setShowAssetModal(true);
                          }}
                          color="info"
                          size="small"
                          sx={{
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                              transform: 'scale(1.1)',
                            },
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={t('tooltips.deleteAccount')}>
                      <IconButton
                        onClick={() => confirmDelete(account, 'investment')}
                        color="error"
                        size="small"
                        sx={{
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            transform: 'scale(1.1)',
                          },
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </StyledTableRow>
            );
          })}
        </TableBody>
      </Table>
      </TableContainer>
    );
  };

  const renderAccountTable = (accounts: Account[], type: 'bank' | 'credit') => {
    if (accounts.length === 0) {
      return (
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          padding: '48px 32px',
          color: 'text.secondary',
          fontStyle: 'italic',
          backgroundColor: 'action.hover',
          borderRadius: '12px',
        }}>
          {type === 'bank' ? t('tables.banking.emptyBank') : t('tables.banking.emptyCredit')}
        </Box>
      );
    }

    return (
      <TableContainer 
        component={Paper} 
        sx={{ 
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 4px 16px rgba(0, 0, 0, 0.4)'
            : '0 2px 12px rgba(0, 0, 0, 0.08)',
          border: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Table sx={{ bgcolor: 'background.paper' }}>
          <TableHead>
            <TableRow 
              sx={{ 
                bgcolor: (theme) => theme.palette.mode === 'dark'
                  ? type === 'bank'
                    ? 'rgba(33, 150, 243, 0.15)'
                    : 'rgba(156, 39, 176, 0.15)'
                  : type === 'bank'
                    ? 'rgba(33, 150, 243, 0.08)'
                    : 'rgba(156, 39, 176, 0.08)',
                borderBottom: (theme) => `2px solid ${theme.palette.divider}`,
              }}
            >
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.banking.nickname')}</TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.banking.vendor')}</TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>
                {type === 'bank' ? t('tables.banking.username') : t('tables.banking.idNumber')}
              </TableCell>
              {type === 'bank' ? (
                <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.banking.accountNumber')}</TableCell>
              ) : (
                <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.banking.cardLastDigits')}</TableCell>
              )}
              {type === 'bank' && (
                <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.banking.balance')}</TableCell>
              )}
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.banking.lastUpdate')}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: 'text.primary', py: 2 }}>{t('tables.common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
          {accounts.map((account) => {
            const lastUpdateInfo = formatLastUpdate(account.lastUpdate || '', account.lastScrapeStatus);
            return (
              <StyledTableRow key={account.id}>
                <TableCell sx={{ py: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {account.nickname}
                    </Typography>
                    {account.lastScrapeStatus === 'success' && (
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
                    )}
                    {account.lastScrapeStatus === 'failed' && (
                      <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
                    )}
                  </Box>
                </TableCell>
                <TableCell sx={{ py: 2 }}>
                  <InstitutionBadge
                    institution={account.institution as InstitutionMetadata | null}
                    fallback={account.vendor}
                  />
                </TableCell>
                <TableCell sx={{ py: 2 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                    {account.username || account.id_number}
                  </Typography>
                </TableCell>
                <TableCell sx={{ py: 2 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                    {type === 'bank' ? account.bank_account_number : (account.card6_digits || '-')}
                  </Typography>
                </TableCell>
                {type === 'bank' && (
                  <TableCell sx={{ py: 2 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'success.main' }}>
                      {account.current_balance !== null && account.current_balance !== undefined
                        ? `₪${account.current_balance.toLocaleString()}`
                        : t('tables.banking.notSet')
                      }
                    </Typography>
                    {account.balance_updated_at && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        {t('tables.banking.updated', { date: new Date(account.balance_updated_at).toLocaleDateString() })}
                      </Typography>
                    )}
                  </TableCell>
                )}
                <TableCell sx={{ py: 2 }}>
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
                    sx={{
                      fontWeight: 500,
                      borderRadius: '8px',
                    }}
                  />
                </TableCell>
                <TableCell align="right" sx={{ py: 2 }}>
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                    <Tooltip title={t('tooltips.updateCredentials')}>
                      <span>
                        <IconButton
                          onClick={() => handleOpenCredentialsUpdate(account)}
                          color="info"
                          disabled={isSyncing}
                          size="small"
                          sx={{
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                              transform: 'scale(1.1)',
                            },
                          }}
                        >
                          <SecurityIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={isSyncing ? t('tooltips.syncInProgress') : t('tooltips.syncAccount')}>
                      <span>
                        <IconButton
                          onClick={() => handleSync(account)}
                          color="primary"
                          disabled={isSyncing}
                          size="small"
                          sx={{
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                              transform: 'rotate(180deg)',
                            },
                          }}
                        >
                          {isSyncing ? <CircularProgress size={16} /> : <SyncIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('tooltips.deleteAccount')}>
                      <IconButton
                        onClick={() => confirmDelete(account, 'banking')}
                        color="error"
                        size="small"
                        sx={{
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            transform: 'scale(1.1)',
                          },
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </StyledTableRow>
            );
          })}
        </TableBody>
      </Table>
      </TableContainer>
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
        maxWidth="lg" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 20px 60px rgba(0, 0, 0, 0.7)'
              : '0 20px 60px rgba(0, 0, 0, 0.15)',
          }
        }}
        slotProps={{
          backdrop: {
            sx: {
              backdropFilter: 'blur(4px)',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
            }
          }
        }}
      >
        <ModalHeader
          title={t('title')}
          onClose={() => {
            if (isAdding) {
              setIsAdding(false);
            } else {
              onClose();
            }
          }}
          actions={
            <Box sx={{ display: 'flex', gap: 1 }}>
                  {!isAdding && activeTab === 0 && canPairAccounts && (
                    <Button
                      variant="outlined"
                      color="secondary"
                      startIcon={<LinkIcon />}
                      onClick={() => setIsPairingModalOpen(true)}
                    >
                      {t('actions.pairAccounts')}
                    </Button>
                  )}
                  {isAdding ? (
                    <Button
                      variant="outlined"
                      color="primary"
                      startIcon={<CloseIcon />}
                      onClick={() => setIsAdding(false)}
                    >
                      {t('actions.cancel')}
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={<AddIcon />}
                      onClick={beginAddAccountFlow}
                    >
                      {t('actions.addAccount')}
                    </Button>
                  )}
                </Box>
              }
            />

        {!isAdding && (
          <Box sx={{ 
            borderBottom: 1, 
            borderColor: 'divider', 
            px: 3,
            background: (theme) => theme.palette.mode === 'dark'
              ? 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 100%)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.02) 0%, transparent 100%)',
          }}>
            <Tabs 
              value={activeTab} 
              onChange={handleTabChange} 
              aria-label={t('tabs.ariaLabel')}
              sx={{
                '& .MuiTab-root': {
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                },
                '& .Mui-selected': {
                  fontWeight: 600,
                },
              }}
            >
              <Tab
                icon={<AccountBalanceIcon />}
                iconPosition="start"
                label={t('tabs.banking')}
                sx={{ textTransform: 'none', fontWeight: 500 }}
              />
              <Tab
                icon={<TrendingUpIcon />}
                iconPosition="start"
                label={t('tabs.investments')}
                sx={{ textTransform: 'none', fontWeight: 500 }}
              />
            </Tabs>
          </Box>
        )}
        <DialogContent style={{ padding: '24px' }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {isAdding ? (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 5 }}>
                <Card sx={{
                  borderRadius: '12px',
                  boxShadow: (theme) => theme.palette.mode === 'dark'
                    ? '0 4px 16px rgba(0, 0, 0, 0.4)'
                    : '0 2px 12px rgba(0, 0, 0, 0.08)',
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  transition: 'box-shadow 0.3s ease-in-out',
                  '&:hover': {
                    boxShadow: (theme) => theme.palette.mode === 'dark'
                      ? '0 8px 24px rgba(0, 0, 0, 0.5)'
                      : '0 4px 20px rgba(0, 0, 0, 0.12)',
                  },
                }}>
                  <CardHeader
                    title={t('wizard.chooseInstitutionTitle', { defaultValue: 'Choose institution' })}
                  />
                  <CardContent>
                    {institutionNodes.length === 0 ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2" color="text.secondary">
                          {t('wizard.loadingInstitutions', { defaultValue: 'Loading institutions…' })}
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        {institutionSelectLevels.map((level, levelIndex) => (
                          <TextField
                            key={`institution-level-${levelIndex}-${level.parentId ?? 'root'}`}
                            fullWidth
                            select
                            label={
                              levelIndex === 0
                                ? t('wizard.labels.category', { defaultValue: 'Category' })
                                : t('wizard.labels.next', { defaultValue: 'Next level' })
                            }
                            value={level.selectedId ?? ''}
                            onChange={(e) => setInstitutionSelectionAtLevel(levelIndex, e.target.value)}
                            SelectProps={{ displayEmpty: true }}
                            sx={{ mb: 2 }}
                          >
                            <MenuItem value="">
                              <em>
                                {levelIndex === 0
                                  ? t('wizard.placeholders.category', { defaultValue: 'Select a category' })
                                  : t('wizard.placeholders.next', { defaultValue: 'Select…' })}
                              </em>
                            </MenuItem>
                            {level.options.map((node) => (
                              <MenuItem key={node.id} value={node.id}>
                                {getInstitutionTreeNodeLabel(node, locale)}
                              </MenuItem>
                            ))}
                          </TextField>
                        ))}
                      </>
                    )}

                    {addWizardPathNodes.length > 0 && (
                      <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {addWizardPathNodes.map((node) => (
                          <Chip
                            key={node.id}
                            label={getInstitutionTreeNodeLabel(node, locale)}
                            size="small"
                            variant={node.node_type === 'institution' ? 'filled' : 'outlined'}
                          />
                        ))}
                      </Box>
                    )}

                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        onClick={() => setAddInstitutionPath([])}
                        disabled={addInstitutionPath.length === 0}
                      >
                        {t('wizard.actions.reset', { defaultValue: 'Reset' })}
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              <Grid size={{ xs: 12, md: 7 }}>
                <Card sx={{
                  borderRadius: '12px',
                  boxShadow: (theme) => theme.palette.mode === 'dark'
                    ? '0 4px 16px rgba(0, 0, 0, 0.4)'
                    : '0 2px 12px rgba(0, 0, 0, 0.08)',
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  transition: 'box-shadow 0.3s ease-in-out',
                  '&:hover': {
                    boxShadow: (theme) => theme.palette.mode === 'dark'
                      ? '0 8px 24px rgba(0, 0, 0, 0.5)'
                      : '0 4px 20px rgba(0, 0, 0, 0.12)',
                  },
                }}>
                  <CardHeader
                    title={t('wizard.accountDetailsTitle', { defaultValue: 'Account details' })}
                    subheader={
                      addWizardSelectedBadgeInstitution
                        ? getInstitutionLabel(addWizardSelectedBadgeInstitution)
                        : undefined
                    }
                  />
                  <CardContent>
                    {!addWizardSelectedInstitution || !addWizardMode ? (
                      <Alert severity="info">
                        {t('wizard.helpers.selectLeaf', { defaultValue: 'Select a specific institution to continue.' })}
                      </Alert>
                    ) : (
                      <>
                        {addWizardSelectedBadgeInstitution && (
                          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <InstitutionBadge institution={addWizardSelectedBadgeInstitution} size="medium" />
                            <Typography variant="body2" color="text.secondary">
                              {(() => {
                                const rawType = addWizardSelectedInstitution.institution_type || '';
                                const typeLabel = rawType.replace(/_/g, ' ').trim();
                                return t('wizard.selectedType', { type: typeLabel, defaultValue: typeLabel });
                              })()}
                            </Typography>
                          </Box>
                        )}

                        {addWizardMode === 'banking' ? (
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                label={t('fields.accountNickname')}
                                value={newAccount.nickname}
                                onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })}
                                placeholder={
                                  addWizardSelectedInstitution.institution_type === 'credit_card'
                                    ? t('placeholders.creditCardNickname')
                                    : t('placeholders.bankNickname')
                                }
                                required
                              />
                            </Grid>

                            {renderCredentialFieldInputs(addWizardSelectedInstitutionMeta)}

                            <Grid size={{ xs: 12 }}>
                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button onClick={() => setIsAdding(false)}>{t('actions.cancel')}</Button>
                                <Button
                                  variant="contained"
                                  color={addWizardSelectedInstitution.institution_type === 'credit_card' ? 'secondary' : 'primary'}
                                  onClick={handleAddBankingAccount}
                                >
                                  {addWizardSelectedInstitution.institution_type === 'credit_card'
                                    ? t('actions.addCreditCard')
                                    : t('actions.addBankAccount')}
                                </Button>
                              </Box>
                            </Grid>
                          </Grid>
                        ) : (
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                              {(() => {
                                const investmentMatch = newInvestmentAccount.account_name
                                  ? isExistingInvestment(newInvestmentAccount.account_name)
                                  : { match: false };
                                return (
                                  <Box>
                                    <TextField
                                      fullWidth
                                      label={t('fields.accountName')}
                                      value={newInvestmentAccount.account_name}
                                      onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_name: e.target.value })}
                                      placeholder={t('placeholders.accountName')}
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
                                            {t('helpers.foundInTransactions')}
                                          </Typography>
                                          <Chip
                                            label={investmentMatch.category || t('helpers.investmentFallback')}
                                            size="small"
                                            color="success"
                                            sx={{ height: '20px', fontSize: '0.65rem' }}
                                          />
                                          {investmentMatch.count && (
                                            <Typography variant="caption" color="text.secondary">
                                              {t('helpers.transactionsCount', { count: investmentMatch.count })}
                                            </Typography>
                                          )}
                                        </Box>
                                      </Alert>
                                    )}
                                  </Box>
                                );
                              })()}
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                fullWidth
                                select
                                label={t('fields.accountType')}
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

                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                fullWidth
                                label={t('fields.institution')}
                                value={newInvestmentAccount.institution}
                                onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, institution: e.target.value })}
                                placeholder={t('placeholders.institution')}
                              />
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                fullWidth
                                label={t('fields.accountNumber')}
                                value={newInvestmentAccount.account_number}
                                onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_number: e.target.value })}
                                placeholder={t('placeholders.optional')}
                              />
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                fullWidth
                                select
                                label={t('fields.currency')}
                                value={newInvestmentAccount.currency}
                                onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, currency: e.target.value })}
                              >
                                <MenuItem value="ILS">ILS (₪)</MenuItem>
                                <MenuItem value="USD">USD ($)</MenuItem>
                                <MenuItem value="EUR">EUR (€)</MenuItem>
                              </TextField>
                            </Grid>

                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                multiline
                                rows={2}
                                label={t('fields.notes')}
                                value={newInvestmentAccount.notes}
                                onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, notes: e.target.value })}
                                placeholder={t('placeholders.notes')}
                              />
                            </Grid>

                            <Grid size={{ xs: 12 }}>
                              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                                {t('sections.initialValue', { defaultValue: 'Initial value' })} ({t('placeholders.optional')})
                              </Typography>
                            </Grid>

                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                fullWidth
                                type="number"
                                label={t('fields.currentValue', { defaultValue: 'Current Value' })}
                                value={initialValue.currentValue}
                                onChange={(e) => setInitialValue({ ...initialValue, currentValue: e.target.value })}
                                placeholder={t('placeholders.optional')}
                                InputProps={{
                                  startAdornment: newInvestmentAccount.currency === 'ILS' ? '₪' : newInvestmentAccount.currency === 'USD' ? '$' : '€',
                                }}
                              />
                            </Grid>

                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                fullWidth
                                type="number"
                                label={t('fields.costBasis', { defaultValue: 'Cost Basis' })}
                                value={initialValue.costBasis}
                                onChange={(e) => setInitialValue({ ...initialValue, costBasis: e.target.value })}
                                placeholder={t('placeholders.optional')}
                                InputProps={{
                                  startAdornment: newInvestmentAccount.currency === 'ILS' ? '₪' : newInvestmentAccount.currency === 'USD' ? '$' : '€',
                                }}
                              />
                            </Grid>

                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                fullWidth
                                type="date"
                                label={t('fields.asOfDate', { defaultValue: 'As of Date' })}
                                value={initialValue.asOfDate}
                                onChange={(e) => setInitialValue({ ...initialValue, asOfDate: e.target.value })}
                                InputLabelProps={{ shrink: true }}
                              />
                            </Grid>

                            <Grid size={{ xs: 12 }}>
                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button onClick={() => setIsAdding(false)}>{t('actions.cancel')}</Button>
                                <Button variant="contained" onClick={handleAddInvestmentAccount}>
                                  {t('actions.addInvestmentAccount')}
                                </Button>
                              </Box>
                            </Grid>
                          </Grid>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          ) : (
            <>
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
                    sx={{ 
                      mb: 2,
                      borderRadius: '12px !important',
                      boxShadow: (theme) => theme.palette.mode === 'dark'
                        ? '0 2px 8px rgba(0, 0, 0, 0.3)'
                        : '0 2px 8px rgba(0, 0, 0, 0.06)',
                      border: (theme) => `1px solid ${theme.palette.divider}`,
                      transition: 'all 0.3s ease-in-out',
                      '&:hover': {
                        boxShadow: (theme) => theme.palette.mode === 'dark'
                          ? '0 4px 16px rgba(0, 0, 0, 0.4)'
                          : '0 4px 16px rgba(0, 0, 0, 0.1)',
                      },
                      '&:before': { display: 'none' },
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{ 
                        bgcolor: 'action.hover',
                        borderRadius: '12px 12px 0 0',
                        minHeight: '64px',
                        '&.Mui-expanded': {
                          minHeight: '64px',
                        },
                        '& .MuiAccordionSummary-content': {
                          margin: '16px 0',
                        },
                      }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <CreditCardIcon color="secondary" />
                          <Typography variant="h6">{t('sections.addCreditCardAccount')}</Typography>
                        </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                          <TextField
                            fullWidth
                            label={t('fields.accountNickname')}
                            value={newAccount.nickname}
                            onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })}
                            placeholder={t('placeholders.creditCardNickname')}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                          <TextField
                            fullWidth
                            select
                            label={t('fields.creditCardVendor')}
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

                        <Grid size={{ xs: 12 }}>
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button onClick={() => setIsAdding(false)}>{t('actions.cancel')}</Button>
                            <Button variant="contained" color="secondary" onClick={handleAdd}>
                              {t('actions.addCreditCard')}
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
                    sx={{ 
                      mb: 2,
                      borderRadius: '12px !important',
                      boxShadow: (theme) => theme.palette.mode === 'dark'
                        ? '0 2px 8px rgba(0, 0, 0, 0.3)'
                        : '0 2px 8px rgba(0, 0, 0, 0.06)',
                      border: (theme) => `1px solid ${theme.palette.divider}`,
                      transition: 'all 0.3s ease-in-out',
                      '&:hover': {
                        boxShadow: (theme) => theme.palette.mode === 'dark'
                          ? '0 4px 16px rgba(0, 0, 0, 0.4)'
                          : '0 4px 16px rgba(0, 0, 0, 0.1)',
                      },
                      '&:before': { display: 'none' },
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{ 
                        bgcolor: 'action.hover',
                        borderRadius: '12px 12px 0 0',
                        minHeight: '64px',
                        '&.Mui-expanded': {
                          minHeight: '64px',
                        },
                        '& .MuiAccordionSummary-content': {
                          margin: '16px 0',
                        },
                      }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <AccountBalanceIcon color="primary" />
                          <Typography variant="h6">{t('sections.addBankAccount')}</Typography>
                        </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                          <TextField
                            fullWidth
                            label={t('fields.accountNickname')}
                            value={newAccount.nickname}
                            onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })}
                            placeholder={t('placeholders.bankNickname')}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                        <TextField
                          fullWidth
                          select
                          label={t('fields.bank')}
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

                        <Grid size={{ xs: 12 }}>
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button onClick={() => setIsAdding(false)}>{t('actions.cancel')}</Button>
                            <Button variant="contained" color="primary" onClick={handleAdd}>
                              {t('actions.addBankAccount')}
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
                        {t('sections.bankAccounts', { count: bankAccounts.length })}
                      </Typography>
                    </SectionHeader>
                    {renderAccountTable(bankAccounts, 'bank')}
                  </AccountSection>

                  {/* Credit Card Accounts Section */}
                  <AccountSection>
                    <SectionHeader>
                      <CreditCardIcon color="secondary" sx={{ fontSize: '24px' }} />
                      <Typography variant="h6" color="secondary">
                        {t('sections.creditCardAccounts', { count: creditAccounts.length })}
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
                <Card sx={{ 
                  mb: 3,
                  borderRadius: '12px',
                  boxShadow: (theme) => theme.palette.mode === 'dark'
                    ? '0 4px 16px rgba(0, 0, 0, 0.4)'
                    : '0 2px 12px rgba(0, 0, 0, 0.08)',
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                }}>
                  <CardHeader title={t('sections.addInvestmentAccount')} />
                  <CardContent>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12 }}>
                        {(() => {
                          const investmentMatch = newInvestmentAccount.account_name ? isExistingInvestment(newInvestmentAccount.account_name) : { match: false };
                          return (
                            <Box>
                              <TextField
                                fullWidth
                                label={t('fields.accountName')}
                                value={newInvestmentAccount.account_name}
                                onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_name: e.target.value })}
                                placeholder={t('placeholders.accountName')}
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
                                      {t('helpers.foundInTransactions')}
                                    </Typography>
                                    <Chip
                                      label={investmentMatch.category || t('helpers.investmentFallback')}
                                      size="small"
                                      color="success"
                                      sx={{ height: '20px', fontSize: '0.65rem' }}
                                    />
                                    {investmentMatch.count && (
                                      <Typography variant="caption" color="text.secondary">
                                        {t('helpers.transactionsCount', { count: investmentMatch.count })}
                                      </Typography>
                                    )}
                                  </Box>
                                </Alert>
                              )}
                            </Box>
                          );
                        })()}
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          select
                          label={t('fields.accountType')}
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
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          label={t('fields.institution')}
                          value={newInvestmentAccount.institution}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, institution: e.target.value })}
                          placeholder={t('placeholders.institution')}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          select
                          label={t('fields.knownInstitution')}
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
                              ? (getInstitutionLabel(selectedInstitution, locale) || currentName)
                              : currentName;

                            setNewInvestmentAccount({
                              ...newInvestmentAccount,
                              institution_id: selectedId,
                              institution: updatedName,
                            });
                          }}
                          SelectProps={{ displayEmpty: true }}
                          helperText={t('helpers.knownInstitution')}
                        >
                              <MenuItem value="">
                                <em>{t('fields.none')}</em>
                              </MenuItem>
                          {investmentInstitutionOptions.map((institution) => (
                            <MenuItem key={institution.id} value={institution.id}>
                              {getInstitutionLabel(institution, locale)} ({institution.institution_type})
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          label={t('fields.accountNumber')}
                          value={newInvestmentAccount.account_number}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_number: e.target.value })}
                          placeholder={t('placeholders.optional')}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth
                          select
                          label={t('fields.currency')}
                          value={newInvestmentAccount.currency}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, currency: e.target.value })}
                        >
                          <MenuItem value="ILS">ILS (₪)</MenuItem>
                          <MenuItem value="USD">USD ($)</MenuItem>
                          <MenuItem value="EUR">EUR (€)</MenuItem>
                        </TextField>
                      </Grid>
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          fullWidth
                          multiline
                          rows={2}
                          label={t('fields.notes')}
                          value={newInvestmentAccount.notes}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, notes: e.target.value })}
                          placeholder={t('placeholders.notes')}
                        />
                      </Grid>
                      <Grid size={{ xs: 12 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                          {t('sections.initialValue')} ({t('helpers.optional')})
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField
                          fullWidth
                          type="number"
                          label={t('fields.currentValue')}
                          value={initialValue.currentValue}
                          onChange={(e) => setInitialValue({ ...initialValue, currentValue: e.target.value })}
                          placeholder={t('placeholders.optional')}
                          InputProps={{
                            startAdornment: newInvestmentAccount.currency === 'ILS' ? '₪' : newInvestmentAccount.currency === 'USD' ? '$' : '€',
                          }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField
                          fullWidth
                          type="number"
                          label={t('fields.costBasis')}
                          value={initialValue.costBasis}
                          onChange={(e) => setInitialValue({ ...initialValue, costBasis: e.target.value })}
                          placeholder={t('placeholders.optional')}
                          InputProps={{
                            startAdornment: newInvestmentAccount.currency === 'ILS' ? '₪' : newInvestmentAccount.currency === 'USD' ? '$' : '€',
                          }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField
                          fullWidth
                          type="date"
                          label={t('fields.asOfDate')}
                          value={initialValue.asOfDate}
                          onChange={(e) => setInitialValue({ ...initialValue, asOfDate: e.target.value })}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12 }}>
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <Button onClick={() => setIsAdding(false)}>Cancel</Button>
                          <Button variant="contained" onClick={handleAdd}>
                            {t('actions.addInvestmentAccount')}
                          </Button>
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
                          {subcategory.id === 'stability' && <SecurityIcon sx={{ color: subcategory.color, fontSize: '24px' }} />}
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
                        {t('emptyInvestments.title')}
                      </Typography>
                      <Typography variant="body2">
                        {t('emptyInvestments.description')}
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Value Update Modal */}
      <Dialog 
        open={showValueUpdateModal} 
        onClose={() => setShowValueUpdateModal(false)} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 20px 60px rgba(0, 0, 0, 0.7)'
              : '0 20px 60px rgba(0, 0, 0, 0.15)',
          }
        }}
      >
        <DialogTitle>
          {t('valueModal.title')}
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
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  select
                  label={t('fields.investmentAccount')}
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
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  type="number"
                  label={t('valueModal.currentValue')}
                  value={valueUpdate.currentValue}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, currentValue: e.target.value })}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>,
                  }}
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  type="date"
                  label={t('valueModal.asOfDate')}
                  value={valueUpdate.asOfDate}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, asOfDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  type="number"
                  label={t('valueModal.costBasis')}
                  value={valueUpdate.costBasis}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, costBasis: e.target.value })}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>,
                  }}
                  helperText={t('valueModal.costBasisHelper')}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  select
                  label={t('fields.currency')}
                  value={valueUpdate.currency}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, currency: e.target.value })}
                >
                  <MenuItem value="ILS">ILS (₪)</MenuItem>
                  <MenuItem value="USD">USD ($)</MenuItem>
                  <MenuItem value="EUR">EUR (€)</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label={t('valueModal.notes')}
                  value={valueUpdate.notes}
                  onChange={(e) => setValueUpdate({ ...valueUpdate, notes: e.target.value })}
                  placeholder={t('valueModal.notesPlaceholder')}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowValueUpdateModal(false)}>{t('actions.cancel')}</Button>
          <Button
            onClick={handleValueUpdate}
            variant="contained"
            disabled={!valueUpdate.accountId || !valueUpdate.currentValue || !valueUpdate.asOfDate}
          >
            {t('valueModal.addUpdate')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Asset Management Modal */}
      <Dialog 
        open={showAssetModal} 
        onClose={() => setShowAssetModal(false)} 
        maxWidth="md" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 20px 60px rgba(0, 0, 0, 0.7)'
              : '0 20px 60px rgba(0, 0, 0, 0.15)',
          }
        }}
      >
        <DialogTitle>
          {t('assets.manageTitle')}
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
                  <Tab label={t('tabs.individualAssets')} />
                  <Tab label={t('tabs.assetHistory')} />
            </Tabs>

            {assetTab === 0 && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">{t('assets.title')}</Typography>
                  <Button
                    startIcon={<AddIcon />}
                    onClick={() => setIsAddingAsset(true)}
                    variant="outlined"
                  >
                    {t('assets.addAsset')}
                  </Button>
                </Box>

                {isAddingAsset && (
                  <Card sx={{ 
                    mb: 3, 
                    bgcolor: 'action.hover',
                    borderRadius: '12px',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    boxShadow: (theme) => theme.palette.mode === 'dark'
                      ? '0 2px 8px rgba(0, 0, 0, 0.3)'
                      : '0 2px 8px rgba(0, 0, 0, 0.06)',
                  }}>
                    <CardContent>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            fullWidth
                            select
                            label={t('fields.investmentAccount')}
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
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            fullWidth
                            label={t('assets.symbol')}
                            value={newAsset.symbol}
                            onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value })}
                            placeholder={t('assets.symbolPlaceholder')}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField
                            fullWidth
                            type="number"
                            label={t('assets.quantity')}
                            value={newAsset.quantity}
                            onChange={(e) => setNewAsset({ ...newAsset, quantity: e.target.value })}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField
                            fullWidth
                            type="number"
                            label={t('assets.avgPrice')}
                            value={newAsset.avgPrice}
                            onChange={(e) => setNewAsset({ ...newAsset, avgPrice: e.target.value })}
                            InputProps={{
                              startAdornment: <InputAdornment position="start">$</InputAdornment>,
                            }}
                          />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField
                            fullWidth
                            type="date"
                            label={t('valueModal.asOfDate')}
                            value={newAsset.asOfDate}
                            onChange={(e) => setNewAsset({ ...newAsset, asOfDate: e.target.value })}
                            InputLabelProps={{ shrink: true }}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button onClick={handleAddAsset} variant="contained" size="small">
                              {t('assets.addAsset')}
                            </Button>
                            <Button onClick={() => setIsAddingAsset(false)} size="small">
                              {t('actions.cancel')}
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
                          <TableCell>{t('assets.table.symbol')}</TableCell>
                          <TableCell align="right">{t('assets.table.quantity')}</TableCell>
                          <TableCell align="right">{t('assets.table.avgPrice')}</TableCell>
                          <TableCell align="right">{t('assets.table.totalValue')}</TableCell>
                          <TableCell>{t('assets.table.account')}</TableCell>
                          <TableCell>{t('assets.table.lastUpdated')}</TableCell>
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
                    <Typography>{t('assets.empty')}</Typography>
                  </Box>
                )}
              </Box>
            )}

            {assetTab === 1 && (
              <Box>
                <Typography variant="h6" gutterBottom>{t('assets.historyTitle')}</Typography>
                {assetHistory.length > 0 ? (
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('assets.table.date')}</TableCell>
                          <TableCell>{t('assets.table.account')}</TableCell>
                          <TableCell>{t('assets.table.symbol')}</TableCell>
                          <TableCell align="right">{t('assets.table.quantity')}</TableCell>
                          <TableCell align="right">{t('assets.table.price')}</TableCell>
                          <TableCell align="right">{t('assets.table.totalValue')}</TableCell>
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
                    <Typography>{t('assets.historyEmpty')}</Typography>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAssetModal(false)}>{t('actions.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Credentials Update Modal */}
      <Dialog
        open={isCredentialsUpdateOpen}
        onClose={() => {
          if (!credentialsUpdateSaving) {
            handleCloseCredentialsUpdate();
          }
        }}
        disableEscapeKeyDown={credentialsUpdateSaving}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 20px 60px rgba(0, 0, 0, 0.7)'
              : '0 20px 60px rgba(0, 0, 0, 0.15)',
          }
        }}
      >
        <DialogTitle>
          {t('credentialsUpdate.title')}
          <IconButton
            onClick={handleCloseCredentialsUpdate}
            disabled={credentialsUpdateSaving}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            {credentialsUpdateError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setCredentialsUpdateError(null)}>
                {credentialsUpdateError}
              </Alert>
            )}

            <Alert severity="info" sx={{ mb: 2 }}>
              {t('credentialsUpdate.description')}
            </Alert>

            <Alert severity="info" icon={<LockIcon fontSize="small" />} sx={{ mb: 2 }}>
              {t('credentialsUpdate.security.localStorageWarning')}
            </Alert>

            {(() => {
              if (!credentialsUpdateAccount) return null;

              const institution = institutionMap.get(credentialsUpdateAccount.vendor);
              const fields = institution?.credentialFieldList ?? [];
              const required = new Set(Array.isArray(fields) ? fields : []);

              const loginLabelKey = required.has('email')
                ? 'email'
                : required.has('userCode')
                  ? 'userCode'
                  : 'username';

              const extraLabelKey = required.has('otpToken')
                ? 'otpToken'
                : required.has('num')
                  ? 'num'
                  : required.has('nationalID')
                    ? 'nationalID'
                    : 'identification_code';

              const showIdRequired = required.has('id');
              const showCard6Required = required.has('card6Digits');
              const showBankAccountRequired = required.has('bankAccountNumber');
              const showExtraRequired =
                required.has('num') || required.has('nationalID') || required.has('identification_code') || required.has('otpToken');

              const hasOtpCode = required.has('otpCode');

              const hasOptionalId = !showIdRequired;
              const hasOptionalCard6 = !showCard6Required;
              const hasOptionalBankAccount = !showBankAccountRequired;
              const hasOptionalExtra = !showExtraRequired;

              const optionalSectionVisible =
                hasOptionalId || hasOptionalCard6 || hasOptionalBankAccount || hasOptionalExtra;

              return (
                <>
                  {hasOtpCode && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      {t('credentialsUpdate.otpCodeHint')}
                    </Alert>
                  )}

                  <Grid container spacing={2} sx={{ mb: optionalSectionVisible ? 2 : 0 }}>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        label={t('fields.accountNickname')}
                        value={credentialsUpdateDraft.nickname}
                        onChange={(e) =>
                          setCredentialsUpdateDraft((prev) => ({ ...prev, nickname: e.target.value }))
                        }
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        label={t(`credentials.${loginLabelKey}`)}
                        value={credentialsUpdateDraft.loginIdentifier}
                        onChange={(e) =>
                          setCredentialsUpdateDraft((prev) => ({ ...prev, loginIdentifier: e.target.value }))
                        }
                      />
                    </Grid>

                    {showIdRequired && (
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          fullWidth
                          required
                          label={t('credentials.id')}
                          value={credentialsUpdateDraft.id}
                          onChange={(e) => setCredentialsUpdateDraft((prev) => ({ ...prev, id: e.target.value }))}
                        />
                      </Grid>
                    )}

                    {showCard6Required && (
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          fullWidth
                          required
                          label={t('credentials.card6Digits')}
                          helperText={t('credentials.card6DigitsHelper')}
                          value={credentialsUpdateDraft.card6Digits}
                          onChange={(e) => setCredentialsUpdateDraft((prev) => ({ ...prev, card6Digits: e.target.value }))}
                        />
                      </Grid>
                    )}

                    {showBankAccountRequired && (
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          fullWidth
                          required
                          label={t('credentials.bankAccountNumber')}
                          value={credentialsUpdateDraft.bankAccountNumber}
                          onChange={(e) =>
                            setCredentialsUpdateDraft((prev) => ({ ...prev, bankAccountNumber: e.target.value }))
                          }
                        />
                      </Grid>
                    )}

                    {showExtraRequired && (
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          fullWidth
                          required
                          label={t(`credentials.${extraLabelKey}`)}
                          value={credentialsUpdateDraft.extraCode}
                          onChange={(e) => setCredentialsUpdateDraft((prev) => ({ ...prev, extraCode: e.target.value }))}
                        />
                      </Grid>
                    )}

                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        type={showCredentialsUpdatePassword ? 'text' : 'password'}
                        label={t('credentials.password')}
                        value={credentialsUpdateDraft.password}
                        onChange={(e) =>
                          setCredentialsUpdateDraft((prev) => ({ ...prev, password: e.target.value }))
                        }
                        placeholder={t('credentialsUpdate.passwordPlaceholder')}
                        helperText={t('credentialsUpdate.passwordHelper')}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                edge="end"
                                onClick={() => setShowCredentialsUpdatePassword((prev) => !prev)}
                                onMouseDown={(event) => event.preventDefault()}
                                aria-label={showCredentialsUpdatePassword ? 'Hide password' : 'Show password'}
                              >
                                {showCredentialsUpdatePassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Grid>
                  </Grid>

                  {optionalSectionVisible && (
                    <Accordion
                      expanded={credentialsUpdateShowOptional}
                      onChange={() => setCredentialsUpdateShowOptional((prev) => !prev)}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{t('credentialsUpdate.optionalFields')}</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Grid container spacing={2}>
                          {hasOptionalId && (
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                label={t('credentials.id')}
                                value={credentialsUpdateDraft.id}
                                onChange={(e) =>
                                  setCredentialsUpdateDraft((prev) => ({ ...prev, id: e.target.value }))
                                }
                              />
                            </Grid>
                          )}

                          {hasOptionalCard6 && (
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                label={t('credentials.card6Digits')}
                                helperText={t('credentials.card6DigitsHelper')}
                                value={credentialsUpdateDraft.card6Digits}
                                onChange={(e) =>
                                  setCredentialsUpdateDraft((prev) => ({ ...prev, card6Digits: e.target.value }))
                                }
                              />
                            </Grid>
                          )}

                          {hasOptionalBankAccount && (
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                label={t('credentials.bankAccountNumber')}
                                value={credentialsUpdateDraft.bankAccountNumber}
                                onChange={(e) =>
                                  setCredentialsUpdateDraft((prev) => ({ ...prev, bankAccountNumber: e.target.value }))
                                }
                              />
                            </Grid>
                          )}

                          {hasOptionalExtra && (
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                label={t(`credentials.${extraLabelKey}`)}
                                value={credentialsUpdateDraft.extraCode}
                                onChange={(e) =>
                                  setCredentialsUpdateDraft((prev) => ({ ...prev, extraCode: e.target.value }))
                                }
                              />
                            </Grid>
                          )}
                        </Grid>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </>
              );
            })()}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCredentialsUpdate} disabled={credentialsUpdateSaving}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={handleSaveCredentialsUpdate} variant="contained" disabled={credentialsUpdateSaving}>
            {credentialsUpdateSaving ? t('credentialsUpdate.actions.saving') : t('credentialsUpdate.actions.save')}
          </Button>
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
        initialConfig={syncInitialConfig}
      />

      {/* Account Pairing Modal */}
      <AccountPairingModal
        isOpen={isPairingModalOpen}
        onClose={() => setIsPairingModalOpen(false)}
        creditCardAccounts={creditAccounts}
      />

      {/* Confirmation Dialog for Delete Operations */}
      <Dialog 
        open={confirmDeleteOpen} 
        onClose={() => setConfirmDeleteOpen(false)} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 20px 60px rgba(0, 0, 0, 0.7)'
              : '0 20px 60px rgba(0, 0, 0, 0.15)',
          }
        }}
      >
        <DialogTitle>
          {t('confirmDelete.title')}
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
              {t('confirmDelete.message')}
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
                {t('confirmDelete.accountLabel', { name: accountToDelete?.name || '' })}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                {t('confirmDelete.typeLabel', {
                  type: accountToDelete?.type === 'banking'
                    ? t('confirmDelete.typeBanking')
                    : t('confirmDelete.typeInvestment'),
                })}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ mt: 2, color: 'error.main' }}>
              ⚠️ {t('confirmDelete.warning')}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)} variant="outlined">
            {t('actions.cancel')}
          </Button>
          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
            startIcon={<DeleteIcon />}
          >
            {t('confirmDelete.cta')}
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

      {/* License Read-Only Alert */}
      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </>
  );
}
