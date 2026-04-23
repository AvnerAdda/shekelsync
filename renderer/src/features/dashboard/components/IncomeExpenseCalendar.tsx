import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Skeleton,
  Stack,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
  Today as TodayIcon,
} from '@mui/icons-material';
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth, subMonths } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import type { DashboardHistoryEntry } from '@renderer/types/dashboard';
import {
  buildIncomeExpenseCalendarDays,
  formatIncomeExpenseCalendarMonthLabel,
  getIncomeExpenseCalendarWeekdayLabels,
  getIncomeExpenseMonthTotals,
  type IncomeExpenseCalendarDay,
} from './income-expense-calendar-helpers';

interface IncomeExpenseCalendarProps {
  includeCardRepayments: boolean;
  includeCapitalReturns: boolean;
  formatCurrency: (value: number, options?: any) => string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

function buildFetchErrorMessage(response: { status: number; statusText?: string }): string {
  if (response.statusText) {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
  return `HTTP ${response.status}`;
}

const SummaryStat: React.FC<{
  label: string;
  value: string;
  color: string;
}> = ({ label, value, color }) => (
  <Box
    sx={{
      minWidth: 110,
      px: 1.5,
      py: 1,
      borderRadius: '12px',
      border: '1px solid',
      borderColor: alpha(color, 0.22),
      bgcolor: alpha(color, 0.07),
    }}
  >
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
      {label}
    </Typography>
    <Typography variant="body2" fontWeight={700} sx={{ color }}>
      {value}
    </Typography>
  </Box>
);

const IncomeExpenseCalendar: React.FC<IncomeExpenseCalendarProps> = ({
  includeCardRepayments,
  includeCapitalReturns,
  formatCurrency,
  selectedDate,
  onSelectDate,
}) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'transactionHistory.calendar' });
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [history, setHistory] = useState<DashboardHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchMonthHistory = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);
      const response = await apiClient.get(
        `/api/analytics/dashboard?startDate=${monthStart.toISOString()}&endDate=${monthEnd.toISOString()}&aggregation=daily&includeBreakdowns=0&includeSummary=0`,
      );

      if (!response.ok) {
        throw new Error(buildFetchErrorMessage(response));
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      const result = response.data as { history?: DashboardHistoryEntry[] } | null;
      setHistory(Array.isArray(result?.history) ? result.history : []);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      console.error('[IncomeExpenseCalendar] Failed to fetch month history:', err);
      setHistory([]);
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [currentMonth, t]);

  useEffect(() => {
    void fetchMonthHistory();
  }, [fetchMonthHistory]);

  const calendarDays = useMemo(
    () =>
      buildIncomeExpenseCalendarDays({
        history,
        monthDate: currentMonth,
        includeCardRepayments,
        includeCapitalReturns,
      }),
    [currentMonth, history, includeCapitalReturns, includeCardRepayments],
  );

  const monthTotals = useMemo(
    () => getIncomeExpenseMonthTotals(calendarDays, currentMonth),
    [calendarDays, currentMonth],
  );

  const maxActivity = useMemo(
    () =>
      Math.max(
        0,
        ...calendarDays
          .filter((day) => day.isCurrentMonth)
          .map((day) => day.income + day.expenses),
      ),
    [calendarDays],
  );

  const weekdayLabels = useMemo(
    () => getIncomeExpenseCalendarWeekdayLabels(i18n.language),
    [i18n.language],
  );

  const monthLabel = useMemo(
    () => formatIncomeExpenseCalendarMonthLabel(currentMonth, i18n.language),
    [currentMonth, i18n.language],
  );

  const isCurrentMonthDisplayed = isSameMonth(currentMonth, new Date());
  const hasCurrentMonthActivity = calendarDays.some((day) => day.isCurrentMonth && day.hasActivity);
  const todayIso = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const formatAmount = useCallback(
    (value: number, options?: { compact?: boolean; showSign?: boolean }) =>
      formatCurrency(value, {
        absolute: !options?.showSign,
        compact: options?.compact,
        maximumFractionDigits: 0,
        showSign: options?.showSign,
      }),
    [formatCurrency],
  );

  const handlePrev = useCallback(() => setCurrentMonth((month) => subMonths(month, 1)), []);
  const handleNext = useCallback(() => setCurrentMonth((month) => addMonths(month, 1)), []);
  const handleToday = useCallback(() => setCurrentMonth(new Date()), []);

  const handleDayClick = useCallback(
    (day: IncomeExpenseCalendarDay) => {
      if (!day.isCurrentMonth || day.isFuture) {
        return;
      }
      onSelectDate(day.isoDate);
    },
    [onSelectDate],
  );

  if (loading) {
    return (
      <Box sx={{ p: 1 }}>
        <Skeleton variant="rectangular" height={430} animation="wave" sx={{ borderRadius: 3 }} />
      </Box>
    );
  }

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', lg: 'center' }}
        spacing={2}
        mb={2}
      >
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton size="small" onClick={handlePrev} aria-label={t('previousMonth')}>
              <PrevIcon />
            </IconButton>
            <Typography
              variant={isCompact ? 'body1' : 'h6'}
              fontWeight={700}
              sx={{ minWidth: isCompact ? 150 : 210, textAlign: 'center', textTransform: 'capitalize' }}
            >
              {monthLabel}
            </Typography>
            <IconButton size="small" onClick={handleNext} aria-label={t('nextMonth')}>
              <NextIcon />
            </IconButton>
            {!isCurrentMonthDisplayed && (
              <Button
                size="small"
                startIcon={<TodayIcon />}
                onClick={handleToday}
                sx={{ ml: 0.5, borderRadius: 2, textTransform: 'none' }}
              >
                {t('today')}
              </Button>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('subtitle')}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <SummaryStat
            label={t('monthIncome')}
            value={formatAmount(monthTotals.income)}
            color={theme.palette.success.main}
          />
          <SummaryStat
            label={t('monthExpenses')}
            value={formatAmount(monthTotals.expenses)}
            color={theme.palette.error.main}
          />
          <SummaryStat
            label={t('monthNet')}
            value={formatAmount(monthTotals.net, { showSign: true })}
            color={monthTotals.net >= 0 ? theme.palette.success.main : theme.palette.error.main}
          />
        </Stack>
      </Stack>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void fetchMonthHistory()}>
              {t('retry')}
            </Button>
          }
        >
          {t('error')}: {error}
        </Alert>
      )}

      {!error && !hasCurrentMonthActivity && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('emptyMonth')}
        </Typography>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          border: '1px solid',
          borderColor: alpha(theme.palette.divider, 0.08),
          borderRadius: 3,
          overflow: 'hidden',
          backgroundColor: alpha(theme.palette.background.paper, 0.4),
        }}
      >
        {weekdayLabels.map((label) => (
          <Box
            key={label}
            sx={{
              py: 1,
              px: 0.5,
              textAlign: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.04),
              borderBottom: '1px solid',
              borderRight: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.08),
            }}
          >
            <Typography
              variant="caption"
              fontWeight={700}
              color="text.secondary"
              sx={{ fontSize: isCompact ? '0.65rem' : '0.75rem' }}
            >
              {label}
            </Typography>
          </Box>
        ))}

        {calendarDays.map((day) => {
          const isSelected = selectedDate === day.isoDate;
          const canSelect = day.isCurrentMonth && !day.isFuture;
          const activityTotal = day.income + day.expenses;
          const intensity = maxActivity > 0 ? activityTotal / maxActivity : 0;
          const baseColor = day.net >= 0 ? theme.palette.success.main : theme.palette.error.main;
          const backgroundColor = isSelected
            ? alpha(theme.palette.primary.main, 0.12)
            : day.hasActivity
              ? alpha(baseColor, 0.05 + intensity * 0.12)
              : day.isFuture
                ? alpha(theme.palette.action.disabledBackground, 0.5)
                : 'transparent';

          return (
            <Box
              key={day.isoDate}
              component="button"
              type="button"
              onClick={() => handleDayClick(day)}
              disabled={!canSelect}
              sx={{
                minHeight: isCompact ? 84 : 118,
                p: isCompact ? 0.75 : 1,
                border: 'none',
                borderRight: '1px solid',
                borderBottom: '1px solid',
                borderColor: alpha(theme.palette.divider, 0.08),
                bgcolor: backgroundColor,
                opacity: day.isCurrentMonth ? 1 : 0.32,
                cursor: canSelect ? 'pointer' : 'default',
                textAlign: 'left',
                transition: 'background-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
                boxShadow: isSelected
                  ? `inset 0 0 0 2px ${alpha(theme.palette.primary.main, 0.55)}`
                  : undefined,
                '&:hover': canSelect
                  ? {
                      bgcolor: alpha(theme.palette.primary.main, 0.08),
                      transform: 'translateY(-1px)',
                    }
                  : undefined,
              }}
            >
              <Stack sx={{ height: '100%' }} spacing={0.75}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: day.isoDate === todayIso ? 24 : 'auto',
                      height: day.isoDate === todayIso ? 24 : 'auto',
                      px: day.isoDate === todayIso ? 0 : 0.25,
                      borderRadius: '999px',
                      bgcolor: day.isoDate === todayIso
                        ? theme.palette.primary.main
                        : 'transparent',
                      color: day.isoDate === todayIso
                        ? theme.palette.primary.contrastText
                        : theme.palette.text.primary,
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {day.date.getDate()}
                  </Typography>
                  {!isCompact && day.hasActivity && (
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 700,
                        color: day.net >= 0 ? 'success.main' : 'error.main',
                      }}
                    >
                      {formatAmount(day.net, { showSign: true, compact: true })}
                    </Typography>
                  )}
                </Stack>

                {day.hasActivity && (
                  <Stack spacing={0.4} sx={{ mt: 0.25 }}>
                    {day.income > 0 && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'success.main',
                          fontWeight: 600,
                          fontSize: isCompact ? '0.62rem' : '0.72rem',
                          lineHeight: 1.2,
                        }}
                      >
                        ↑ {formatAmount(day.income, { compact: isCompact })}
                      </Typography>
                    )}
                    {day.expenses > 0 && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'error.main',
                          fontWeight: 600,
                          fontSize: isCompact ? '0.62rem' : '0.72rem',
                          lineHeight: 1.2,
                        }}
                      >
                        ↓ {formatAmount(day.expenses, { compact: isCompact })}
                      </Typography>
                    )}
                  </Stack>
                )}

                {isCompact && day.hasActivity && (
                  <Typography
                    variant="caption"
                    sx={{
                      mt: 'auto',
                      color: day.net >= 0 ? 'success.main' : 'error.main',
                      fontWeight: 700,
                      fontSize: '0.6rem',
                      lineHeight: 1.2,
                    }}
                  >
                    {formatAmount(day.net, { showSign: true, compact: true })}
                  </Typography>
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default IncomeExpenseCalendar;
