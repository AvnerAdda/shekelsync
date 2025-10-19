import React, { useState, useEffect } from 'react';
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
  AlertTitle,
  InputAdornment,
  Paper,
} from '@mui/material';
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
import CircularProgress from '@mui/material/CircularProgress';
import ScrapeModal from './ScrapeModal';
import {
  CREDIT_CARD_VENDORS,
  BANK_VENDORS,
  SPECIAL_BANK_VENDORS,
  ACCOUNT_CATEGORIES,
  INVESTMENT_ACCOUNT_TYPES
} from '../utils/constants';
import { dateUtils } from './CategoryDashboard/utils/dateUtils';
import { useNotification } from './NotificationContext';
import ModalHeader from './ModalHeader';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import { matchAccount, calculateSimilarity } from '../utils/account-matcher';

interface Account {
  id: number;
  vendor: string;
  username?: string;
  id_number?: string;
  card6_digits?: string;
  bank_account_number?: string;
  identification_code?: string;
  nickname?: string;
  password?: string;
  created_at: string;
  lastUpdate?: string;
  lastScrapeStatus?: string;
  current_balance?: number;
  balance_updated_at?: string;
  suggestedStartDate?: string;
  startDateMessage?: string;
}

interface InvestmentAccount {
  id?: number;
  account_name: string;
  account_type: string;
  institution?: string;
  account_number?: string;
  currency: string;
  notes?: string;
  is_liquid?: boolean;
  investment_category?: string;
  current_value?: number;
  holdings_count?: number;
  last_update_date?: string;
}

interface AccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:nth-of-type(odd)': {
    backgroundColor: theme.palette.action.hover,
  },
}));

const SectionHeader = styled(Box)(() => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '20px 0 16px 0',
  marginBottom: '20px',
  borderBottom: '2px solid #e2e8f0',
  background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
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

const AccountSection = styled(Box)(() => ({
  marginBottom: '40px',
  padding: '16px',
  borderRadius: '12px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#fafbfc',
  '&:last-child': {
    marginBottom: 0,
  },
}));

export default function AccountsModal({ isOpen, onClose }: AccountsModalProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isScrapeModalOpen, setIsScrapeModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [currentAccountType, setCurrentAccountType] = useState<'banking' | 'investment'>('banking');
  const { showNotification } = useNotification();
  const { formatCurrency } = useFinancePrivacy();
  const [newAccount, setNewAccount] = useState<Account>({
    vendor: 'isracard',
    username: '',
    id_number: '',
    card6_digits: '',
    bank_account_number: '',
    identification_code: '',
    password: '',
    nickname: '',
    id: 0,
    created_at: new Date().toISOString(),
  });

  const [newInvestmentAccount, setNewInvestmentAccount] = useState<InvestmentAccount>({
    account_name: '',
    account_type: 'brokerage',
    currency: 'ILS',
    institution: '',
    account_number: '',
    notes: '',
  });

  // Holdings management state
  const [isValueModalOpen, setIsValueModalOpen] = useState(false);
  const [selectedInvestmentAccount, setSelectedInvestmentAccount] = useState<InvestmentAccount | null>(null);
  const [currentHolding, setCurrentHolding] = useState<{
    current_value: number | '';
    cost_basis: number | '';
    as_of_date: string;
    notes: string;
  }>({
    current_value: '',
    cost_basis: '',
    as_of_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [costBasisSuggestion, setCostBasisSuggestion] = useState<any>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [existingInvestments, setExistingInvestments] = useState<any>(null);

  // Additional modal states for new features
  const [showValueUpdateModal, setShowValueUpdateModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetTab, setAssetTab] = useState(0);
  const [isAddingAsset, setIsAddingAsset] = useState(false);

  // Value update state
  const [valueUpdate, setValueUpdate] = useState({
    accountId: '',
    currentValue: '',
    asOfDate: new Date().toISOString().split('T')[0],
    costBasis: '',
    currency: 'ILS',
    notes: '',
  });

  // Cost basis suggestions state
  const [costBasisSuggestions, setCostBasisSuggestions] = useState<any[]>([]);

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

  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [currentAsset, setCurrentAsset] = useState<{
    asset_symbol: string;
    asset_name: string;
    asset_type: string;
    units: number | '';
    currency: string;
  }>({
    asset_symbol: '',
    asset_name: '',
    asset_type: 'stock',
    units: '',
    currency: 'USD',
  });

  useEffect(() => {
    if (isOpen) {
      fetchAccounts();
      fetchInvestmentAccounts();
      loadExistingInvestments();
    }
  }, [isOpen]);

  // Load cost basis suggestion when account is selected for value update
  useEffect(() => {
    if (selectedInvestmentAccount && isValueModalOpen) {
      loadCostBasisSuggestion(selectedInvestmentAccount.id!);
    } else {
      setCostBasisSuggestion(null);
    }
  }, [selectedInvestmentAccount, isValueModalOpen]);

  const fetchAccounts = async () => {
    try {
      setIsLoading(true);
      // Fetch accounts with last update information
      const response = await fetch('/api/accounts/last-update');
      if (!response.ok) {
        throw new Error('Failed to fetch accounts');
      }
      const accountsWithUpdates = await response.json();

      // Also fetch complete account info for password and other fields
      const credentialsResponse = await fetch('/api/credentials');
      if (!credentialsResponse.ok) {
        throw new Error('Failed to fetch credentials');
      }
      const credentials = await credentialsResponse.json();

      // Merge the data
      const mergedAccounts = accountsWithUpdates.map((account: any) => {
        const credential = credentials.find((c: any) => c.id === account.id);
        return {
          ...credential,
          lastUpdate: account.lastUpdate,
          lastScrapeStatus: account.lastScrapeStatus,
        };
      });

      console.log('Fetched accounts with updates:', mergedAccounts);
      setAccounts(mergedAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInvestmentAccounts = async () => {
    try {
      const response = await fetch('/api/investments/accounts');
      if (response.ok) {
        const data = await response.json();
        setInvestmentAccounts(data.accounts || []);
      }
    } catch (err) {
      console.error('Error loading investment accounts:', err);
    }
  };

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
    // Validate based on vendor type
    if (newAccount.vendor === 'visaCal' || newAccount.vendor === 'max') {
      if (!newAccount.username) {
        setError('Username is required for Visa Cal and Max');
        return;
      }
    } else if (SPECIAL_BANK_VENDORS.includes(newAccount.vendor)) {
      // Discount and Mercantile require: id, password, num (identification_code)
      if (!newAccount.id_number) {
        setError('ID number is required for Discount and Mercantile');
        return;
      }
      if (!newAccount.identification_code) {
        setError('Identification code (num) is required for Discount and Mercantile');
        return;
      }
    } else if (newAccount.vendor === 'isracard' || newAccount.vendor === 'amex') {
      if (!newAccount.id_number) {
        setError('ID number is required for Isracard and American Express');
        return;
      }
    } else if (BANK_VENDORS.includes(newAccount.vendor)) {
      if (!newAccount.username) {
        setError('Username is required for bank accounts');
        return;
      }
      if (!newAccount.bank_account_number) {
        setError('Bank account number is required for bank accounts');
        return;
      }
    }

    if (!newAccount.password) {
      setError('Password is required');
      return;
    }
    if (!newAccount.nickname) {
      setError('Account nickname is required');
      return;
    }

    try {
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newAccount),
      });

      if (response.ok) {
        await fetchAccounts();
        setNewAccount({
          vendor: 'isracard',
          username: '',
          id_number: '',
          card6_digits: '',
          bank_account_number: '',
          identification_code: '',
          password: '',
          nickname: '',
          id: 0,
          created_at: new Date().toISOString(),
        });
        setIsAdding(false);
      } else {
        throw new Error('Failed to add account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleAddInvestmentAccount = async () => {
    if (!newInvestmentAccount.account_name || !newInvestmentAccount.account_type) {
      setError('Please enter account name and type');
      return;
    }

    try {
      const response = await fetch('/api/investments/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInvestmentAccount),
      });

      if (response.ok) {
        await fetchInvestmentAccounts();
        setNewInvestmentAccount({
          account_name: '',
          account_type: 'brokerage',
          currency: 'ILS',
          institution: '',
          account_number: '',
          notes: '',
        });
        setIsAdding(false);
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
      const response = await fetch(`/api/credentials/${accountID}`, {
        method: 'DELETE',
      });
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
      const response = await fetch(`/api/investments/accounts?id=${accountID}`, {
        method: 'DELETE',
      });
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

  // Add Value Update functionality
  const handleAddValueUpdate = (account: InvestmentAccount) => {
    setSelectedInvestmentAccount(account);
    setCurrentHolding({
      current_value: '',
      cost_basis: '',
      as_of_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setIsValueModalOpen(true);
  };

  const handleSaveValueUpdate = async () => {
    if (!selectedInvestmentAccount || !currentHolding.current_value || !currentHolding.as_of_date) {
      setError('Please enter current value and date');
      return;
    }

    try {
      const response = await fetch('/api/investments/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: selectedInvestmentAccount.id,
          current_value: Number(currentHolding.current_value),
          cost_basis: currentHolding.cost_basis ? Number(currentHolding.cost_basis) : null,
          as_of_date: currentHolding.as_of_date,
          notes: currentHolding.notes,
          save_history: true,
        }),
      });

      if (response.ok) {
        await fetchInvestmentAccounts(); // Refresh to show updated values
        setIsValueModalOpen(false);
        setSelectedInvestmentAccount(null);
        showNotification('Value update saved successfully!', 'success');
      } else {
        throw new Error('Failed to save value update');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  // Cost basis suggestion functionality
  const loadCostBasisSuggestion = async (accountId: number) => {
    setLoadingSuggestion(true);
    setCostBasisSuggestion(null);

    try {
      const response = await fetch(`/api/investments/suggest-cost-basis?account_id=${accountId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.suggestion.has_new_transactions) {
          setCostBasisSuggestion(data);
        }
      }
    } catch (err) {
      console.error('Error loading cost basis suggestion:', err);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const applyCostBasisSuggestion = () => {
    if (costBasisSuggestion) {
      setCurrentHolding({
        ...currentHolding,
        cost_basis: costBasisSuggestion.suggestion.suggested_cost_basis,
      });
    }
  };

  // Existing investments matching functionality
  const loadExistingInvestments = async () => {
    try {
      const response = await fetch('/api/investments/check-existing');
      if (response.ok) {
        const data = await response.json();
        setExistingInvestments(data);
      }
    } catch (err) {
      console.error('Error loading existing investments:', err);
    }
  };

  // Check if account name matches existing investment transactions
  const isExistingInvestment = (accountName: string, accountType?: string): { match: boolean; category?: string; count?: number; confidence?: number } => {
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
          category: vendor.subcategory || vendor.category,
          count: vendor.transactionCount,
          confidence: Math.max(vendorSimilarity, nameSimilarity)
        };
      }
    }

    return { match: false };
  };

  // Asset management functionality
  const handleAddAssets = (account: InvestmentAccount) => {
    if (account.account_type !== 'brokerage') {
      setError('Asset tracking is only available for brokerage accounts');
      return;
    }
    setSelectedInvestmentAccount(account);
    setCurrentAsset({
      asset_symbol: '',
      asset_name: '',
      asset_type: 'stock',
      units: '',
      currency: 'USD',
    });
    setIsAssetModalOpen(true);
  };

  const handleSaveAsset = async () => {
    if (!selectedInvestmentAccount || !currentAsset.asset_name || !currentAsset.units) {
      setError('Please enter asset name and units');
      return;
    }

    try {
      const response = await fetch('/api/investments/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: selectedInvestmentAccount.id,
          asset_symbol: currentAsset.asset_symbol,
          asset_name: currentAsset.asset_name,
          asset_type: currentAsset.asset_type,
          units: Number(currentAsset.units),
          currency: currentAsset.currency,
        }),
      });

      if (response.ok) {
        setIsAssetModalOpen(false);
        setSelectedInvestmentAccount(null);
        showNotification('Asset added successfully!', 'success');
      } else {
        throw new Error('Failed to save asset');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleScrape = async (account: Account) => {
    console.log('Selected account for scraping:', account);
    setSelectedAccount(account);

    // Fetch the last transaction date for this vendor to set as default start date
    try {
      const response = await fetch(`/api/accounts/last-transaction-date?vendor=${account.vendor}`);
      if (response.ok) {
        const data = await response.json();
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

    setIsScrapeModalOpen(true);
  };

  const handleScrapeSuccess = () => {
    showNotification('Scraping process completed successfully!', 'success');
    window.dispatchEvent(new CustomEvent('dataRefresh'));
    fetchAccounts(); // Refresh accounts to update last sync dates
  };

  // Handler for value update modal
  const handleValueUpdate = async () => {
    if (!valueUpdate.accountId || !valueUpdate.currentValue || !valueUpdate.asOfDate) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      const response = await fetch('/api/investments/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: valueUpdate.accountId,
          current_value: parseFloat(valueUpdate.currentValue),
          cost_basis: valueUpdate.costBasis ? parseFloat(valueUpdate.costBasis) : null,
          as_of_date: valueUpdate.asOfDate,
          currency: valueUpdate.currency,
          notes: valueUpdate.notes,
        }),
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
        const errorData = await response.json();
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
      const response = await fetch('/api/investments/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: newAsset.accountId,
          symbol: newAsset.symbol,
          quantity: parseFloat(newAsset.quantity),
          avg_price: newAsset.avgPrice ? parseFloat(newAsset.avgPrice) : null,
          as_of_date: newAsset.asOfDate,
        }),
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
        const errorData = await response.json();
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
      const response = await fetch('/api/investments/assets');
      if (response.ok) {
        const data = await response.json();
        setAssets(data.assets || []);
        setAssetHistory(data.history || []);
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
      text = dateUtils.formatDate(lastUpdate);
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
  const bankAccounts = accounts.filter(account => BANK_VENDORS.includes(account.vendor) || SPECIAL_BANK_VENDORS.includes(account.vendor));
  const creditAccounts = accounts.filter(account => CREDIT_CARD_VENDORS.includes(account.vendor));

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
      <Table sx={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
        <TableHead>
          <TableRow sx={{ backgroundColor: '#f8fafc' }}>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Account Name</TableCell>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Type</TableCell>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Institution</TableCell>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Current Value</TableCell>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Last Update</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600, color: '#374151' }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {accounts.map((account) => {
            const accountType = INVESTMENT_ACCOUNT_TYPES.find(t => t.value === account.account_type);
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
                    sx={{
                      textTransform: 'capitalize',
                      borderColor: '#388e3c',
                      color: '#388e3c',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {account.institution || '-'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                    {account.current_value
                      ? `${account.currency} ${account.current_value.toLocaleString()}`
                      : 'Not set'
                    }
                  </Typography>
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
                      onClick={() => {
                        setValueUpdate({ ...valueUpdate, accountId: account.id?.toString() || '' });
                        setShowValueUpdateModal(true);
                      }}
                      sx={{
                        color: '#388e3c',
                        '&:hover': {
                          backgroundColor: 'rgba(56, 142, 60, 0.1)',
                        },
                      }}
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
                        sx={{
                          color: '#2196f3',
                          '&:hover': {
                            backgroundColor: 'rgba(33, 150, 243, 0.1)',
                          },
                        }}
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Delete Account">
                    <IconButton
                      onClick={() => confirmDelete(account, 'investment')}
                      sx={{
                        color: '#ef4444',
                        '&:hover': {
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        },
                      }}
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
      <Table sx={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
        <TableHead>
          <TableRow sx={{ backgroundColor: '#f8fafc' }}>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Nickname</TableCell>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Vendor</TableCell>
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>
              {type === 'bank' ? 'Username' : 'ID Number'}
            </TableCell>
            {type === 'bank' ? (
              <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Account Number</TableCell>
            ) : (
              <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Card Last Digits</TableCell>
            )}
            {type === 'bank' && (
              <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Balance</TableCell>
            )}
            <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Last Update</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600, color: '#374151' }}>Actions</TableCell>
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
                  <Chip
                    label={account.vendor}
                    size="small"
                    variant="outlined"
                    sx={{
                      textTransform: 'capitalize',
                      borderColor: type === 'bank' ? '#3b82f6' : '#8b5cf6',
                      color: type === 'bank' ? '#3b82f6' : '#8b5cf6',
                    }}
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
                  <Tooltip title="Refresh Account Data">
                    <IconButton
                      onClick={() => handleScrape(account)}
                      sx={{
                        color: '#3b82f6',
                        '&:hover': {
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                      }}
                    >
                      <SyncIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete Account">
                    <IconButton
                      onClick={() => confirmDelete(account, 'banking')}
                      sx={{
                        color: '#ef4444',
                        '&:hover': {
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        },
                      }}
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
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setCurrentAccountType(activeTab === 0 ? 'banking' : 'investment');
                setIsAdding(true);
              }}
              sx={{
                backgroundColor: '#3b82f6',
                '&:hover': {
                  backgroundColor: '#2563eb',
                },
              }}
            >
              Add Account
            </Button>
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
                  <Card sx={{ mb: 3 }}>
                    <CardHeader
                      title="Add Credit Card Account"
                      avatar={<CreditCardIcon sx={{ color: '#7b1fa2' }} />}
                      sx={{ bgcolor: 'rgba(123, 31, 162, 0.05)' }}
                    />
                    <CardContent>
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
                            value={CREDIT_CARD_VENDORS.includes(newAccount.vendor) ? newAccount.vendor : ''}
                            onChange={(e) => {
                              const vendor = e.target.value;
                              setNewAccount({
                                ...newAccount,
                                vendor,
                                username: (vendor === 'visaCal' || vendor === 'max') ? newAccount.username : '',
                                id_number: (vendor === 'isracard' || vendor === 'amex') ? newAccount.id_number : '',
                                identification_code: '',
                                bank_account_number: '',
                              });
                            }}
                          >
                            <MenuItem value="isracard">Isracard</MenuItem>
                            <MenuItem value="amex">American Express</MenuItem>
                            <MenuItem value="visaCal">Visa Cal</MenuItem>
                            <MenuItem value="max">Max</MenuItem>
                          </TextField>
                        </Grid>

                        {CREDIT_CARD_VENDORS.includes(newAccount.vendor) && (
                          <>
                            {(newAccount.vendor === 'visaCal' || newAccount.vendor === 'max') ? (
                              <Grid item xs={12}>
                                <TextField
                                  fullWidth
                                  label="Username"
                                  value={newAccount.username}
                                  onChange={(e) => setNewAccount({ ...newAccount, username: e.target.value })}
                                  required
                                />
                              </Grid>
                            ) : (
                              <Grid item xs={12}>
                                <TextField
                                  fullWidth
                                  label="ID Number"
                                  value={newAccount.id_number}
                                  onChange={(e) => setNewAccount({ ...newAccount, id_number: e.target.value })}
                                  required
                                />
                              </Grid>
                            )}

                            {(newAccount.vendor === 'isracard' || newAccount.vendor === 'amex') && (
                              <Grid item xs={12}>
                                <TextField
                                  fullWidth
                                  label="Card Last 6 Digits (Optional)"
                                  value={newAccount.card6_digits}
                                  onChange={(e) => setNewAccount({ ...newAccount, card6_digits: e.target.value })}
                                  placeholder="123456"
                                />
                              </Grid>
                            )}

                            <Grid item xs={12}>
                              <TextField
                                fullWidth
                                label="Password"
                                type="password"
                                value={newAccount.password}
                                onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                                required
                              />
                            </Grid>

                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button onClick={() => setIsAdding(false)}>Cancel</Button>
                                <Button variant="contained" onClick={handleAdd} sx={{ bgcolor: '#7b1fa2' }}>
                                  Add Credit Card
                                </Button>
                              </Box>
                            </Grid>
                          </>
                        )}
                      </Grid>
                    </CardContent>
                  </Card>

                  {/* Bank Account Form */}
                  <Card sx={{ mb: 3 }}>
                    <CardHeader
                      title="Add Bank Account"
                      avatar={<AccountBalanceIcon sx={{ color: '#1976d2' }} />}
                      sx={{ bgcolor: 'rgba(25, 118, 210, 0.05)' }}
                    />
                    <CardContent>
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
                            value={[...BANK_VENDORS, ...SPECIAL_BANK_VENDORS].includes(newAccount.vendor) ? newAccount.vendor : ''}
                            onChange={(e) => {
                              const vendor = e.target.value;
                              setNewAccount({
                                ...newAccount,
                                vendor,
                                username: BANK_VENDORS.includes(vendor) ? newAccount.username : '',
                                id_number: SPECIAL_BANK_VENDORS.includes(vendor) ? newAccount.id_number : '',
                                identification_code: SPECIAL_BANK_VENDORS.includes(vendor) ? newAccount.identification_code : '',
                                bank_account_number: [...BANK_VENDORS, ...SPECIAL_BANK_VENDORS].includes(vendor) ? newAccount.bank_account_number : '',
                                card6_digits: '',
                              });
                            }}
                          >
                            <MenuItem value="hapoalim">Bank Hapoalim</MenuItem>
                            <MenuItem value="leumi">Bank Leumi</MenuItem>
                            <MenuItem value="mizrahi">Mizrahi Tefahot</MenuItem>
                            <MenuItem value="discount">Discount Bank</MenuItem>
                            <MenuItem value="mercantile">Mercantile Bank</MenuItem>
                            <MenuItem value="otsarHahayal">Otsar Hahayal</MenuItem>
                            <MenuItem value="beinleumi">Beinleumi</MenuItem>
                            <MenuItem value="massad">Massad</MenuItem>
                            <MenuItem value="yahav">Yahav</MenuItem>
                            <MenuItem value="union">Union Bank</MenuItem>
                          </TextField>
                        </Grid>

                        {[...BANK_VENDORS, ...SPECIAL_BANK_VENDORS].includes(newAccount.vendor) && (
                          <>
                            {BANK_VENDORS.includes(newAccount.vendor) ? (
                              <Grid item xs={12}>
                                <TextField
                                  fullWidth
                                  label="Username"
                                  value={newAccount.username}
                                  onChange={(e) => setNewAccount({ ...newAccount, username: e.target.value })}
                                  required
                                />
                              </Grid>
                            ) : (
                              <Grid item xs={12}>
                                <TextField
                                  fullWidth
                                  label="ID Number"
                                  value={newAccount.id_number}
                                  onChange={(e) => setNewAccount({ ...newAccount, id_number: e.target.value })}
                                  required
                                />
                              </Grid>
                            )}

                            {SPECIAL_BANK_VENDORS.includes(newAccount.vendor) && (
                              <Grid item xs={12}>
                                <TextField
                                  fullWidth
                                  label="Identification Code (num)"
                                  value={newAccount.identification_code}
                                  onChange={(e) => setNewAccount({ ...newAccount, identification_code: e.target.value })}
                                  required
                                  helperText="User identification code - required by Discount/Mercantile"
                                />
                              </Grid>
                            )}

                            <Grid item xs={12}>
                              <TextField
                                fullWidth
                                label="Bank Account Number"
                                value={newAccount.bank_account_number}
                                onChange={(e) => setNewAccount({ ...newAccount, bank_account_number: e.target.value })}
                                required
                                placeholder="Full account number"
                              />
                            </Grid>

                            <Grid item xs={12}>
                              <TextField
                                fullWidth
                                label="Password"
                                type="password"
                                value={newAccount.password}
                                onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                                required
                              />
                            </Grid>

                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button onClick={() => setIsAdding(false)}>Cancel</Button>
                                <Button variant="contained" onClick={handleAdd} sx={{ bgcolor: '#1976d2' }}>
                                  Add Bank Account
                                </Button>
                              </Box>
                            </Grid>
                          </>
                        )}
                      </Grid>
                    </CardContent>
                  </Card>
                </Box>
              ) : (
                <>
                  {/* Bank Accounts Section */}
                  <AccountSection>
                    <SectionHeader>
                      <AccountBalanceIcon sx={{ color: '#3b82f6', fontSize: '24px' }} />
                      <Typography variant="h6" color="primary">
                        Bank Accounts ({bankAccounts.length})
                      </Typography>
                    </SectionHeader>
                    {renderAccountTable(bankAccounts, 'bank')}
                  </AccountSection>

                  {/* Credit Card Accounts Section */}
                  <AccountSection>
                    <SectionHeader>
                      <CreditCardIcon sx={{ color: '#8b5cf6', fontSize: '24px' }} />
                      <Typography variant="h6" sx={{ color: '#8b5cf6' }}>
                        Credit Card Accounts ({creditAccounts.length})
                      </Typography>
                    </SectionHeader>
                    {renderAccountTable(creditAccounts, 'credit')}
                  </AccountSection>
                </>
              )}
            </Box>
          )}

          {activeTab === 1 && (
            <Box>
              {/* Investments & Savings Tab */}
              {isAdding && currentAccountType === 'investment' ? (
                <Card sx={{ mb: 3 }}>
                  <CardHeader title="Add Investment Account" />
                  <CardContent>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        {(() => {
                          const investmentMatch = newInvestmentAccount.account_name ? isExistingInvestment(newInvestmentAccount.account_name, newInvestmentAccount.account_type) : { match: false };
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
                                      sx={{ bgcolor: '#4caf50', color: 'white', height: '20px', fontSize: '0.65rem' }}
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
                  {Object.entries(ACCOUNT_CATEGORIES.INVESTMENTS.subcategories).map(([key, subcategory]) => {
                    const categoryAccounts = investmentAccounts.filter(acc =>
                      subcategory.types.includes(acc.account_type)
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
              {costBasisSuggestions.length > 0 && (
                <Grid item xs={12}>
                  <Alert severity="info" sx={{ mt: 1 }}>
                    <AlertTitle>Cost Basis Suggestions</AlertTitle>
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {costBasisSuggestions.map((suggestion, index) => (
                        <Chip
                          key={index}
                          label={`₪${suggestion.amount.toLocaleString()} (${suggestion.count} transactions)`}
                          onClick={() => setValueUpdate({ ...valueUpdate, costBasis: suggestion.amount.toString() })}
                          clickable
                          size="small"
                          sx={{ bgcolor: '#e3f2fd', '&:hover': { bgcolor: '#bbdefb' } }}
                        />
                      ))}
                    </Box>
                  </Alert>
                </Grid>
              )}
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
                  <Card sx={{ mb: 3, bgcolor: '#f8f9fa' }}>
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

      <ScrapeModal
        isOpen={isScrapeModalOpen}
        onClose={() => {
          setIsScrapeModalOpen(false);
          setSelectedAccount(null);
        }}
        onSuccess={handleScrapeSuccess}
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
              bgcolor: '#fff3cd',
              border: '1px solid #ffeaa7',
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
    </>
  );
}