import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Collapse,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';

interface Discrepancy {
  exists: boolean;
  totalBankRepayments: number;
  totalCCExpenses: number;
  difference: number;
  differencePercentage: number;
  periodMonths?: number;
}

interface DiscrepancyAlertProps {
  discrepancy: Discrepancy;
  onIgnore: () => void;
  onAddAsFee: (feeName: string) => void;
  loading?: boolean;
  ccVendor?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
}

export default function DiscrepancyAlert({
  discrepancy,
  onIgnore,
  onAddAsFee,
  loading = false,
  ccVendor = '',
}: DiscrepancyAlertProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [feeName, setFeeName] = useState(
    ccVendor ? t('discrepancy.defaultFeeName', { vendor: ccVendor }) : t('discrepancy.genericFeeName')
  );

  if (!discrepancy.exists) {
    return null;
  }

  const isOverpaid = discrepancy.difference > 0;

  return (
    <Alert
      severity="warning"
      icon={<WarningAmberIcon />}
      sx={{ mb: 2, '& .MuiAlert-message': { width: '100%' } }}
    >
      <AlertTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{t('discrepancy.title')}</span>
        <IconButton size="small" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </AlertTitle>

      <Typography variant="body2" sx={{ mb: 1 }}>
        {isOverpaid
          ? t('discrepancy.overpaidMessage', { amount: formatCurrency(discrepancy.difference) })
          : t('discrepancy.underpaidMessage', { amount: formatCurrency(discrepancy.difference) })}
      </Typography>

      <Collapse in={expanded}>
        <Box sx={{ mt: 1, mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('discrepancy.bankRepayments')}: {formatCurrency(discrepancy.totalBankRepayments)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('discrepancy.ccExpenses')}: {formatCurrency(discrepancy.totalCCExpenses)}
          </Typography>
          <Typography variant="body2" fontWeight="bold">
            {t('discrepancy.difference')}: {formatCurrency(discrepancy.difference)} ({discrepancy.differencePercentage}%)
          </Typography>
          {discrepancy.periodMonths && (
            <Typography variant="caption" color="text.secondary">
              {t('discrepancy.period', { months: discrepancy.periodMonths })}
            </Typography>
          )}
        </Box>
      </Collapse>

      <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" fontWeight="medium">
          {t('discrepancy.howToResolve')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={onIgnore}
            disabled={loading}
          >
            {t('discrepancy.ignore')}
          </Button>

          <Typography variant="body2" color="text.secondary">
            {t('common.or')}
          </Typography>

          <TextField
            size="small"
            value={feeName}
            onChange={(e) => setFeeName(e.target.value)}
            placeholder={t('discrepancy.feeNamePlaceholder')}
            sx={{ minWidth: 200 }}
            disabled={loading}
          />

          <Button
            variant="contained"
            size="small"
            onClick={() => onAddAsFee(feeName)}
            disabled={loading || !feeName.trim()}
          >
            {t('discrepancy.addAsFee')}
          </Button>
        </Box>
      </Box>
    </Alert>
  );
}
