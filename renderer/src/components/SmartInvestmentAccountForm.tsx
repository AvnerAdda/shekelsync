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
  Typography,
  Box,
  Alert,
  CircularProgress,
  Grid,
  InputAdornment,
  Chip
} from '@mui/material';
import { useNotification } from './NotificationContext';

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
  pension: 'קרן פנסיה',
  provident: 'קרן השתלמות',
  study_fund: 'קופת גמל לחינוך',
  brokerage: 'חשבון ברוקר',
  crypto: 'מטבעות דיגיטליים',
  savings: 'חשבון חיסכון',
  mutual_fund: 'קרנות נאמנות',
  bonds: 'אג"ח והלוואות',
  real_estate: 'נדל"ן והשקעות',
  other: 'השקעות אחרות'
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

      // Calculate suggested cost basis from transactions
      const suggestedCostBasis = Math.abs(suggestion.totalAmount || 0);
      setCostBasis(suggestedCostBasis.toString());

      // Reset other fields
      setAccountNumber('');
      setCurrentValue('');
      setNotes('');
      setActiveStep(0);
    }
  }, [suggestion, open]);

  const handleNext = () => {
    // Validation for Step 1
    if (activeStep === 0) {
      if (!accountName || !accountType) {
        showNotification('יש למלא שם חשבון וסוג חשבון', 'error');
        return;
      }
    }

    // Validation for Step 2 (final step)
    if (activeStep === 1) {
      if (!currentValue || !costBasis) {
        showNotification('יש למלא שווי נוכחי ובסיס עלות', 'error');
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
      const response = await fetch('/api/investments/suggestions/create-from-suggestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          accountDetails,
          holdingDetails,
          transactions
        })
      });

      const data = await response.json();

      if (data.success) {
        showNotification(
          `חשבון "${accountName}" נוצר בהצלחה עם ${data.linkResult?.successCount || 0} עסקאות מקושרות`,
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
      showNotification(error.message || 'שגיאה ביצירת חשבון השקעה', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setActiveStep(0);
    setAccountName('');
    setAccountType('');
    setInstitution('');
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
                  <strong>זוהה אוטומטית:</strong> {suggestion.transactionCount} עסקאות בסכום כולל של{' '}
                  ₪{suggestion.totalAmount.toLocaleString()}
                </Typography>
                <Typography variant="caption">
                  רמת ביטחון: {Math.round(suggestion.avgConfidence * 100)}%
                </Typography>
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  required
                  label="שם החשבון"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="למשל: פנסיה - מנורה"
                  helperText="ניתן לערוך את השם המוצע"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <FormControl fullWidth required>
                  <InputLabel>סוג חשבון</InputLabel>
                  <Select
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value)}
                    label="סוג חשבון"
                  >
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="מוסד פיננסי"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="למשל: מנורה, הפניקס"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="מספר חשבון"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="מספר חשבון (אופציונלי)"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>מטבע</InputLabel>
                  <Select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    label="מטבע"
                  >
                    {CURRENCY_OPTIONS.map((curr) => (
                      <MenuItem key={curr} value={curr}>
                        {curr}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="הערות"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="הערות נוספות (אופציונלי)"
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
                חשבון: <strong>{accountName}</strong>
              </Typography>
              <Typography variant="caption">
                סוג: {ACCOUNT_TYPE_LABELS[accountType]}
                {institution && ` | מוסד: ${institution}`}
              </Typography>
            </Alert>

            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  required
                  type="number"
                  label="שווי נוכחי"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>
                  }}
                  helperText="מה השווי הנוכחי של החשבון?"
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  required
                  type="number"
                  label="בסיס עלות (סכום מושקע)"
                  value={costBasis}
                  onChange={(e) => setCostBasis(e.target.value)}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">₪</InputAdornment>
                  }}
                  helperText={
                    suggestion
                      ? `חושב אוטומטית מ-${suggestion.transactionCount} עסקאות. ניתן לשנות.`
                      : 'כמה הושקע בסך הכל?'
                  }
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  type="date"
                  label="תאריך עדכון"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  InputLabelProps={{
                    shrink: true
                  }}
                />
              </Grid>

              {currentValue && costBasis && (
                <Grid item xs={12}>
                  <Alert severity={calculateROI() >= 0 ? 'success' : 'warning'}>
                    <Typography variant="body2">
                      <strong>תשואה משוערת (ROI):</strong>{' '}
                      <Chip
                        label={`${calculateROI().toFixed(2)}%`}
                        size="small"
                        color={calculateROI() >= 0 ? 'success' : 'error'}
                        sx={{ ml: 1 }}
                      />
                    </Typography>
                    <Typography variant="caption">
                      רווח/הפסד: ₪
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

  const steps = ['פרטי החשבון', 'ערכים נוכחיים'];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Typography variant="h6">יצירת חשבון השקעה חכם</Typography>
        {suggestion && (
          <Typography variant="caption" color="text.secondary">
            מבוסס על {suggestion.transactionCount} עסקאות שזוהו
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
          ביטול
        </Button>
        {activeStep > 0 && (
          <Button onClick={handleBack} disabled={loading}>
            חזרה
          </Button>
        )}
        <Button
          onClick={handleNext}
          variant="contained"
          disabled={loading}
          startIcon={loading && <CircularProgress size={20} />}
        >
          {activeStep === steps.length - 1 ? 'צור חשבון וקשר עסקאות' : 'המשך'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
