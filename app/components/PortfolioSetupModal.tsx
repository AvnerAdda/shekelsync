import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  Typography,
  Alert,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Grid,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  AccountBalance as AccountIcon,
  TrendingUp as StockIcon,
  TrendingUp,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import { matchAccount, calculateSimilarity } from '../utils/account-matcher';
import { apiClient } from '@/lib/api-client';

interface PortfolioSetupModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface Account {
  id?: number;
  account_name: string;
  account_type: string;
  institution?: string;
  account_number?: string;
  currency: string;
  notes?: string;
}

interface Holding {
  account_id: number;
  current_value: number;
  cost_basis?: number;
  as_of_date: string;
  notes?: string;
}

interface Asset {
  id?: number;
  account_id: number;
  asset_symbol?: string;
  asset_name: string;
  asset_type?: string;
  units: number;
  average_cost?: number;
  currency: string;
  notes?: string;
}

const ACCOUNT_TYPES = [
  { value: 'pension', label: 'Pension Fund', label_he: 'קרן פנסיה' },
  { value: 'provident', label: 'Provident Fund', label_he: 'קרן השתלמות' },
  { value: 'study_fund', label: 'Study Fund', label_he: 'קופת גמל' },
  { value: 'savings', label: 'Savings', label_he: 'פיקדון' },
  { value: 'brokerage', label: 'Brokerage', label_he: 'ברוקר' },
  { value: 'crypto', label: 'Crypto', label_he: 'קריפטו' },
  { value: 'mutual_fund', label: 'Mutual Funds', label_he: 'קרנות נאמנות' },
  { value: 'bonds', label: 'Bonds', label_he: 'אג"ח' },
  { value: 'real_estate', label: 'Real Estate', label_he: 'נדל"ן' },
  { value: 'other', label: 'Other', label_he: 'אחר' },
];

const ASSET_TYPES = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: 'Bond' },
  { value: 'crypto', label: 'Cryptocurrency' },
  { value: 'mutual_fund', label: 'Mutual Fund' },
  { value: 'other', label: 'Other' },
];

const PortfolioSetupModal: React.FC<PortfolioSetupModalProps> = ({ open, onClose, onComplete }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account>({
    account_name: '',
    account_type: 'brokerage',
    currency: 'ILS',
  });
  const [currentHolding, setCurrentHolding] = useState<Partial<Holding>>({
    as_of_date: new Date().toISOString().split('T')[0],
  });
  const [holdings, setHoldings] = useState<Partial<Holding>[]>([]);
  const [currentAsset, setCurrentAsset] = useState<Partial<Asset>>({
    currency: 'USD',
  });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAccountIndex, setEditingAccountIndex] = useState<number | null>(null);
  const [existingInvestments, setExistingInvestments] = useState<any>(null);
  const [costBasisSuggestion, setCostBasisSuggestion] = useState<any>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const { formatCurrency } = useFinancePrivacy();

  const steps = ['Add Accounts', 'Enter Current Values', 'Add Individual Assets (Optional)', 'Review & Save'];

  useEffect(() => {
    if (open) {
      loadExistingAccounts();
      loadExistingInvestments();
    }
  }, [open]);

  // Load cost basis suggestion when account is selected in Step 2
  useEffect(() => {
    if (currentHolding.account_id && activeStep === 1) {
      loadCostBasisSuggestion(currentHolding.account_id as number);
    } else {
      setCostBasisSuggestion(null);
    }
  }, [currentHolding.account_id, activeStep]);

  const loadExistingInvestments = async () => {
    try {
      const response = await apiClient.get('/api/investments/check-existing');
      if (response.ok) {
        setExistingInvestments(response.data);
      }
    } catch (err) {
      console.error('Error loading existing investments:', err);
    }
  };

  // Check if account name matches existing investment transactions
  // Now uses centralized matching logic with fuzzy matching
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

    // PRIORITY 3: Try to match against categorization rules
    const rules = existingInvestments.rules || [];
    for (const rule of rules) {
      const similarity = calculateSimilarity(accountName, rule.pattern);
      if (similarity > 0.7) {
        return {
          match: true,
          category: rule.category,
          confidence: similarity
        };
      }
    }

    // PRIORITY 4: Use pattern-based matching from centralized config
    // This handles account type patterns (Pikadon, Koupat Guemel, etc.)
    const typeToCheck = accountType || currentAccount.account_type;
    if (typeToCheck && existingInvestments.patterns) {
      const patterns = existingInvestments.patterns[typeToCheck] || [];
      
      for (const pattern of patterns) {
        const similarity = calculateSimilarity(accountName, pattern);
        if (similarity > 0.6) {
          return {
            match: true,
            category: typeToCheck,
            confidence: similarity
          };
        }
      }
    }

    return { match: false };
  };

  const loadExistingAccounts = async () => {
    try {
      const response = await apiClient.get('/api/investments/accounts');
      if (response.ok) {
        const data = response.data as any;
        if (Array.isArray(data?.accounts) && data.accounts.length > 0) {
          setAccounts(data.accounts);
        }
      }
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  };

  const loadCostBasisSuggestion = async (accountId: number) => {
    setLoadingSuggestion(true);
    setCostBasisSuggestion(null);
    
    try {
      const response = await apiClient.get(`/api/investments/suggest-cost-basis?account_id=${accountId}`);
      if (response.ok) {
        const data = response.data as any;
        if (data?.suggestion?.has_new_transactions) {
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

  const handleAddAccount = () => {
    if (!currentAccount.account_name || !currentAccount.account_type) {
      setError('Please enter account name and type');
      return;
    }

    if (editingAccountIndex !== null) {
      const updated = [...accounts];
      updated[editingAccountIndex] = currentAccount;
      setAccounts(updated);
      setEditingAccountIndex(null);
    } else {
      setAccounts([...accounts, currentAccount]);
    }

    setCurrentAccount({
      account_name: '',
      account_type: 'brokerage',
      currency: 'ILS',
    });
    setError(null);
  };

  const handleEditAccount = (index: number) => {
    setCurrentAccount(accounts[index]);
    setEditingAccountIndex(index);
  };

  const handleDeleteAccount = (index: number) => {
    setAccounts(accounts.filter((_, i) => i !== index));
  };

  const handleAddHolding = () => {
    if (!currentHolding.account_id || !currentHolding.current_value || !currentHolding.as_of_date) {
      setError('Please select account, enter current value, and as of date');
      return;
    }

    setHoldings([...holdings, currentHolding]);
    setCurrentHolding({
      as_of_date: new Date().toISOString().split('T')[0],
    });
    setError(null);
  };

  const handleDeleteHolding = (index: number) => {
    setHoldings(holdings.filter((_, i) => i !== index));
  };

  const handleAddAsset = () => {
    if (!currentAsset.asset_name || !currentAsset.units || !currentAsset.account_id) {
      setError('Please enter asset name, units, and select an account');
      return;
    }

    setAssets([...assets, currentAsset as Asset]);
    setCurrentAsset({
      currency: 'USD',
    });
    setError(null);
  };

  const handleDeleteAsset = (index: number) => {
    setAssets(assets.filter((_, i) => i !== index));
  };

  const handleNext = async () => {
    if (activeStep === 0) {
      if (accounts.length === 0) {
        setError('Please add at least one account');
        return;
      }
    }

    if (activeStep === steps.length - 1) {
      await handleSave();
    } else {
      setActiveStep((prev) => prev + 1);
      setError(null);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
    setError(null);
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      // Save accounts
      const savedAccounts = [];
      for (const account of accounts) {
        if (account.id) {
          // Update existing account
          const response = await apiClient.put('/api/investments/accounts', account);
          if (!response.ok) throw new Error(response.statusText || 'Failed to update account');
          const data = response.data as any;
          savedAccounts.push(data?.account ?? data);
        } else {
          // Create new account
          const response = await apiClient.post('/api/investments/accounts', account);
          if (!response.ok) throw new Error(response.statusText || 'Failed to create account');
          const data = response.data as any;
          savedAccounts.push(data?.account ?? data);
        }
      }

      // Save holdings (all entries from the list)
      for (const holding of holdings) {
        const response = await apiClient.post('/api/investments/holdings', {
          ...holding,
          save_history: true,
        });
        if (!response.ok) throw new Error(response.statusText || 'Failed to save holding');
      }

      // Save individual assets
      for (const asset of assets) {
        const response = await apiClient.post('/api/investments/assets', asset);
        if (!response.ok) throw new Error(response.statusText || 'Failed to save asset');
      }

      onComplete();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save portfolio data');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setAccounts([]);
    setCurrentAccount({
      account_name: '',
      account_type: 'brokerage',
      currency: 'ILS',
    });
    setCurrentHolding({
      as_of_date: new Date().toISOString().split('T')[0],
    });
    setHoldings([]);
    setAssets([]);
    setError(null);
    setEditingAccountIndex(null);
    onClose();
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Add your investment accounts (pension funds, brokerage accounts, crypto wallets, etc.)
            </Typography>

            {existingInvestments && existingInvestments.vendors?.length > 0 && (
              <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                  💡 We found {existingInvestments.vendors.length} investment account(s) in your transactions:
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                  {existingInvestments.vendors.slice(0, 10).map((vendor: any, index: number) => (
                    <Chip
                      key={index}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <span style={{ fontWeight: 600 }}>{vendor.name}</span>
                          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                            ({vendor.subcategory || vendor.category})
                          </span>
                        </Box>
                      }
                      size="small"
                      sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 500 }}
                      onClick={() => setCurrentAccount({ ...currentAccount, account_name: vendor.name })}
                    />
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  💡 Click a chip to auto-fill, or type manually. Green border = account detected in transactions.
                </Typography>
              </Alert>
            )}

            <Grid container spacing={2} sx={{ mt: 2 }}>
              <Grid item xs={12} sm={6}>
                {(() => {
                  const investmentMatch = currentAccount.account_name ? isExistingInvestment(currentAccount.account_name, currentAccount.account_type) : { match: false };
                  return (
                    <Box>
                      <TextField
                        fullWidth
                        label="Account Name"
                        value={currentAccount.account_name}
                        onChange={(e) => setCurrentAccount({ ...currentAccount, account_name: e.target.value })}
                        placeholder="e.g., Interactive Brokers, Migdal Pension"
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
                <FormControl fullWidth>
                  <InputLabel>Account Type</InputLabel>
                  <Select
                    value={currentAccount.account_type}
                    onChange={(e) => setCurrentAccount({ ...currentAccount, account_type: e.target.value })}
                    label="Account Type"
                  >
                    {ACCOUNT_TYPES.map((type) => (
                      <MenuItem key={type.value} value={type.value}>
                        {type.label} ({type.label_he})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Institution (Optional)"
                  value={currentAccount.institution || ''}
                  onChange={(e) => setCurrentAccount({ ...currentAccount, institution: e.target.value })}
                  placeholder="e.g., Migdal, Meitav Dash"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Account Number (Optional)"
                  value={currentAccount.account_number || ''}
                  onChange={(e) => setCurrentAccount({ ...currentAccount, account_number: e.target.value })}
                  placeholder="Last 4 digits"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Notes (Optional)"
                  value={currentAccount.notes || ''}
                  onChange={(e) => setCurrentAccount({ ...currentAccount, notes: e.target.value })}
                  placeholder="Any additional information..."
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  startIcon={editingAccountIndex !== null ? <EditIcon /> : <AddIcon />}
                  onClick={handleAddAccount}
                  fullWidth
                >
                  {editingAccountIndex !== null ? 'Update Account' : 'Add Account'}
                </Button>
              </Grid>
            </Grid>

            {accounts.length > 0 && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Added Accounts ({accounts.length})
                </Typography>
                <List>
                  {accounts.map((account, index) => {
                    const investmentMatch = isExistingInvestment(account.account_name, account.account_type);
                    return (
                      <ListItem
                        key={index}
                        sx={{
                          border: '2px solid',
                          borderColor: investmentMatch.match ? '#4caf50' : 'divider',
                          borderRadius: 1,
                          mb: 1,
                          bgcolor: investmentMatch.match ? 'rgba(76, 175, 80, 0.08)' : 'transparent',
                        }}
                      >
                        <AccountIcon sx={{ mr: 2, color: investmentMatch.match ? '#4caf50' : 'inherit' }} />
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <span style={{ color: investmentMatch.match ? '#4caf50' : 'inherit', fontWeight: investmentMatch.match ? 600 : 400 }}>
                                {account.account_name}
                              </span>
                              {investmentMatch.match && (
                                <Chip
                                  label={`✓ ${investmentMatch.category || 'Investment'}`}
                                  size="small"
                                  sx={{
                                    bgcolor: '#4caf50',
                                    color: 'white',
                                    fontWeight: 500,
                                    fontSize: '0.7rem',
                                  }}
                                />
                              )}
                            </Box>
                          }
                          secondary={
                            <>
                              {ACCOUNT_TYPES.find(t => t.value === account.account_type)?.label}
                              {account.institution && ` • ${account.institution}`}
                              {investmentMatch.match && investmentMatch.count && (
                                <span style={{ color: '#4caf50', fontWeight: 500 }}>
                                  {' '}• {investmentMatch.count} transactions tracked
                                </span>
                              )}
                            </>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton edge="end" onClick={() => handleEditAccount(index)} sx={{ mr: 1 }}>
                            <EditIcon />
                          </IconButton>
                          <IconButton edge="end" onClick={() => handleDeleteAccount(index)}>
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    );
                  })}
                </List>
              </>
            )}
          </Box>
        );

      case 1:
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Enter the current value for each account. You can add multiple value updates for different dates.
            </Typography>

            {accounts.length === 0 ? (
              <Alert severity="warning" sx={{ mt: 2 }}>
                No accounts added yet. Go back to add accounts first.
              </Alert>
            ) : (
              <>
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={12}>
                    <FormControl fullWidth>
                      <InputLabel>Select Account</InputLabel>
                      <Select
                        value={currentHolding.account_id || ''}
                        onChange={(e) => setCurrentHolding({ ...currentHolding, account_id: e.target.value as number })}
                        label="Select Account"
                      >
                        {accounts.map((account, index) => {
                          const investmentMatch = isExistingInvestment(account.account_name, account.account_type);
                          return (
                            <MenuItem key={index} value={account.id || index}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                <span style={{ color: investmentMatch.match ? '#4caf50' : 'inherit', fontWeight: investmentMatch.match ? 600 : 400 }}>
                                  {account.account_name}
                                </span>
                                {investmentMatch.match && (
                                  <Chip
                                    label="✓"
                                    size="small"
                                    sx={{
                                      bgcolor: '#4caf50',
                                      color: 'white',
                                      height: '20px',
                                      fontSize: '0.7rem',
                                    }}
                                  />
                                )}
                              </Box>
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                  </Grid>

                  {/* Cost Basis Suggestion */}
                  {loadingSuggestion && (
                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                        <CircularProgress size={20} />
                        <Typography variant="body2">Checking for new transactions...</Typography>
                      </Box>
                    </Grid>
                  )}

                  {costBasisSuggestion && costBasisSuggestion.suggestion.has_new_transactions && (
                    <Grid item xs={12}>
                      <Alert 
                        severity="info" 
                        sx={{ 
                          bgcolor: 'rgba(33, 150, 243, 0.08)',
                          border: '1px solid rgba(33, 150, 243, 0.3)',
                        }}
                        action={
                          <Button 
                            size="small" 
                            onClick={applyCostBasisSuggestion}
                            sx={{ whiteSpace: 'nowrap' }}
                          >
                            Apply Suggestion
                          </Button>
                        }
                      >
                        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                          💡 New transactions detected since {new Date(costBasisSuggestion.account.last_update).toLocaleDateString()}
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          <strong>{costBasisSuggestion.suggestion.transaction_count} transactions</strong> found:
                        </Typography>
                        <Box sx={{ ml: 2, mb: 1 }}>
                          {costBasisSuggestion.suggestion.deposits_count > 0 && (
                            <Typography variant="caption" display="block">
                              • {costBasisSuggestion.suggestion.deposits_count} deposit{costBasisSuggestion.suggestion.deposits_count !== 1 ? 's' : ''}: 
                              <span style={{ fontWeight: 600, color: '#10b981', marginLeft: 4 }}>
                                +{formatCurrency(costBasisSuggestion.suggestion.total_deposits)}
                              </span>
                            </Typography>
                          )}
                          {costBasisSuggestion.suggestion.withdrawals_count > 0 && (
                            <Typography variant="caption" display="block">
                              • {costBasisSuggestion.suggestion.withdrawals_count} withdrawal{costBasisSuggestion.suggestion.withdrawals_count !== 1 ? 's' : ''}: 
                              <span style={{ fontWeight: 600, color: '#ef4444', marginLeft: 4 }}>
                                -{formatCurrency(costBasisSuggestion.suggestion.total_withdrawals)}
                              </span>
                            </Typography>
                          )}
                        </Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Suggested Cost Basis: {formatCurrency(costBasisSuggestion.suggestion.suggested_cost_basis)}
                          <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                            (was {formatCurrency(costBasisSuggestion.account.current_cost_basis)} 
                            {costBasisSuggestion.suggestion.increase >= 0 ? ' +' : ' '}
                            {formatCurrency(Math.abs(costBasisSuggestion.suggestion.increase))})
                          </Typography>
                        </Typography>
                      </Alert>
                    </Grid>
                  )}

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Current Value (₪)"
                      value={currentHolding.current_value || ''}
                      onChange={(e) => setCurrentHolding({ ...currentHolding, current_value: parseFloat(e.target.value) })}
                      placeholder="e.g., 21024"
                      inputProps={{ step: '0.01' }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Cost Basis (Optional)"
                      value={currentHolding.cost_basis || ''}
                      onChange={(e) => setCurrentHolding({ ...currentHolding, cost_basis: parseFloat(e.target.value) })}
                      placeholder="Total amount invested"
                      inputProps={{ step: '0.01' }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      type="date"
                      label="As of Date"
                      value={currentHolding.as_of_date}
                      onChange={(e) => setCurrentHolding({ ...currentHolding, as_of_date: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      multiline
                      rows={1}
                      label="Notes (Optional)"
                      value={currentHolding.notes || ''}
                      onChange={(e) => setCurrentHolding({ ...currentHolding, notes: e.target.value })}
                      placeholder="e.g., Monthly update"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={handleAddHolding}
                      fullWidth
                      sx={{ py: 1.5 }}
                    >
                      Add Value Update
                    </Button>
                  </Grid>
                </Grid>

                {holdings.length > 0 && (
                  <>
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="subtitle2" gutterBottom>
                      Added Value Updates ({holdings.length})
                    </Typography>
                    <List>
                      {holdings.map((holding, index) => {
                        const account = accounts.find(a => (a.id || accounts.indexOf(a)) === holding.account_id);
                        return (
                          <ListItem
                            key={index}
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              mb: 1,
                            }}
                          >
                            <TrendingUp sx={{ mr: 2, color: 'primary.main' }} />
                            <ListItemText
                              primary={
                                <Box>
                                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                    {account?.account_name || 'Unknown Account'}
                                  </Typography>
                                  <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                                    {formatCurrency(holding.current_value || 0)}
                                  </Typography>
                                </Box>
                              }
                              secondary={
                                <>
                                  {holding.cost_basis && `Cost Basis: ${formatCurrency(holding.cost_basis)} • `}
                                  As of: {holding.as_of_date}
                                  {holding.notes && ` • ${holding.notes}`}
                                </>
                              }
                            />
                            <ListItemSecondaryAction>
                              <IconButton edge="end" onClick={() => handleDeleteHolding(index)}>
                                <DeleteIcon />
                              </IconButton>
                            </ListItemSecondaryAction>
                          </ListItem>
                        );
                      })}
                    </List>
                  </>
                )}

                <Alert severity="info" sx={{ mt: 2 }}>
                  You can add multiple value updates for the same or different accounts. 
                  This is useful for tracking monthly changes or entering historical data.
                </Alert>
              </>
            )}
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              For brokerage accounts, you can optionally track individual stocks/ETFs (units only, not values)
            </Typography>

            <Grid container spacing={2} sx={{ mt: 2 }}>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Account</InputLabel>
                  <Select
                    value={currentAsset.account_id || ''}
                    onChange={(e) => setCurrentAsset({ ...currentAsset, account_id: e.target.value as number })}
                    label="Account"
                  >
                    {accounts.filter(a => a.account_type === 'brokerage').map((account, index) => (
                      <MenuItem key={index} value={account.id || index}>
                        {account.account_name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Symbol (Optional)"
                  value={currentAsset.asset_symbol || ''}
                  onChange={(e) => setCurrentAsset({ ...currentAsset, asset_symbol: e.target.value })}
                  placeholder="VOO, VTI, AAPL"
                />
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField
                  fullWidth
                  label="Asset Name"
                  value={currentAsset.asset_name || ''}
                  onChange={(e) => setCurrentAsset({ ...currentAsset, asset_name: e.target.value })}
                  placeholder="e.g., Vanguard S&P 500 ETF"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Asset Type</InputLabel>
                  <Select
                    value={currentAsset.asset_type || ''}
                    onChange={(e) => setCurrentAsset({ ...currentAsset, asset_type: e.target.value })}
                    label="Asset Type"
                  >
                    {ASSET_TYPES.map((type) => (
                      <MenuItem key={type.value} value={type.value}>
                        {type.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Units/Shares"
                  value={currentAsset.units || ''}
                  onChange={(e) => setCurrentAsset({ ...currentAsset, units: parseFloat(e.target.value) })}
                  placeholder="Number of shares"
                  inputProps={{ step: '0.00000001' }}
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={handleAddAsset}
                  fullWidth
                >
                  Add Asset
                </Button>
              </Grid>
            </Grid>

            {assets.length > 0 && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Added Assets ({assets.length})
                </Typography>
                <List>
                  {assets.map((asset, index) => (
                    <ListItem
                      key={index}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        mb: 1,
                      }}
                    >
                      <StockIcon sx={{ mr: 2 }} />
                      <ListItemText
                        primary={`${asset.asset_symbol || asset.asset_name}`}
                        secondary={`${asset.units} units`}
                      />
                      <ListItemSecondaryAction>
                        <IconButton edge="end" onClick={() => handleDeleteAsset(index)}>
                          <DeleteIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              </>
            )}
            
            <Alert severity="info" sx={{ mt: 2 }}>
              This step is optional. You can skip it and track only total account values.
            </Alert>
          </Box>
        );

      case 3:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Review Your Portfolio Setup
            </Typography>

            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Accounts ({accounts.length})
            </Typography>
            <List>
              {accounts.map((account, index) => (
                <ListItem key={index}>
                  <ListItemText
                    primary={account.account_name}
                    secondary={
                      <>
                        {ACCOUNT_TYPES.find(t => t.value === account.account_type)?.label}
                        {account.institution && ` • ${account.institution}`}
                      </>
                    }
                  />
                  <Chip
                    label={account.account_type}
                    size="small"
                    color="primary"
                  />
                </ListItem>
              ))}
            </List>

            {holdings.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                  Value Updates ({holdings.length})
                </Typography>
                <List>
                  {holdings.map((holding, index) => {
                    const account = accounts.find(a => (a.id || accounts.indexOf(a)) === holding.account_id);
                    return (
                      <ListItem key={index}>
                        <ListItemText
                          primary={
                            <>
                              {account?.account_name}: {formatCurrency(holding.current_value || 0, { absolute: true })}
                            </>
                          }
                          secondary={
                            <>
                              As of: {holding.as_of_date}
                              {holding.cost_basis && ` • Cost Basis: ${formatCurrency(holding.cost_basis, { absolute: true })}`}
                              {holding.notes && ` • ${holding.notes}`}
                            </>
                          }
                        />
                      </ListItem>
                    );
                  })}
                </List>
              </>
            )}

            {assets.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                  Individual Assets ({assets.length})
                </Typography>
                <List dense>
                  {assets.map((asset, index) => (
                    <ListItem key={index}>
                      <ListItemText
                        primary={asset.asset_symbol || asset.asset_name}
                        secondary={`${asset.units} units`}
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            <Alert severity="info" sx={{ mt: 2 }}>
              Click &ldquo;Save &amp; Complete&rdquo; to save your portfolio setup.
              You can update values anytime from the Investments page.
            </Alert>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '70vh' }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">Portfolio Setup</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {renderStepContent(activeStep)}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={handleBack}
          disabled={activeStep === 0 || loading}
        >
          Back
        </Button>
        <Button
          variant="contained"
          onClick={handleNext}
          disabled={loading}
        >
          {loading ? (
            <CircularProgress size={24} />
          ) : activeStep === steps.length - 1 ? (
            'Save & Complete'
          ) : (
            'Next'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PortfolioSetupModal;
