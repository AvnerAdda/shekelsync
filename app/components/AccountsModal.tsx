import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
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
import PortfolioIcon from '@mui/icons-material/AccountBalanceWallet';\nimport EditIcon from '@mui/icons-material/Edit';\nimport CircularProgress from '@mui/material/CircularProgress';
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

  // Asset tracking state
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
    }
  }, [isOpen]);

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

  const handleDelete = async (accountID: number) => {
    try {
      const response = await fetch(`/api/credentials/${accountID}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setAccounts(accounts.filter((account) => account.id !== accountID));
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
      } else {
        throw new Error('Failed to delete investment account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleScrape = (account: Account) => {
    console.log('Selected account for scraping:', account);
    setSelectedAccount(account);
    setIsScrapeModalOpen(true);
  };

  const handleScrapeSuccess = () => {
    showNotification('Scraping process completed successfully!', 'success');
    window.dispatchEvent(new CustomEvent('dataRefresh'));
    fetchAccounts(); // Refresh accounts to update last sync dates
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
                  <Tooltip title="Delete Account">
                    <IconButton
                      onClick={() => handleDeleteInvestmentAccount(account.id!)}
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
                      onClick={() => handleDelete(account.id)}
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
                        <TextField
                          fullWidth
                          label="Account Name"
                          value={newInvestmentAccount.account_name}
                          onChange={(e) => setNewInvestmentAccount({ ...newInvestmentAccount, account_name: e.target.value })}
                          required
                        />
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
            startDate: new Date(),
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
    </>
  );
}