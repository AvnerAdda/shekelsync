import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DataObjectIcon from '@mui/icons-material/DataObject';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type {
  MoneyReviewAction,
  MoneyReviewGroup,
  MoneyReviewItem,
  MoneyReviewStatus,
  SnoozePreset,
} from '../types';
import MoneyReviewItemActions from './MoneyReviewItemActions';
import { buildMoneyReviewTimeScopeLabel } from '../time-scope';

const GROUP_ICONS: Record<MoneyReviewGroup, React.ReactNode> = {
  data: <DataObjectIcon fontSize="small" />,
  cash: <ShieldOutlinedIcon fontSize="small" />,
  improve: <AutoAwesomeIcon fontSize="small" />,
};

const GROUP_COLORS: Record<MoneyReviewGroup, 'info' | 'warning' | 'secondary'> = {
  data: 'info',
  cash: 'warning',
  improve: 'secondary',
};

const SEVERITY_COLORS: Record<MoneyReviewItem['severity'], 'default' | 'warning' | 'error'> = {
  low: 'default',
  medium: 'default',
  high: 'warning',
  critical: 'error',
};

interface MoneyReviewCardProps {
  item: MoneyReviewItem;
  position: number;
  isNext: boolean;
  busy: boolean;
  onPrimaryAction: (item: MoneyReviewItem, action: MoneyReviewAction) => Promise<void>;
  onUpdateStatus: (
    item: MoneyReviewItem,
    status: MoneyReviewStatus,
    snoozePreset?: SnoozePreset,
  ) => Promise<boolean>;
  onOpenDetails: (item: MoneyReviewItem) => void;
}

const MoneyReviewCard: React.FC<MoneyReviewCardProps> = ({
  item,
  position,
  isNext,
  busy,
  onPrimaryAction,
  onUpdateStatus,
  onOpenDetails,
}) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'moneyReview' });
  const { formatCurrency } = useFinancePrivacy();
  const timeScopeLabel = buildMoneyReviewTimeScopeLabel(item, i18n?.language || 'en');
  const isCompleted = ['resolved', 'dismissed'].includes(item.status);
  const isSnoozed = item.status === 'snoozed';
  const estimatedMinutes = item.group === 'data' ? 1 : 2;
  const groupPalette = theme.palette[GROUP_COLORS[item.group]];
  const severityColor = item.severity === 'critical'
    ? theme.palette.error.main
    : item.severity === 'high'
      ? theme.palette.warning.main
      : theme.palette.primary.main;

  const snoozedDate = item.snoozedUntil ? new Date(item.snoozedUntil) : null;
  const snoozedUntil = snoozedDate && !Number.isNaN(snoozedDate.getTime())
    ? new Intl.DateTimeFormat(i18n?.language || 'en', { month: 'short', day: 'numeric' })
      .format(snoozedDate)
    : null;

  return (
    <Card
      id={`money-review-item-${item.id}`}
      data-money-review-item="true"
      tabIndex={-1}
      elevation={0}
      sx={{
        position: 'relative',
        overflow: 'visible',
        border: '1px solid',
        borderColor: isNext ? alpha(theme.palette.primary.main, 0.42) : 'divider',
        borderRadius: 3,
        transition: 'transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
        '&::before': {
          content: '""',
          position: 'absolute',
          insetInlineStart: -1,
          top: 18,
          bottom: 18,
          width: 4,
          borderRadius: 4,
          bgcolor: severityColor,
        },
        '&:hover': {
          transform: 'translateY(-2px)',
          borderColor: alpha(theme.palette.primary.main, 0.3),
          boxShadow: `0 10px 28px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.24 : 0.08)}`,
        },
        '&:focus-visible': {
          outline: `3px solid ${alpha(theme.palette.primary.main, 0.35)}`,
          outlineOffset: 3,
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
        },
      }}
    >
      {isNext && (
        <Chip
          label={t('item.nextUp')}
          size="small"
          color="primary"
          sx={{
            position: 'absolute',
            insetInlineStart: 22,
            top: -12,
            fontWeight: 750,
            boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.22)}`,
          }}
        />
      )}

      <CardContent sx={{ p: { xs: 2, sm: 2.25 }, '&:last-child': { pb: { xs: 2, sm: 2.25 } } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box
            aria-hidden="true"
            sx={{
              display: { xs: 'none', sm: 'grid' },
              placeItems: 'center',
              width: 36,
              height: 36,
              flexShrink: 0,
              borderRadius: 2.5,
              color: groupPalette.main,
              bgcolor: alpha(groupPalette.main, 0.12),
            }}
          >
            {GROUP_ICONS[item.group]}
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
                spacing={{ xs: 1.5, md: 2 }}
              sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
            >
              <Box sx={{ minWidth: 0, maxWidth: 760 }}>
                <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography
                    aria-hidden="true"
                    variant="caption"
                    color="text.disabled"
                    sx={{ fontWeight: 800, letterSpacing: '0.08em' }}
                  >
                    {String(position).padStart(2, '0')}
                  </Typography>
                  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.35 }}>
                    {item.title}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t(`priority.${item.severity}`)}
                    color={SEVERITY_COLORS[item.severity]}
                    sx={{ height: 24, fontSize: '0.72rem' }}
                  />
                  {item.status === 'accepted' && <Chip size="small" color="primary" label={t('status.inProgress')} />}
                  {isSnoozed && <Chip size="small" icon={<ScheduleIcon />} label={t('status.snoozed')} />}
                  {isCompleted && (
                    <Chip
                      size="small"
                      color={item.status === 'resolved' ? 'success' : 'default'}
                      label={t(`status.${item.status}`)}
                    />
                  )}
                </Stack>

                <Typography color="text.secondary" sx={{ mt: 0.75, lineHeight: 1.55 }}>
                  {item.description}
                </Typography>

                <Stack direction="row" spacing={1.5} useFlexGap sx={{ mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <ScheduleIcon sx={{ fontSize: 15 }} />
                    {t('item.minutes', { count: estimatedMinutes })}
                  </Typography>
                  <Chip
                    size="small"
                    label={t(`groups.${item.group}.title`)}
                    sx={{ height: 23, color: groupPalette.main, bgcolor: alpha(groupPalette.main, 0.1) }}
                  />
                  {timeScopeLabel && (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<ScheduleIcon />}
                      label={t(timeScopeLabel.key, timeScopeLabel.values)}
                      sx={{ height: 23 }}
                    />
                  )}
                  {item.potentialImpact > 0 && (
                    <Typography variant="caption" color="success.main" sx={{ fontWeight: 800 }}>
                      {t('potentialImpact', { amount: formatCurrency(item.potentialImpact) })}
                    </Typography>
                  )}
                  {isSnoozed && snoozedUntil && (
                    <Typography variant="caption" color="text.secondary">
                      {t('item.returnsOn', { date: snoozedUntil })}
                    </Typography>
                  )}
                </Stack>
              </Box>

              <Stack spacing={0.75} sx={{ alignItems: { md: 'flex-end' } }}>
                <Button size="small" variant="text" onClick={() => onOpenDetails(item)}>
                  {t('actions.details')}
                </Button>
                <MoneyReviewItemActions
                  item={item}
                  busy={busy}
                  onPrimaryAction={onPrimaryAction}
                  onUpdateStatus={onUpdateStatus}
                />
              </Stack>
            </Stack>
          </Box>
        </Stack>
      </CardContent>

    </Card>
  );
};

export default MoneyReviewCard;
