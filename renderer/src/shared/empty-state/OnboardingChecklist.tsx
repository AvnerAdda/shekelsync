import React, { useCallback } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Button,
  Chip,
  Paper,
  Alert
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Lock as LockIcon,
  Person as PersonIcon,
  AccountBalance as AccountBalanceIcon,
  CreditCard as CreditCardIcon,
  CloudDownload as CloudDownloadIcon,
  Explore as ExploreIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useOnboarding } from '@app/contexts/OnboardingContext';

interface OnboardingChecklistProps {
  onProfileClick?: () => void;
  onBankAccountClick?: () => void;
  onCreditCardClick?: () => void;
  onScrapeClick?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

const OnboardingChecklist: React.FC<OnboardingChecklistProps> = ({
  onProfileClick,
  onBankAccountClick,
  onCreditCardClick,
  onScrapeClick,
  onDismiss,
  compact = false
}) => {
  const { t } = useTranslation();
  const { status, dismissOnboarding } = useOnboarding();

  if (!status) return null;

  const { completedSteps, suggestedAction, stats } = status;

  const triggerScrape = useCallback(() => {
    if (onScrapeClick) {
      onScrapeClick();
      return;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openScrapeModal'));
    }
  }, [onScrapeClick]);

  const steps = [
    {
      id: 'profile',
      title: t('onboarding.steps.profile.title'),
      description: t('onboarding.steps.profile.description'),
      icon: PersonIcon,
      completed: completedSteps.profile,
      onClick: onProfileClick,
      locked: false
    },
    {
      id: 'bankAccount',
      title: t('onboarding.steps.bankAccount.title'),
      description: stats?.bankAccountCount
        ? t('onboarding.steps.bankAccount.descriptionWithCount', { count: stats.bankAccountCount })
        : t('onboarding.steps.bankAccount.description'),
      icon: AccountBalanceIcon,
      completed: completedSteps.bankAccount,
      onClick: onBankAccountClick,
      locked: !completedSteps.profile
    },
    {
      id: 'creditCard',
      title: t('onboarding.steps.creditCard.title'),
      description: stats?.creditCardCount
        ? t('onboarding.steps.creditCard.descriptionWithCount', { count: stats.creditCardCount })
        : t('onboarding.steps.creditCard.description'),
      icon: CreditCardIcon,
      completed: completedSteps.creditCard,
      onClick: onCreditCardClick,
      locked: !completedSteps.bankAccount
    },
    {
      id: 'firstScrape',
      title: t('onboarding.steps.firstScrape.title'),
      description: t('onboarding.steps.firstScrape.description'),
      icon: CloudDownloadIcon,
      completed: completedSteps.firstScrape,
      onClick: triggerScrape,
      locked: !completedSteps.bankAccount || !completedSteps.creditCard
    },
    {
      id: 'explored',
      title: t('onboarding.steps.explored.title'),
      description: t('onboarding.steps.explored.description'),
      icon: ExploreIcon,
      completed: completedSteps.explored,
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('navigateToAnalysis'));
        }
      },
      locked: !completedSteps.firstScrape
    }
  ];

  // Find the suggested action index and calculate which steps should show buttons
  const suggestedActionIndex = steps.findIndex(s => s.id === suggestedAction);
  const shouldShowButton = (stepIndex: number, step: typeof steps[0]) => {
    if (step.completed || step.locked || !step.onClick) return false;
    // Show button for current suggested step and the next step (if unlocked)
    return stepIndex === suggestedActionIndex || stepIndex === suggestedActionIndex + 1;
  };

  const completedCount = Object.values(completedSteps).filter(Boolean).length;
  const totalSteps = 5;

  const handleDismiss = async () => {
    try {
      await dismissOnboarding();
      if (onDismiss) {
        onDismiss();
      }
    } catch (error) {
      console.error('Failed to dismiss onboarding:', error);
    }
  };

  if (compact) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 2,
          backgroundColor: 'primary.50',
          border: 1,
          borderColor: 'primary.200',
          borderRadius: 2,
          maxWidth: 600,
          mx: 'auto'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>
            {t('onboarding.gettingStarted')} ({completedCount}/{totalSteps})
          </Typography>
          <Button size="small" onClick={handleDismiss}>
            {t('onboarding.skip')}
          </Button>
        </Box>

        <List dense>
          {steps.map((step) => (
            <ListItem
              key={step.id}
              sx={{
                py: 0.5,
                opacity: step.locked ? 0.5 : 1
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                {step.completed ? (
                  <CheckCircleIcon color="success" fontSize="small" />
                ) : step.locked ? (
                  <LockIcon fontSize="small" color="disabled" />
                ) : (
                  <RadioButtonUncheckedIcon fontSize="small" color="action" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={step.title}
                primaryTypographyProps={{
                  variant: 'body2',
                  fontWeight: step.id === suggestedAction ? 600 : 400
                }}
              />
              {shouldShowButton(steps.indexOf(step), step) && (
                <Button
                  size="small"
                  variant={step.id === suggestedAction ? 'contained' : 'outlined'}
                  onClick={step.onClick}
                  disabled={step.locked}
                >
                  {step.id === suggestedAction ? t('onboarding.start') : t('onboarding.next')}
                </Button>
              )}
            </ListItem>
          ))}
        </List>

        {!completedSteps.firstScrape && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('onboarding.syncHintCompact')}
          </Alert>
        )}
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        backgroundColor: 'background.default',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        maxWidth: 600,
        mx: 'auto'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            {t('onboarding.gettingStarted')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('onboarding.completeSteps')}
          </Typography>
        </Box>
        <Chip
          label={`${completedCount}/${totalSteps}`}
          color={completedCount === totalSteps ? 'success' : 'primary'}
          size="small"
        />
      </Box>

      <List>
        {steps.map((step, index) => {
          const StepIcon = step.icon;
          return (
            <ListItem
              key={step.id}
              sx={{
                flexDirection: 'column',
                alignItems: 'flex-start',
                py: 2,
                borderBottom: index < steps.length - 1 ? 1 : 0,
                borderColor: 'divider',
                opacity: step.locked ? 0.5 : 1
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', mb: 1 }}>
                <ListItemIcon sx={{ minWidth: 48, mt: 0.5 }}>
                  {step.completed ? (
                    <CheckCircleIcon color="success" sx={{ fontSize: 32 }} />
                  ) : step.locked ? (
                    <LockIcon color="disabled" sx={{ fontSize: 32 }} />
                  ) : (
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        border: 2,
                        borderColor: step.id === suggestedAction ? 'primary.main' : 'action.disabled',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: 14,
                        color: step.id === suggestedAction ? 'primary.main' : 'text.secondary'
                      }}
                    >
                      {index + 1}
                    </Box>
                  )}
                </ListItemIcon>

                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                    <StepIcon
                      sx={{
                        mr: 1,
                        fontSize: 20,
                        color: step.completed ? 'success.main' : 'text.secondary'
                      }}
                    />
                    <Typography
                      variant="subtitle1"
                      fontWeight={step.id === suggestedAction ? 600 : 500}
                    >
                      {step.title}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                    {step.description}
                  </Typography>

                  {shouldShowButton(index, step) && (
                    <Button
                      variant={step.id === suggestedAction ? 'contained' : 'outlined'}
                      size="small"
                      onClick={step.onClick}
                      disabled={step.locked}
                      sx={{ ml: 4, mt: 1 }}
                    >
                      {step.id === suggestedAction ? t('onboarding.startNow') : t('onboarding.upNext')}
                    </Button>
                  )}
                </Box>
              </Box>
            </ListItem>
          );
        })}
      </List>

      {!completedSteps.firstScrape && (
        <Alert severity="info" sx={{ mt: 3 }}>
          {t('onboarding.syncHint')}
        </Alert>
      )}

      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Button
          variant="text"
          size="small"
          onClick={handleDismiss}
          sx={{ color: 'text.secondary' }}
        >
          {t('onboarding.doLater')}
        </Button>
      </Box>
    </Paper>
  );
};

export default OnboardingChecklist;
