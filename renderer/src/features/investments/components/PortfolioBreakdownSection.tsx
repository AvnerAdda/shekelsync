import React from 'react';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListSubheader,
  Divider,
  useTheme,
} from '@mui/material';
import {
  Circle as CircleIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioSummary, PortfolioHistoryPoint, InvestmentAccountSummary } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface PortfolioBreakdownSectionProps {
  portfolioData: PortfolioSummary;
  accountHistories: Record<number, PortfolioHistoryPoint[]>;
  historyLoading: boolean;
}

// Must match PortfolioHistorySection
const CHART_COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#a05195', '#d45087', '#f95d6a', '#ff7c43', '#ffa600'
];

const PortfolioBreakdownSection: React.FC<PortfolioBreakdownSectionProps> = ({
  portfolioData,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.breakdown' });

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  if (!portfolioData) {
    return null;
  }

  // Match the sorting logic in PortfolioHistorySection to ensure colors match
  const restrictedAccounts = portfolioData.restrictedAccounts || [];
  const liquidAccounts = portfolioData.liquidAccounts || [];
  const orderedAccounts = [...restrictedAccounts, ...liquidAccounts];

  const getAccountColor = (accountId: number) => {
    const index = orderedAccounts.findIndex(a => a.id === accountId);
    if (index === -1) return theme.palette.grey[500];
    return CHART_COLORS[index % CHART_COLORS.length];
  };

  const getInstitutionName = (institution: any) => {
    if (!institution) return '';
    if (typeof institution === 'string') return institution;
    return institution.display_name_en || institution.display_name_he || institution.vendor_code || '';
  };

  const renderAccountList = (accounts: InvestmentAccountSummary[], title: string) => {
    if (!accounts || accounts.length === 0) return null;

    return (
      <>
        <ListSubheader sx={{ bgcolor: 'transparent', fontWeight: 'bold', lineHeight: '32px', mt: 1 }}>
          {title}
        </ListSubheader>
        {accounts.map((account) => {
          const roi = account.cost_basis > 0 
            ? ((account.current_value - account.cost_basis) / account.cost_basis) * 100 
            : 0;
          const isPositive = roi >= 0;

          return (
            <ListItem key={account.id} disablePadding sx={{ py: 0.5, px: 2 }}>
              <ListItemIcon sx={{ minWidth: 24 }}>
                <CircleIcon sx={{ width: 12, height: 12, color: getAccountColor(account.id) }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography variant="body2" noWrap sx={{ maxWidth: '60%', fontWeight: 500 }}>
                      {account.account_name}
                    </Typography>
                    <Typography variant="body2" fontWeight="600">
                      {formatCurrencyValue(account.current_value)}
                    </Typography>
                  </Box>
                }
                secondary={
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '60%' }}>
                      {getInstitutionName(account.institution)}
                    </Typography>
                    {account.cost_basis > 0 && (
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: isPositive ? 'success.main' : 'error.main',
                          fontWeight: 500 
                        }}
                      >
                        {isPositive ? '+' : ''}{roi.toFixed(1)}%
                      </Typography>
                    )}
                  </Box>
                }
              />
            </ListItem>
          );
        })}
      </>
    );
  };

  return (
    <Paper sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.paper' }}>
      <List dense>
        {/* Render Liquid Accounts first (Top of the stack visually) */}
        {renderAccountList(liquidAccounts, t('group.liquid', 'Liquid Assets'))}
        
        {liquidAccounts.length > 0 && restrictedAccounts.length > 0 && <Divider sx={{ my: 1 }} />}
        
        {/* Render Restricted Accounts next (Bottom of the stack visually) */}
        {renderAccountList(restrictedAccounts, t('group.restricted', 'Long Term & Pension'))}
      </List>
    </Paper>
  );
};

export default PortfolioBreakdownSection;
