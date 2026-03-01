import React from 'react';
import { Box, Typography, Button, LinearProgress, Paper, Stack } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import SyncIcon from '@mui/icons-material/Sync';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import SavingsIcon from '@mui/icons-material/Savings';
import { useTranslation } from 'react-i18next';

interface OnboardingStatus {
  isComplete: boolean;
  completedSteps: {
    profile: boolean;
    bankAccount: boolean;
    creditCard: boolean;
    firstScrape: boolean;
    explored: boolean;
  };
  stats: {
    accountCount: number;
    bankAccountCount: number;
    creditCardCount: number;
    transactionCount: number;
    lastScrapeDate: string | null;
    hasProfile: boolean;
  };
  suggestedAction: 'profile' | 'bankAccount' | 'creditCard' | 'scrape' | 'explore' | null;
}

interface LockedPagePlaceholderProps {
  page: 'analysis' | 'investments' | 'budgets';
  onboardingStatus: OnboardingStatus | null;
}

const pageIcons: Record<string, React.ReactNode> = {
  analysis: <BarChartIcon sx={{ fontSize: 28, color: 'text.secondary' }} />,
  investments: <ShowChartIcon sx={{ fontSize: 28, color: 'text.secondary' }} />,
  budgets: <SavingsIcon sx={{ fontSize: 28, color: 'text.secondary' }} />,
};

export const LockedPagePlaceholder: React.FC<LockedPagePlaceholderProps> = ({
  page,
  onboardingStatus
}) => {
  const { t } = useTranslation('translation', { keyPrefix: 'lockedPage' });

  const title = t(`${page}.title`, page === 'analysis' ? 'Analysis Dashboard'
    : page === 'investments' ? 'Investment Tracking' : 'Budget Management');
  const description = t(`${page}.description`, page === 'analysis'
    ? 'View detailed breakdowns of your spending by category, track trends over time, and discover insights about your financial habits.'
    : page === 'investments'
    ? 'Monitor your investment portfolio, track performance, and analyze asset allocation across your accounts.'
    : 'Set spending limits, track your progress, and receive alerts when approaching budget thresholds.');

  const handleProfileClick = () => {
    window.dispatchEvent(new CustomEvent('openProfileSetup'));
  };

  const handleBankAccountClick = () => {
    window.dispatchEvent(new CustomEvent('openAccountsModal'));
  };

  const handleCreditCardClick = () => {
    window.dispatchEvent(new CustomEvent('openAccountsModal'));
  };

  const getCompletedSteps = () => {
    if (!onboardingStatus) return 0;
    const steps = onboardingStatus.completedSteps;
    return [steps.profile, steps.bankAccount, steps.creditCard, steps.firstScrape].filter(Boolean).length;
  };

  const totalSteps = 4;
  const completedSteps = getCompletedSteps();
  const progress = (completedSteps / totalSteps) * 100;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        padding: 4,
        backgroundColor: 'background.default'
      }}
    >
      <Paper
        elevation={0}
        sx={{
          padding: 6,
          maxWidth: 600,
          width: '100%',
          textAlign: 'center',
          borderRadius: 2.5
        }}
      >
        {/* Lock Icon and Title */}
        <Box sx={{ mb: 3 }}>
          <LockOutlinedIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            {pageIcons[page]} {title}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {description}
          </Typography>
        </Box>

        {/* Progress Section */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
            {t('completeSetup', 'Complete Setup to Unlock')}
          </Typography>
          <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t('progress', { defaultValue: 'Progress: {{completed}} of {{total}} steps', completed: completedSteps, total: totalSteps })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
              {Math.round(progress)}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{ height: 8, borderRadius: 1, mb: 3 }}
          />

          {/* Steps List */}
          <Stack spacing={2} sx={{ textAlign: 'left' }}>
            {/* Step 1: Profile */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {onboardingStatus?.completedSteps.profile ? (
                <CheckCircleOutlineIcon sx={{ color: 'success.main' }} />
              ) : (
                <PersonOutlineIcon sx={{ color: 'text.secondary' }} />
              )}
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  textDecoration: onboardingStatus?.completedSteps.profile ? 'line-through' : 'none',
                  color: onboardingStatus?.completedSteps.profile ? 'text.secondary' : 'text.primary'
                }}
              >
                {t('steps.profile', 'Create your profile')}
              </Typography>
              {!onboardingStatus?.completedSteps.profile && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleProfileClick}
                >
                  {t('actions.setUp', 'Set Up')}
                </Button>
              )}
            </Box>

            {/* Step 2: Bank Account */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {onboardingStatus?.completedSteps.bankAccount ? (
                <CheckCircleOutlineIcon sx={{ color: 'success.main' }} />
              ) : (
                <AccountBalanceIcon sx={{ color: 'text.secondary' }} />
              )}
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  textDecoration: onboardingStatus?.completedSteps.bankAccount ? 'line-through' : 'none',
                  color: onboardingStatus?.completedSteps.bankAccount ? 'text.secondary' : 'text.primary'
                }}
              >
                {t('steps.bankAccount', 'Add bank account')}
                {onboardingStatus?.stats?.bankAccountCount && onboardingStatus.stats.bankAccountCount > 0 &&
                  ` (${onboardingStatus.stats.bankAccountCount} ${t('steps.added', 'added')})`
                }
              </Typography>
              {!onboardingStatus?.completedSteps.bankAccount && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleBankAccountClick}
                  disabled={!onboardingStatus?.completedSteps.profile}
                >
                  {t('actions.addBank', 'Add Bank')}
                </Button>
              )}
            </Box>

            {/* Step 3: Credit Card */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {onboardingStatus?.completedSteps.creditCard ? (
                <CheckCircleOutlineIcon sx={{ color: 'success.main' }} />
              ) : (
                <CreditCardIcon sx={{ color: 'text.secondary' }} />
              )}
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  textDecoration: onboardingStatus?.completedSteps.creditCard ? 'line-through' : 'none',
                  color: onboardingStatus?.completedSteps.creditCard ? 'text.secondary' : 'text.primary'
                }}
              >
                {t('steps.creditCard', 'Add credit card')}
                {onboardingStatus?.stats?.creditCardCount && onboardingStatus.stats.creditCardCount > 0 &&
                  ` (${onboardingStatus.stats.creditCardCount} ${t('steps.added', 'added')})`
                }
              </Typography>
              {!onboardingStatus?.completedSteps.creditCard && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleCreditCardClick}
                  disabled={!onboardingStatus?.completedSteps.bankAccount}
                >
                  {t('actions.addCard', 'Add Card')}
                </Button>
              )}
            </Box>

            {/* Step 4: Auto Scrape */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {onboardingStatus?.completedSteps.firstScrape ? (
                <CheckCircleOutlineIcon sx={{ color: 'success.main' }} />
              ) : (
                <SyncIcon sx={{ color: 'text.secondary' }} />
              )}
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  textDecoration: onboardingStatus?.completedSteps.firstScrape ? 'line-through' : 'none',
                  color: onboardingStatus?.completedSteps.firstScrape ? 'text.secondary' : 'text.primary'
                }}
              >
                {t('steps.autoSync', 'Auto-sync transactions')}
                {onboardingStatus?.stats?.transactionCount && onboardingStatus.stats.transactionCount > 0 &&
                  ` (${onboardingStatus.stats.transactionCount} ${t('steps.transactions', 'transactions')})`
                }
              </Typography>
              {!onboardingStatus?.completedSteps.firstScrape &&
               onboardingStatus?.completedSteps.bankAccount &&
               onboardingStatus?.completedSteps.creditCard && (
                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  {t('steps.automatic', 'Automatic')}
                </Typography>
              )}
            </Box>
          </Stack>
        </Box>

        {/* Main CTA */}
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
          {!onboardingStatus?.completedSteps.profile && (
            <Button
              variant="contained"
              size="large"
              onClick={handleProfileClick}
              startIcon={<PersonOutlineIcon />}
            >
              {t('actions.startSetup', 'Start Setup')}
            </Button>
          )}
          {onboardingStatus?.completedSteps.profile && !onboardingStatus?.completedSteps.bankAccount && (
            <Button
              variant="contained"
              size="large"
              onClick={handleBankAccountClick}
              startIcon={<AccountBalanceIcon />}
            >
              {t('actions.addBankAccount', 'Add Bank Account')}
            </Button>
          )}
          {onboardingStatus?.completedSteps.bankAccount && !onboardingStatus?.completedSteps.creditCard && (
            <Button
              variant="contained"
              size="large"
              onClick={handleCreditCardClick}
              startIcon={<CreditCardIcon />}
            >
              {t('actions.addCreditCard', 'Add Credit Card')}
            </Button>
          )}
          {onboardingStatus?.completedSteps.bankAccount &&
           onboardingStatus?.completedSteps.creditCard &&
           !onboardingStatus?.completedSteps.firstScrape && (
            <Box sx={{ textAlign: 'center' }}>
              <SyncIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
              <Typography variant="body1" color="text.secondary">
                {t('actions.autoSyncWaiting', 'Auto-sync will begin automatically...')}
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
};

export default LockedPagePlaceholder;
