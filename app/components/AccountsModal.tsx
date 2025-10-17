import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
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
  Divider,
  Chip,
  Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ScrapeModal from './ScrapeModal';
import { CREDIT_CARD_VENDORS, BANK_VENDORS, SPECIAL_BANK_VENDORS } from '../utils/constants';
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

interface AccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:nth-of-type(odd)': {
    backgroundColor: theme.palette.action.hover,
  },
}));

const SectionHeader = styled(Box)(({ theme }) => ({
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

const AccountSection = styled(Box)(({ theme }) => ({
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isScrapeModalOpen, setIsScrapeModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
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

  useEffect(() => {
    if (isOpen) {
      fetchAccounts();
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
      const mergedAccounts = accountsWithUpdates.map(account => {
        const credential = credentials.find(c => c.id === account.id);
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

  const handleAdd = async () => {
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

  const handleScrape = (account: Account) => {
    console.log('Selected account for scraping:', account);
    const initialConfig = {
      options: {
        companyId: account.vendor,
        startDate: new Date(),
        combineInstallments: false,
        showBrowser: true,
        additionalTransactionInformation: true
      },
      credentials: {
        id: account.id_number,
        card6Digits: account.card6_digits,
        password: account.password,
        username: account.username,
        bankAccountNumber: account.bank_account_number,
        identification_code: account.identification_code,
        nickname: account.nickname
      }
    };
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
              onClick={() => setIsAdding(true)}
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
        <DialogContent style={{ padding: '0 24px 24px' }}>
          {error && (
            <div style={{
              backgroundColor: '#fee2e2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              {error}
            </div>
          )}
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
              Loading accounts...
            </Box>
          ) : accounts.length === 0 && !isAdding ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
              No saved accounts found
            </Box>
          ) : isAdding ? (
            <Box sx={{ p: 2 }}>
              <TextField
                fullWidth
                label="Account Nickname"
                value={newAccount.nickname}
                onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })}
                margin="normal"
                required
              />
              <TextField
                fullWidth
                select
                label="Vendor"
                value={newAccount.vendor}
                onChange={(e) => {
                  const vendor = e.target.value;
                  setNewAccount({
                    ...newAccount,
                    vendor,
                    // Clear fields that are not used for the selected vendor
                    username: (vendor === 'visaCal' || vendor === 'max' || BANK_VENDORS.includes(vendor)) ? newAccount.username : '',
                    id_number: (vendor === 'isracard' || vendor === 'amex' || SPECIAL_BANK_VENDORS.includes(vendor)) ? newAccount.id_number : '',
                    identification_code: SPECIAL_BANK_VENDORS.includes(vendor) ? newAccount.identification_code : '',
                    bank_account_number: BANK_VENDORS.includes(vendor) ? newAccount.bank_account_number : '',
                  });
                }}
                margin="normal"
              >
                <MenuItem value="isracard">Isracard</MenuItem>
                <MenuItem value="amex">American Express</MenuItem>
                <MenuItem value="visaCal">Visa Cal</MenuItem>
                <MenuItem value="max">Max</MenuItem>
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
              {(newAccount.vendor === 'visaCal' || newAccount.vendor === 'max' || BANK_VENDORS.includes(newAccount.vendor)) ? (
                <TextField
                  fullWidth
                  label="Username"
                  value={newAccount.username}
                  onChange={(e) => setNewAccount({ ...newAccount, username: e.target.value })}
                  margin="normal"
                  required
                />
              ) : (
                <TextField
                  fullWidth
                  label="ID Number"
                  value={newAccount.id_number}
                  onChange={(e) => setNewAccount({ ...newAccount, id_number: e.target.value })}
                  margin="normal"
                  required
                />
              )}
              {SPECIAL_BANK_VENDORS.includes(newAccount.vendor) && (
                <TextField
                  fullWidth
                  label="Identification Code (num)"
                  value={newAccount.identification_code}
                  onChange={(e) => setNewAccount({ ...newAccount, identification_code: e.target.value })}
                  margin="normal"
                  required
                  helperText="User identification code - required by Discount/Mercantile"
                />
              )}
              {BANK_VENDORS.includes(newAccount.vendor) && (
                <TextField
                  fullWidth
                  label="Bank Account Number"
                  value={newAccount.bank_account_number}
                  onChange={(e) => {debugger; setNewAccount({ ...newAccount, bank_account_number: e.target.value })}}
                  margin="normal"
                  required
                />
              )}
              {(newAccount.vendor === 'isracard' || newAccount.vendor === 'amex') && (
                <TextField
                  fullWidth
                  label="Card Last 6 Digits"
                  value={newAccount.card6_digits}
                  onChange={(e) => setNewAccount({ ...newAccount, card6_digits: e.target.value })}
                  margin="normal"
                />
              )}
              <TextField
                fullWidth
                label="Password"
                type="password"
                value={newAccount.password}
                onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                margin="normal"
                required
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button onClick={() => setIsAdding(false)} sx={{ mr: 1 }}>
                  Cancel
                </Button>
                <Button variant="contained" onClick={handleAdd}>
                  Add
                </Button>
              </Box>
            </Box>
          ) : (
            <Box>
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