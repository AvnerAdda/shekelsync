import React from 'react';
import { Box, Typography, Button, Stack } from '@mui/material';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  variant?: 'contained' | 'outlined' | 'text';
}

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  primaryAction?: EmptyStateAction;
  secondaryActions?: EmptyStateAction[];
  showOnboardingChecklist?: boolean;
  minHeight?: number | string;
  children?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  primaryAction,
  secondaryActions = [],
  showOnboardingChecklist = false,
  minHeight = 400,
  children
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight,
        py: 6,
        px: 3,
        textAlign: 'center'
      }}
    >
      {/* Icon */}
      <Box
        sx={{
          color: 'text.secondary',
          opacity: 0.4,
          mb: 3
        }}
      >
        {icon}
      </Box>

      {/* Title */}
      <Typography
        variant="h5"
        component="h2"
        gutterBottom
        sx={{ fontWeight: 500, color: 'text.primary' }}
      >
        {title}
      </Typography>

      {/* Description */}
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{ mb: 4, maxWidth: 500 }}
      >
        {description}
      </Typography>

      {/* Onboarding Checklist (if enabled) */}
      {showOnboardingChecklist && children}

      {/* Action Buttons */}
      {(primaryAction || secondaryActions.length > 0) && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ mt: showOnboardingChecklist ? 3 : 0 }}
        >
          {primaryAction && (
            <Button
              variant={primaryAction.variant || 'contained'}
              size="large"
              startIcon={primaryAction.icon}
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              sx={{ minWidth: 160 }}
            >
              {primaryAction.label}
            </Button>
          )}

          {secondaryActions.map((action, index) => (
            <Button
              key={index}
              variant={action.variant || 'outlined'}
              size="large"
              startIcon={action.icon}
              onClick={action.onClick}
              disabled={action.disabled}
              sx={{ minWidth: 140 }}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      )}
    </Box>
  );
};

export default EmptyState;
