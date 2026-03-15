import React from 'react';
import {
  Popover,
  Drawer,
  Box,
  Typography,
  Stack,
  IconButton,
  Chip,
  Divider,
  alpha,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Edit as EditIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import CategoryIcon from '@renderer/features/breakdown/components/CategoryIcon';
import { FREQUENCY_LABELS } from '@renderer/types/subscriptions';
import type { Subscription } from '@renderer/types/subscriptions';
import type { CalendarSubscriptionEntry } from '../utils/subscription-calendar-helpers';

interface CalendarDayDetailProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  date: Date | null;
  subscriptions: CalendarSubscriptionEntry[];
  onClose: () => void;
  onEdit: (subscription: Subscription) => void;
}

const CalendarDayDetail: React.FC<CalendarDayDetailProps> = ({
  open,
  anchorEl,
  date,
  subscriptions,
  onClose,
  onEdit,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { formatCurrency } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions.calendar' });

  if (!date) return null;

  const dayTotal = subscriptions.reduce((sum, e) => sum + e.amount, 0);
  const formattedDate = format(date, 'EEEE, MMMM d, yyyy');

  const content = (
    <Box sx={{ p: 2, minWidth: isMobile ? 'auto' : 280, maxWidth: 360 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Typography variant="subtitle2" fontWeight={700}>
          {formattedDate}
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Divider sx={{ mb: 1.5 }} />

      {/* Subscription list */}
      <Stack spacing={1}>
        {subscriptions.map((entry, i) => {
          const sub = entry.subscription;
          const freq = sub.user_frequency || sub.detected_frequency;
          return (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.background.paper, 0.6),
                border: '1px solid',
                borderColor: alpha(theme.palette.divider, 0.08),
              }}
            >
              {/* Category icon */}
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(sub.category_color || theme.palette.primary.main, 0.12),
                  flexShrink: 0,
                }}
              >
                <CategoryIcon
                  iconName={sub.category_icon || 'payments'}
                  size={18}
                  color={sub.category_color || theme.palette.primary.main}
                />
              </Box>

              {/* Name + frequency */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {sub.display_name}
                </Typography>
                <Chip
                  label={FREQUENCY_LABELS[freq]}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.6rem',
                    mt: 0.25,
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                  }}
                />
              </Box>

              {/* Amount */}
              <Typography variant="body2" fontWeight={700} sx={{ flexShrink: 0 }}>
                {formatCurrency(entry.amount)}
              </Typography>

              {/* Edit button */}
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(sub);
                  onClose();
                }}
                sx={{ flexShrink: 0 }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Box>
          );
        })}
      </Stack>

      {/* Daily total */}
      {subscriptions.length > 1 && (
        <>
          <Divider sx={{ mt: 1.5, mb: 1 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              {t('dayDetail.total')}
            </Typography>
            <Typography variant="subtitle2" fontWeight={700}>
              {formatCurrency(dayTotal)}
            </Typography>
          </Stack>
        </>
      )}
    </Box>
  );

  // Mobile: bottom drawer. Desktop: popover
  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '60vh',
          },
        }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.12)}`,
            border: '1px solid',
            borderColor: alpha(theme.palette.divider, 0.1),
            backdropFilter: 'blur(20px)',
            bgcolor: alpha(theme.palette.background.paper, 0.95),
          },
        },
      }}
    >
      {content}
    </Popover>
  );
};

export default CalendarDayDetail;
