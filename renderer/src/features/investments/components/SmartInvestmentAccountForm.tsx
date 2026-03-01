import { useState, useEffect } from 'react';
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
  Typography,
  Box,
  Alert,
  CircularProgress,
  Grid,
  InputAdornment,
  Chip,
  Autocomplete
} from '@mui/material';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import InstitutionBadge, { InstitutionMetadata, getInstitutionLabel } from '@renderer/shared/components/InstitutionBadge';
import { apiClient } from '@/lib/api-client';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';

interface Transaction {
  transactionIdentifier: string;
  transactionVendor: string;
  transactionDate: string;
  transactionAmount: number;
  transactionName: string;
  confidence?: number;
}

interface GroupedSuggestion {
  suggestedAccountType: string;
  suggestedInstitution: string | null;
  suggestedAccountName: string;
  avgConfidence: number;
  transactions: Transaction[];
  totalAmount: number;
  transactionCount: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
}

interface SmartInvestmentAccountFormProps {
  open: boolean;
  onClose: () => void;
  suggestion?: GroupedSuggestion;
  onSuccess?: () => void;
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  pension: 'Pension Fund',
  provident: 'Provident Fund',
  study_fund: 'Education Fund',
  brokerage: 'Brokerage Account',
  crypto: 'Cryptocurrency',
  savings: 'Savings Account',
  mutual_fund: 'Mutual Funds',
  bonds: 'Bonds & Loans',
  real_estate: 'Real Estate',
  insurance: 'Insurance',
  other: 'Other Investments'
};

const CURRENCY_OPTIONS = ['ILS', 'USD', 'EUR', 'GBP'];

export default function SmartInvestmentAccountForm({
  open,
  onClose,
  suggestion,
  onSuccess
}: SmartInvestmentAccountFormProps) {
  const { showNotification } = useNotification();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [institutions, setInstitutions] = useState<InstitutionMetadata[]>([]);
  const [institutionId, setInstitutionId] = useState<number | null>(null);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>();

  // Step 1: Account Details
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('');
  const [institution, setInstitution] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [currency, setCurrency] = useState('ILS');
  const [notes, setNotes] = useState('');

  // Step 2: Current Values
  const [currentValue, setCurrentValue] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);

  // Auto-fill from suggestion
useEffect(() => {
  if (suggestion && open) {
    setAccountName(suggestion.suggestedAccountName || '');
    setAccountType(suggestion.suggestedAccountType || '');
    setInstitution(suggestion.suggestedInstitution || '');
    setInstitutionId(null);

    // Calculate suggested cost basis from transactions
    const suggestedCostBasis = Math.abs(suggestion.totalAmount || 0);
    setCostBasis(suggestedCostBasis.toString());

    // Set current value equal to cost basis (sum of all transactions)
    // User can override if the current value differs from total invested
    setCurrentValue(suggestedCostBasis.toString());

      // Reset other fields
      setAccountNumber('');
    setNotes('');
    setActiveStep(0);
  }
}, [suggestion, open]);

useEffect(() => {
  let isMounted = true;
  const fetchInstitutions = async () => {
    setInstitutionsLoading(true);
    try {
      const response = await apiClient.get('/api/institutions/tree');
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to load institutions');
      }
      const payload = response.data as any;
      const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
      const list = nodes.filter((n: any) => n.node_type === 'institution');
      if (isMounted) {
        setInstitutions(list);
      }
    } catch (error) {
      console.error('Failed to load institution tree', error);
      if (isMounted) {
        setInstitutions([]);
      }
    } finally {
      if (isMounted) {
        setInstitutionsLoading(false);
      }
    }
  };

  fetchInstitutions();
  return () => {
    isMounted = false;
  };
}, []);

useEffect(() => {
  if (!suggestion || institutions.length === 0) {
    return;
  }

  const match = institutions.find(
    (inst) =>
      inst.vendor_code === suggestion.suggestedAccountType ||
      inst.display_name_he === suggestion.suggestedInstitution ||
      inst.display_name_en === suggestion.suggestedInstitution,
  );

  if (match) {
    setInstitutionId(match.id ?? null);
    setInstitution(getInstitutionLabel(match) || match.vendor_code);
  }
}, [suggestion, institutions]);

  const handleNext = () => {
    // Validation for Step 1
    if (activeStep === 0) {
      if (!accountName || !accountType) {
        showNotification('Please fill in account name and account type', 'error');
        return;
      }
    }

    // Validation for Step 2 (final step)
    if (activeStep === 1) {
      if (!currentValue || !costBasis) {
        showNotification('Please fill in current value and cost basis', 'error');
        return;
      }

      // Submit the form
      handleSubmit();
      return;
    }

    setActiveStep(prev => prev + 1);
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);

    try {
      // Prepare account details
      const accountDetails = {
        account_name: accountName,
        account_type: accountType,
        institution: institution || null,
        institution_id: institutionId,
        account_number: accountNumber || null,
        currency,
        notes: notes || null
      };

      // Prepare holding details
      const holdingDetails = {
        current_value: parseFloat(currentValue),
        cost_basis: parseFloat(costBasis),
        as_of_date: asOfDate,
        notes: `Created from smart suggestion with ${suggestion?.transactionCount || 0} transactions`
      };

      // Prepare transactions for linking
      const transactions = suggestion?.transactions.map(t => ({
        transactionIdentifier: t.transactionIdentifier,
        transactionVendor: t.transactionVendor,
        transactionDate: t.transactionDate,
        confidence: t.confidence || 0.95
      })) || [];

      // Call API to create account + holding + link transactions
      const response = await apiClient.post('/api/investments/suggestions/create-from-suggestion', {
        accountDetails,
        holdingDetails,
        transactions
      });

      if (!response.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          setLoading(false);
          return;
        }
        console.error('Error response:', response.data);
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Failed to create account'}`);
      }

      const data = response.data as any;

      if (data.success) {
        showNotification(
          `Account "${accountName}" created successfully with ${data.linkResult?.successCount || 0} linked transactions`,
          'success'
        );

        // Trigger data refresh event
        window.dispatchEvent(new Event('dataRefresh'));

        // Reset form
        resetForm();

        // Call success callback
        if (onSuccess) {
          onSuccess();
        }

        // Close dialog
        onClose();
      } else {
        throw new Error(data.error || 'Failed to create account');
      }
    } catch (error: any) {
      console.error('Error creating investment account:', error);
      showNotification(error.message || 'Error creating investment account', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setActiveStep(0);
    setAccountName('');
    setAccountType('');
    setInstitution('');
    setInstitutionId(null);
    setAccountNumber('');
    setCurrency('ILS');
    setNotes('');
    setCurrentValue('');
    setCostBasis('');
    setAsOfDate(new Date().toISOString().split('T')[0]);
  };

  const calculateROI = (): number => {
    const current = parseFloat(currentValue) || 0;
    const cost = parseFloat(costBasis) || 0;

    if (cost === 0) return 0;

    return ((current - cost) / cost) * 100;
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box>
            {suggestion && (
              <Alert severity="info" sx={{ mb: 3 }}>
                <Typography variant="body2" gutterBottom>
                  <strong>Detected automatically:</strong> {suggestion.transactionCount} transactions totaling{' '}
                  ₪{suggestion.totalAmount.toLocaleString()}
                </Typography>
                <Typography variant="caption">
                  Confidence level: {Math.round(suggestion.avgConfidence * 100)}%
                </Typography>
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  required
                  label="Account Name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="e.g.: Pension - Manulife"
                  helperText="You can edit the suggested name"
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth required>
                  <InputLabel>Account Type</InputLabel>
                  <Select
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value)}
                    label="Account Type"
                  >
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Autocomplete<InstitutionMetadata, false, false, false>
                  loading={institutionsLoading}
                  options={institutions}
                  getOptionLabel={(option) => getInstitutionLabel(option) || option.vendor_code}
                  value={institutions.find((inst) => inst.id === institutionId) || null}
                  onChange={(_, value) => {
                    setInstitutionId(value?.id ?? null);
                    setInstitution(value ? getInstitutionLabel(value) || value.vendor_code : '');
                  }}
                  renderOption={(props, option) => (
                    <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <InstitutionBadge institution={option} size="small" />
                      <span>{getInstitutionLabel(option)}</span>
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select Known Institution"
                      placeholder="Start typing..."
                    />
                  )}
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  label="Institution Name (Custom)"
                  value={institution}
                  onChange={(e) => {
                    setInstitution(e.target.value);
                    setInstitutionId(null);
                  }}
                  placeholder="e.g.: Manulife, Phoenix"
                  helperText="Select from list or enter custom name"
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  label="Account Number"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="Account number (optional)"
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Currency</InputLabel>
                  <Select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    label="Currency"
                  >
                    {CURRENCY_OPTIONS.map((curr) => (
                      <MenuItem key={curr} value={curr}>
                        {curr}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes (optional)"
                />
              </Grid>
            </Grid>
          </Box>
        );

      case 1:
        return (
          <Box>
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="body2">
                Account: <strong>{accountName}</strong>
              </Typography>
              <Typography variant="caption">
                Type: {ACCOUNT_TYPE_LABELS[accountType]}
                {institution && ` | Institution: ${institution}`}
              </Typography>
            </Alert>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  required
                  type="number"
                  label="Current Value"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>
                  }}
                  helperText="What is the current value of the account?"
                />
              </Grid>

              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  required
                  type="number"
                  label="Cost Basis (Amount Invested)"
                  value={costBasis}
                  onChange={(e) => setCostBasis(e.target.value)}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>
                  }}
                  helperText={
                    suggestion
                      ? `Auto-calculated from ${suggestion.transactionCount} transactions. Can be edited.`
                      : 'How much was invested in total?'
                  }
                />
              </Grid>

              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  type="date"
                  label="As of Date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  InputLabelProps={{
                    shrink: true
                  }}
                />
              </Grid>

              {currentValue && costBasis && (
                <Grid size={{ xs: 12 }}>
                  <Alert severity={calculateROI() >= 0 ? 'success' : 'warning'}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2">
                        <strong>Estimated ROI:</strong>
                      </Typography>
                      <Chip
                        label={`${calculateROI().toFixed(2)}%`}
                        size="small"
                        color={calculateROI() >= 0 ? 'success' : 'error'}
                      />
                    </Box>
                    <Typography variant="caption">
                      Profit/Loss: ₪
                      {(parseFloat(currentValue) - parseFloat(costBasis)).toLocaleString()}
                    </Typography>
                  </Alert>
                </Grid>
              )}
            </Grid>
          </Box>
        );

      default:
        return null;
    }
  };

  const steps = ['Account Details', 'Current Values'];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Create Smart Investment Account
        {suggestion && (
          <Typography variant="caption" color="text.secondary" display="block">
            Based on {suggestion.transactionCount} detected transactions
          </Typography>
        )}
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 4, mt: 2 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {renderStepContent(activeStep)}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        {activeStep > 0 && (
          <Button onClick={handleBack} disabled={loading}>
            Back
          </Button>
        )}
        <Button
          onClick={handleNext}
          variant="contained"
          disabled={loading}
          startIcon={loading && <CircularProgress size={20} />}
        >
          {activeStep === steps.length - 1 ? 'Create Account & Link Transactions' : 'Next'}
        </Button>
      </DialogActions>

      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </Dialog>
  );
}
