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
import { InvestmentAccountSummary, PortfolioSummary } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import {
  calculatePortfolioRoi,
  getPortfolioAccountColor,
  resolvePortfolioInstitutionName,
} from './portfolio-breakdown-helpers';
import {
  getOrderedPortfolioAccounts,
  getPortfolioCategoryBuckets,
} from '../utils/portfolio-categories';

interface PortfolioBreakdownSectionProps {
  portfolioData: PortfolioSummary;
  onAccountClick?: (account: InvestmentAccountSummary) => void;
}

const PortfolioBreakdownSection: React.FC<PortfolioBreakdownSectionProps> = ({
  portfolioData,
  onAccountClick,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'investmentsPage.breakdown' });
  const locale = i18n.language;

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  if (!portfolioData) {
    return null;
  }

  const orderedAccounts = getOrderedPortfolioAccounts(portfolioData);
  const groups = getPortfolioCategoryBuckets(portfolioData)
    .filter(({ bucket }) => (bucket.accounts?.length || 0) > 0);

  const renderAccountList = (accounts: InvestmentAccountSummary[], title: string) => {
    if (!accounts || accounts.length === 0) return null;

    return (
      <>
        <ListSubheader sx={{ bgcolor: 'transparent', fontWeight: 'bold', lineHeight: '32px', mt: 1 }}>
          {title}
        </ListSubheader>
        {accounts.map((account) => {
          const roi = calculatePortfolioRoi(account.current_value, account.cost_basis);
          const isPositive = roi >= 0;
          const isClickable = Boolean(onAccountClick) && account.account_type === 'savings';

          return (
            <ListItem
              key={account.id}
              disablePadding
              onClick={() => isClickable ? onAccountClick?.(account) : undefined}
              sx={{
                py: 0.5,
                px: 2,
                cursor: isClickable ? 'pointer' : 'default',
              }}
            >
              <ListItemIcon sx={{ minWidth: 24 }}>
                <CircleIcon
                  sx={{
                    width: 12,
                    height: 12,
                    color: getPortfolioAccountColor(orderedAccounts, account.id, theme.palette.grey[500]),
                  }}
                />
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
                      {resolvePortfolioInstitutionName(account.institution, locale)}
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
                primaryTypographyProps={{ component: 'div' }}
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItem>
          );
        })}
      </>
    );
  };

  return (
    <Paper sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 2, pb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('listTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('listSubtitle')}
        </Typography>
      </Box>
      <List dense>
        {groups.map(({ key, bucket }, index) => (
          <React.Fragment key={key}>
            {index > 0 && <Divider sx={{ my: 1 }} />}
            {renderAccountList(bucket.accounts || [], t(`group.${key}`))}
          </React.Fragment>
        ))}
      </List>
    </Paper>
  );
};

export default PortfolioBreakdownSection;
