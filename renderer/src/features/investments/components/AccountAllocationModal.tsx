import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableSortLabel,
  Chip,
  useTheme,
  alpha,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioSummary } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface AccountAllocationModalProps {
  open: boolean;
  onClose: () => void;
  portfolioData: PortfolioSummary;
  colors: string[];
}

type SortField = 'name' | 'value' | 'percentage';
type SortDirection = 'asc' | 'desc';

const AccountAllocationModal: React.FC<AccountAllocationModalProps> = ({
  open,
  onClose,
  portfolioData,
  colors,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.allocationModal' });

  const [sortField, setSortField] = useState<SortField>('value');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  // Combine all accounts
  const allAccounts = useMemo(() => {
    return [
      ...(portfolioData.restrictedAccounts || []),
      ...(portfolioData.liquidAccounts || []),
    ];
  }, [portfolioData]);

  const totalValue = portfolioData.summary.totalPortfolioValue;

  // Sort accounts
  const sortedAccounts = useMemo(() => {
    const accounts = allAccounts
      .filter(account => account.current_value > 0)
      .map((account, index) => ({
        ...account,
        color: colors[index % colors.length],
        percentage: (account.current_value / totalValue) * 100,
      }));

    return accounts.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.account_name.localeCompare(b.account_name);
          break;
        case 'value':
          comparison = a.current_value - b.current_value;
          break;
        case 'percentage':
          comparison = a.percentage - b.percentage;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [allAccounts, colors, totalValue, sortField, sortDirection]);

  // Calculate concentration metrics
  const topAccountPercentage = sortedAccounts.length > 0
    ? Math.max(...sortedAccounts.map(a => a.percentage))
    : 0;
  const top3Percentage = sortedAccounts
    .slice(0, 3)
    .reduce((sum, a) => sum + a.percentage, 0);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          maxHeight: '80vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pb: 2,
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          {t('title', 'Portfolio Allocation')}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {/* Summary Stats */}
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            mb: 3,
            flexWrap: 'wrap',
          }}
        >
          <Box
            sx={{
              flex: 1,
              minWidth: 140,
              p: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.05),
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t('stats.totalAccounts', 'Total Accounts')}
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
              {sortedAccounts.length}
            </Typography>
          </Box>

          <Box
            sx={{
              flex: 1,
              minWidth: 140,
              p: 2,
              bgcolor: alpha(theme.palette.warning.main, 0.05),
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.warning.main, 0.1)}`,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t('stats.topAccount', 'Top Account')}
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
              {topAccountPercentage.toFixed(1)}%
            </Typography>
          </Box>

          <Box
            sx={{
              flex: 1,
              minWidth: 140,
              p: 2,
              bgcolor: alpha(theme.palette.success.main, 0.05),
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.success.main, 0.1)}`,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t('stats.top3', 'Top 3 Combined')}
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
              {top3Percentage.toFixed(1)}%
            </Typography>
          </Box>
        </Box>

        {/* Accounts Table */}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }}></TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'name'}
                  direction={sortField === 'name' ? sortDirection : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  {t('table.account', 'Account')}
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'value'}
                  direction={sortField === 'value' ? sortDirection : 'desc'}
                  onClick={() => handleSort('value')}
                >
                  {t('table.value', 'Value')}
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'percentage'}
                  direction={sortField === 'percentage' ? sortDirection : 'desc'}
                  onClick={() => handleSort('percentage')}
                >
                  {t('table.percentage', 'Percentage')}
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedAccounts.map((account, index) => (
              <TableRow
                key={account.id}
                hover
                sx={{
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.02),
                  },
                }}
              >
                {/* Color Indicator */}
                <TableCell>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: account.color,
                    }}
                  />
                </TableCell>

                {/* Account Name */}
                <TableCell>
                  <Box>
                    <Typography variant="body2" fontWeight={500}>
                      {account.account_name}
                    </Typography>
                    {account.institution && (
                      <Typography variant="caption" color="text.secondary">
                        {typeof account.institution === 'string'
                          ? account.institution
                          : (account.institution as any).display_name_en || ''}
                      </Typography>
                    )}
                  </Box>
                </TableCell>

                {/* Value */}
                <TableCell align="right">
                  <Typography variant="body2" fontWeight={600}>
                    {maskAmounts ? '***' : formatCurrencyValue(account.current_value)}
                  </Typography>
                </TableCell>

                {/* Percentage */}
                <TableCell align="right">
                  <Chip
                    label={`${account.percentage.toFixed(1)}%`}
                    size="small"
                    sx={{
                      bgcolor: alpha(account.color, 0.15),
                      color: theme.palette.text.primary,
                      fontWeight: 600,
                      fontSize: '0.75rem',
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Concentration Warning */}
        {topAccountPercentage > 50 && (
          <Box
            sx={{
              mt: 3,
              p: 2,
              bgcolor: alpha(theme.palette.warning.main, 0.08),
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
            }}
          >
            <Typography variant="body2" color="warning.main" fontWeight={500}>
              ⚠️ {t('warning.concentration', 'High Concentration')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {t(
                'warning.concentrationMessage',
                'Your top account represents over 50% of your portfolio. Consider diversifying to reduce risk.'
              )}
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AccountAllocationModal;
