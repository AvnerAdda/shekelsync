import React from 'react';
import { Box, Typography, alpha, useTheme, useMediaQuery, type Theme } from '@mui/material';
import { isSameMonth, isToday as isTodayFn } from 'date-fns';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import type { CalendarSubscriptionEntry } from '../utils/subscription-calendar-helpers';

const MAX_VISIBLE_PILLS = 3;

function getDayBackground(theme: Theme, isToday: boolean, intensity: number): string {
  if (isToday) return alpha(theme.palette.primary.main, 0.06);
  if (intensity <= 0) return 'transparent';

  let heatColor = theme.palette.success.main;
  if (intensity >= 0.7) heatColor = theme.palette.error.main;
  else if (intensity >= 0.4) heatColor = theme.palette.warning.main;

  return alpha(heatColor, 0.06 + intensity * 0.12);
}

interface CalendarDayCellProps {
  date: Date;
  subscriptions: CalendarSubscriptionEntry[];
  currentMonth: Date;
  maxDayTotal: number;
  onClick: (date: Date, event: React.MouseEvent<HTMLElement>) => void;
}

const CalendarDayCell: React.FC<CalendarDayCellProps> = ({
  date,
  subscriptions,
  currentMonth,
  maxDayTotal,
  onClick,
}) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions.calendar' });

  const isCurrentMonth = isSameMonth(date, currentMonth);
  const isToday = isTodayFn(date);
  const hasSubscriptions = subscriptions.length > 0;
  const visibleSubs = subscriptions.slice(0, MAX_VISIBLE_PILLS);
  const overflowCount = subscriptions.length - MAX_VISIBLE_PILLS;

  // Heat intensity: 0 (no charges) to 1 (highest day in the month)
  const dayTotal = subscriptions.reduce((sum, e) => sum + e.amount, 0);
  const intensity = maxDayTotal > 0 ? dayTotal / maxDayTotal : 0;

  const bgColor = getDayBackground(theme, isToday, intensity);

  return (
    <Box
      onClick={(e) => hasSubscriptions && onClick(date, e)}
      sx={{
        minHeight: isCompact ? 48 : 90,
        p: isCompact ? 0.5 : 1,
        borderRight: '1px solid',
        borderBottom: '1px solid',
        borderColor: alpha(theme.palette.divider, 0.08),
        cursor: hasSubscriptions ? 'pointer' : 'default',
        opacity: isCurrentMonth ? 1 : 0.35,
        bgcolor: bgColor,
        transition: 'background-color 0.15s',
        '&:hover': hasSubscriptions
          ? { bgcolor: alpha(theme.palette.action.hover, 0.08) }
          : undefined,
        overflow: 'hidden',
      }}
    >
      {/* Day number */}
      <Typography
        variant="caption"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isToday ? 24 : 'auto',
          height: isToday ? 24 : 'auto',
          borderRadius: '50%',
          bgcolor: isToday ? theme.palette.primary.main : 'transparent',
          color: isToday
            ? theme.palette.primary.contrastText
            : isCurrentMonth
              ? theme.palette.text.primary
              : theme.palette.text.disabled,
          fontWeight: isToday ? 700 : 500,
          fontSize: isCompact ? '0.65rem' : '0.75rem',
          lineHeight: 1,
          mb: 0.5,
        }}
      >
        {date.getDate()}
      </Typography>

      {/* Subscription pills or dots */}
      {isCompact ? (
        // Compact mode: colored dots
        hasSubscriptions && (
          <Box sx={{ display: 'flex', gap: 0.3, flexWrap: 'wrap', justifyContent: 'center' }}>
            {subscriptions.slice(0, 4).map((entry, i) => (
              <Box
                key={i}
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: entry.subscription.category_color || theme.palette.primary.main,
                }}
              />
            ))}
            {subscriptions.length > 4 && (
              <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'text.secondary', lineHeight: 1 }}>
                +{subscriptions.length - 4}
              </Typography>
            )}
          </Box>
        )
      ) : (
        // Full mode: pills with name and amount
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
          {visibleSubs.map((entry, i) => (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                pl: 0.75,
                py: 0.25,
                borderLeft: '3px solid',
                borderColor: entry.subscription.category_color || theme.palette.primary.main,
                borderRadius: '0 4px 4px 0',
                bgcolor: alpha(
                  entry.subscription.category_color || theme.palette.primary.main,
                  0.08,
                ),
                minWidth: 0,
              }}
            >
              <Typography
                variant="caption"
                noWrap
                sx={{
                  fontSize: '0.65rem',
                  lineHeight: 1.2,
                  flex: 1,
                  minWidth: 0,
                  color: theme.palette.text.primary,
                }}
              >
                {entry.subscription.display_name}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{
                  fontSize: '0.6rem',
                  lineHeight: 1.2,
                  color: theme.palette.text.secondary,
                  pr: 0.5,
                  flexShrink: 0,
                }}
              >
                {formatCurrency(entry.amount)}
              </Typography>
            </Box>
          ))}
          {overflowCount > 0 && (
            <Typography
              variant="caption"
              sx={{
                fontSize: '0.6rem',
                color: theme.palette.text.secondary,
                pl: 0.75,
              }}
            >
              {t('moreCharges', { count: overflowCount })}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};

export default CalendarDayCell;
