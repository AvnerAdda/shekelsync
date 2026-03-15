import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  Stack,
  Skeleton,
  alpha,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
  Today as TodayIcon,
} from '@mui/icons-material';
import { format, addMonths, subMonths, isSameMonth } from 'date-fns';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import type { Subscription } from '@renderer/types/subscriptions';
import { buildCalendarData, getMonthTotal } from '../utils/subscription-calendar-helpers';
import type { CalendarSubscriptionEntry } from '../utils/subscription-calendar-helpers';
import CalendarDayCell from './CalendarDayCell';
import CalendarDayDetail from './CalendarDayDetail';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface SubscriptionCalendarProps {
  subscriptions: Subscription[];
  loading: boolean;
  onEdit: (subscription: Subscription) => void;
}

const SubscriptionCalendar: React.FC<SubscriptionCalendarProps> = ({
  subscriptions,
  loading,
  onEdit,
}) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  const { formatCurrency } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions.calendar' });

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedSubs, setSelectedSubs] = useState<CalendarSubscriptionEntry[]>([]);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const calendarData = useMemo(
    () => buildCalendarData(subscriptions, year, month),
    [subscriptions, year, month],
  );

  const monthTotal = useMemo(
    () => getMonthTotal(calendarData, year, month),
    [calendarData, year, month],
  );

  const maxDayTotal = useMemo(
    () => Math.max(0, ...calendarData.map((d) =>
      d.subscriptions.reduce((sum, e) => sum + e.amount, 0),
    )),
    [calendarData],
  );

  const handlePrev = useCallback(() => setCurrentMonth((m) => subMonths(m, 1)), []);
  const handleNext = useCallback(() => setCurrentMonth((m) => addMonths(m, 1)), []);
  const handleToday = useCallback(() => setCurrentMonth(new Date()), []);

  const handleDayClick = useCallback((date: Date, event: React.MouseEvent<HTMLElement>) => {
    const dayData = calendarData.find(
      (d) => d.date.getTime() === date.getTime(),
    );
    if (dayData && dayData.subscriptions.length > 0) {
      setSelectedDay(date);
      setSelectedSubs(dayData.subscriptions);
      setAnchorEl(event.currentTarget);
    }
  }, [calendarData]);

  const handleCloseDetail = useCallback(() => {
    setSelectedDay(null);
    setSelectedSubs([]);
    setAnchorEl(null);
  }, []);

  const isCurrentMonthDisplayed = isSameMonth(currentMonth, new Date());

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  return (
    <Box>
      {/* Month navigation */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        mb={2}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton size="small" onClick={handlePrev}>
            <PrevIcon />
          </IconButton>
          <Typography
            variant={isCompact ? 'body1' : 'h6'}
            fontWeight={700}
            sx={{ minWidth: isCompact ? 120 : 180, textAlign: 'center' }}
          >
            {format(currentMonth, 'MMMM yyyy')}
          </Typography>
          <IconButton size="small" onClick={handleNext}>
            <NextIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          {!isCurrentMonthDisplayed && (
            <Button
              size="small"
              startIcon={<TodayIcon />}
              onClick={handleToday}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {t('today')}
            </Button>
          )}
          {monthTotal > 0 && (
            <Typography variant="body2" color="text.secondary" fontWeight={600}>
              {t('monthTotal', { amount: formatCurrency(monthTotal) })}
            </Typography>
          )}
        </Stack>
      </Stack>

      {/* Calendar grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          border: '1px solid',
          borderColor: alpha(theme.palette.divider, 0.08),
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {/* Weekday headers */}
        {WEEKDAYS.map((day) => (
          <Box
            key={day}
            sx={{
              py: 1,
              textAlign: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.04),
              borderBottom: '1px solid',
              borderRight: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.08),
            }}
          >
            <Typography
              variant="caption"
              fontWeight={600}
              color="text.secondary"
              sx={{ fontSize: isCompact ? '0.6rem' : '0.75rem' }}
            >
              {day}
            </Typography>
          </Box>
        ))}

        {/* Day cells */}
        {calendarData.map((dayData, i) => (
          <CalendarDayCell
            key={i}
            date={dayData.date}
            subscriptions={dayData.subscriptions}
            currentMonth={currentMonth}
            maxDayTotal={maxDayTotal}
            onClick={handleDayClick}
          />
        ))}
      </Box>

      {/* Day detail popover */}
      <CalendarDayDetail
        open={!!selectedDay}
        anchorEl={anchorEl}
        date={selectedDay}
        subscriptions={selectedSubs}
        onClose={handleCloseDetail}
        onEdit={onEdit}
      />
    </Box>
  );
};

export default SubscriptionCalendar;
