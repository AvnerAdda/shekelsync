import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Button,
  Chip,
  Paper
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Lock as LockIcon,
  Person as PersonIcon,
  AccountBalance as AccountBalanceIcon,
  CloudDownload as CloudDownloadIcon,
  Explore as ExploreIcon
} from '@mui/icons-material';
import { useOnboarding } from '../../contexts/OnboardingContext';

interface OnboardingChecklistProps {
  onProfileClick?: () => void;
  onAccountsClick?: () => void;
  onScrapeClick?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

const OnboardingChecklist: React.FC<OnboardingChecklistProps> = ({
  onProfileClick,
  onAccountsClick,
  onScrapeClick,
  onDismiss,
  compact = false
}) => {
  const { status, dismissOnboarding } = useOnboarding();

  if (!status) return null;

  const { completedSteps, suggestedAction } = status;

  const steps = [
    {
      id: 'profile',
      title: 'Set up your profile',
      description: 'Tell us about yourself to get personalized insights',
      icon: PersonIcon,
      completed: completedSteps.profile,
      onClick: onProfileClick,
      locked: false
    },
    {
      id: 'accounts',
      title: 'Add bank/credit accounts',
      description: 'Connect your Israeli bank accounts and credit cards',
      icon: AccountBalanceIcon,
      completed: completedSteps.accounts,
      onClick: onAccountsClick,
      locked: !completedSteps.profile
    },
    {
      id: 'firstScrape',
      title: 'Scrape your first transactions',
      description: 'Fetch your transaction history automatically',
      icon: CloudDownloadIcon,
      completed: completedSteps.firstScrape,
      onClick: onScrapeClick,
      locked: !completedSteps.accounts
    },
    {
      id: 'explored',
      title: 'Explore your finances',
      description: 'View analytics, set budgets, and track spending',
      icon: ExploreIcon,
      completed: completedSteps.explored,
      onClick: null,
      locked: !completedSteps.firstScrape
    }
  ];

  const completedCount = Object.values(completedSteps).filter(Boolean).length;
  const totalSteps = 4;

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
            Getting Started ({completedCount}/{totalSteps})
          </Typography>
          <Button size="small" onClick={handleDismiss}>
            Skip
          </Button>
        </Box>

        <List dense>
          {steps.map((step, index) => (
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
              {step.id === suggestedAction && step.onClick && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={step.onClick}
                  disabled={step.locked}
                >
                  Start
                </Button>
              )}
            </ListItem>
          ))}
        </List>
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
            Getting Started
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Complete these steps to unlock all features
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

                  {step.id === suggestedAction && step.onClick && (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={step.onClick}
                      disabled={step.locked}
                      sx={{ ml: 4, mt: 1 }}
                    >
                      Start Now
                    </Button>
                  )}
                </Box>
              </Box>
            </ListItem>
          );
        })}
      </List>

      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Button
          variant="text"
          size="small"
          onClick={handleDismiss}
          sx={{ color: 'text.secondary' }}
        >
          I'll do this later
        </Button>
      </Box>
    </Paper>
  );
};

export default OnboardingChecklist;
