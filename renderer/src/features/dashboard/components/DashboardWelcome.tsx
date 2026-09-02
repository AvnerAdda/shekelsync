import React, { useMemo } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslation } from 'react-i18next';
import DashboardPeriodSelector from './DashboardPeriodSelector';

const DashboardWelcome: React.FC = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'dashboardWelcome' });
  const todayLabel = useMemo(
    () => new Intl.DateTimeFormat(i18n.language || undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date()),
    [i18n.language],
  );

  return (
    <Box
      component="header"
      sx={{
        mb: 3,
        display: 'flex',
        flexDirection: { xs: 'column', lg: 'row' },
        alignItems: { xs: 'stretch', lg: 'flex-end' },
        justifyContent: 'space-between',
        gap: 2.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.25 }}
        >
          <Typography
            variant="overline"
            sx={{
              color: 'text.secondary',
              fontWeight: 750,
              letterSpacing: '0.08em',
              lineHeight: 1,
            }}
          >
            {todayLabel}
          </Typography>
          <Chip
            size="small"
            icon={<LockOutlinedIcon sx={{ fontSize: '14px !important' }} />}
            label={t('localFirst', { defaultValue: 'Private on this device' })}
            sx={{
              height: 26,
              color: 'primary.dark',
              bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.09),
              '& .MuiChip-icon': { color: 'inherit' },
            }}
          />
        </Stack>
        <Typography component="h1" variant="h3" sx={{ maxWidth: 680 }}>
          {t('title', { defaultValue: 'Your money, clearly.' })}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 680 }}>
          {t('subtitle', {
            defaultValue: 'See what changed, what needs attention, and what to do next.',
          })}
        </Typography>
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { xs: 'stretch', sm: 'center' }, flexShrink: 0 }}
      >
        <DashboardPeriodSelector
          sx={{
            bgcolor: 'background.paper',
            borderRadius: '11px',
            boxShadow: `inset 0 0 0 1px ${theme.palette.divider}`,
            '& .MuiToggleButton-root': {
              border: 0,
              minWidth: 56,
              px: 1.5,
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: 'primary.dark',
              },
            },
          }}
        />
        <Button
          variant="contained"
          endIcon={(
            <ArrowForwardRoundedIcon
              sx={{ transform: theme.direction === 'rtl' ? 'scaleX(-1)' : 'none' }}
            />
          )}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('navigateTo', { detail: { path: '/review' } }));
          }}
        >
          {t('reviewActions', { defaultValue: 'Review actions' })}
        </Button>
      </Stack>
    </Box>
  );
};

export default DashboardWelcome;
