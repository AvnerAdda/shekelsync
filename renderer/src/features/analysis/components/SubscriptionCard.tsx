import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  LinearProgress,
  alpha,
  useTheme,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Button,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Pause as PauseIcon,
  PlayArrow as ResumeIcon,
  MoreVert as MoreIcon,
  NotificationsActive as AlertIcon,
  CheckCircle as ApproveIcon,
  VisibilityOff as IgnoreIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import CategoryIcon from '@renderer/features/breakdown/components/CategoryIcon';
import type { Subscription, SubscriptionStatus } from '@renderer/types/subscriptions';
import { STATUS_COLORS, FREQUENCY_LABELS } from '@renderer/types/subscriptions';

interface SubscriptionCardProps {
  subscription: Subscription;
  onEdit: (subscription: Subscription) => void;
  onStatusChange: (id: number, status: SubscriptionStatus) => void;
  onDelete: (id: number) => void;
}

const SubscriptionCard: React.FC<SubscriptionCardProps> = ({
  subscription,
  onEdit,
  onStatusChange,
  onDelete,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions' });
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  const amount = subscription.user_amount || subscription.detected_amount || 0;
  const frequency = subscription.user_frequency || subscription.detected_frequency || 'monthly';
  const statusColor = STATUS_COLORS[subscription.status] || theme.palette.grey[500];
  const isActive = subscription.status === 'active';
  const isReview = subscription.status === 'review';
  const categoryColor = subscription.category_color || theme.palette.primary.main;

  // Calculate days until next charge and progress
  const { daysUntil, progressPercent, isOverdue, nextDateLabel } = useMemo(() => {
    if (!subscription.next_expected_date || !isActive) {
      return { daysUntil: null, progressPercent: 0, isOverdue: false, nextDateLabel: null };
    }

    const nextDate = new Date(subscription.next_expected_date);
    const now = new Date();
    const days = Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Estimate cycle length based on frequency
    const cycleDays: Record<string, number> = {
      daily: 1,
      weekly: 7,
      biweekly: 14,
      monthly: 30,
      bimonthly: 60,
      quarterly: 90,
      yearly: 365,
    };
    const cycleLength = cycleDays[frequency] || 30;

    // Progress is how far we are into the current cycle (inverted: 100% when charge is imminent)
    const elapsed = cycleLength - days;
    const progress = Math.max(0, Math.min(100, (elapsed / cycleLength) * 100));

    // Format the date label
    let label: string;
    if (days < 0) {
      label = t('card.overdue', { days: Math.abs(days) });
    } else if (days === 0) {
      label = t('card.today');
    } else if (days === 1) {
      label = t('card.tomorrow');
    } else if (days <= 7) {
      label = t('card.inDays', { days });
    } else {
      label = nextDate.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
    }

    return {
      daysUntil: days,
      progressPercent: progress,
      isOverdue: days < 0,
      nextDateLabel: label,
    };
  }, [subscription.next_expected_date, frequency, isActive, t, i18n.language]);

  // Determine progress bar color based on urgency
  const progressColor = useMemo(() => {
    if (isOverdue) return theme.palette.error.main;
    if (daysUntil !== null && daysUntil <= 3) return theme.palette.warning.main;
    return categoryColor;
  }, [isOverdue, daysUntil, categoryColor, theme]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handlePauseResume = () => {
    if (subscription.id) {
      onStatusChange(subscription.id, isActive ? 'paused' : 'active');
    }
    handleMenuClose();
  };

  const handleDelete = () => {
    if (subscription.id) {
      onDelete(subscription.id);
    }
    handleMenuClose();
  };

  // Build menu items for overflow menu
  const menuItems = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
      color?: string;
    }> = [];

    if (isActive) {
      items.push({
        key: 'pause',
        label: t('actions.pause'),
        icon: <PauseIcon sx={{ color: theme.palette.warning.main }} />,
        onClick: handlePauseResume,
      });
    } else if (subscription.status === 'paused') {
      items.push({
        key: 'resume',
        label: t('actions.resume'),
        icon: <ResumeIcon sx={{ color: theme.palette.success.main }} />,
        onClick: handlePauseResume,
      });
    }

    if (subscription.is_manual === 1 && subscription.id) {
      items.push({
        key: 'delete',
        label: t('actions.delete'),
        icon: <DeleteIcon sx={{ color: theme.palette.error.main }} />,
        onClick: handleDelete,
        color: theme.palette.error.main,
      });
    }

    return items;
  }, [isActive, subscription.status, subscription.is_manual, subscription.id, t, theme]);

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 3,
        bgcolor: alpha(theme.palette.background.paper, 0.6),
        backdropFilter: 'blur(12px)',
        border: '1px solid',
        borderColor: alpha(theme.palette.divider, 0.1),
        overflow: 'hidden',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: subscription.status === 'cancelled' ? 0.5 : 1,
        '&:hover': {
          bgcolor: alpha(theme.palette.background.paper, 0.8),
          borderColor: alpha(categoryColor, 0.3),
          boxShadow: `0 8px 32px -8px ${alpha(categoryColor, 0.2)}`,
          transform: 'translateY(-2px) scale(1.005)',
        },
        '&:active': {
          transform: 'translateY(0) scale(1)',
        },
        // Touch-friendly: always show actions on touch devices
        '@media (hover: none)': {
          '& .subscription-actions': {
            opacity: 1,
          },
        },
      }}
    >
      {/* Progress bar at top with tooltip */}
      {isActive && subscription.next_expected_date && (
        <Tooltip
          title={t('card.cycleProgress', { percent: Math.round(progressPercent) })}
          placement="top"
          arrow
        >
          <LinearProgress
            variant="determinate"
            value={progressPercent}
            sx={{
              height: 3,
              bgcolor: alpha(progressColor, 0.1),
              cursor: 'help',
              '& .MuiLinearProgress-bar': {
                bgcolor: progressColor,
                transition: 'none',
              },
            }}
          />
        </Tooltip>
      )}

      {/* Left accent border */}
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: isActive && subscription.next_expected_date ? 3 : 0,
          bottom: 0,
          width: 4,
          bgcolor: statusColor,
          borderTopLeftRadius: isActive && subscription.next_expected_date ? 0 : 12,
          borderBottomLeftRadius: 12,
        }}
      />

      <Box sx={{ p: 2, pl: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          {/* Category Icon */}
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2.5,
              background: `linear-gradient(135deg, ${alpha(categoryColor, 0.15)} 0%, ${alpha(categoryColor, 0.05)} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {subscription.category_icon ? (
              <CategoryIcon
                iconName={subscription.category_icon}
                color={categoryColor}
                size={22}
              />
            ) : (
              <Typography
                sx={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: categoryColor,
                }}
              >
                {subscription.display_name?.charAt(0)?.toUpperCase() || '?'}
              </Typography>
            )}
          </Box>

          {/* Main content */}
          <Box flex={1} minWidth={0}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box minWidth={0} flex={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography
                    variant="subtitle2"
                    fontWeight={600}
                    noWrap
                    sx={{ maxWidth: 200 }}
                  >
                    {subscription.display_name}
                  </Typography>
                  {subscription.is_manual === 1 && (
                    <Chip
                      label={t('card.manual')}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        bgcolor: alpha(theme.palette.info.main, 0.1),
                        color: theme.palette.info.main,
                      }}
                    />
                  )}
                  {isOverdue && (
                    <Tooltip title={t('card.overdueTooltip')}>
                      <AlertIcon sx={{ fontSize: 16, color: theme.palette.error.main }} />
                    </Tooltip>
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {subscription.category_name || subscription.parent_category_name}
                </Typography>
              </Box>

              {/* Amount */}
              <Box textAlign="right" flexShrink={0}>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{ color: theme.palette.text.primary }}
                >
                  {formatCurrency(amount, { maximumFractionDigits: 0 })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(`frequency.${frequency}`, { defaultValue: FREQUENCY_LABELS[frequency] })}
                </Typography>
              </Box>
            </Stack>

            {/* Bottom row: status + next date */}
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              mt={1}
              justifyContent="space-between"
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={t(`status.${subscription.status}`)}
                  size="small"
                  sx={{
                    height: 22,
                    bgcolor: alpha(statusColor, 0.1),
                    color: statusColor,
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    borderRadius: 1.5,
                  }}
                />
                {subscription.consistency_score != null && subscription.consistency_score >= 0.7 && (
                  <Tooltip title={t('card.highConsistency')}>
                    <Typography
                      variant="caption"
                      sx={{
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 1,
                        bgcolor: alpha(theme.palette.success.main, 0.1),
                        color: theme.palette.success.main,
                        fontWeight: 600,
                        fontSize: '0.65rem',
                      }}
                    >
                      {Math.round(subscription.consistency_score * 100)}%
                    </Typography>
                  </Tooltip>
                )}
              </Stack>

              {nextDateLabel && isActive && (
                <Typography
                  variant="caption"
                  sx={{
                    color: isOverdue ? theme.palette.error.main : 'text.secondary',
                    fontWeight: isOverdue ? 600 : 400,
                  }}
                >
                  {nextDateLabel}
                </Typography>
              )}
            </Stack>
          </Box>

          {/* Actions - Always visible Edit + Overflow Menu */}
          <Stack
            className="subscription-actions"
            direction="row"
            spacing={0.25}
            sx={{
              flexShrink: 0,
              transition: 'opacity 0.2s',
            }}
          >
            {/* Edit button - always visible */}
            <Tooltip title={t('actions.edit')}>
              <IconButton
                size="small"
                onClick={() => onEdit(subscription)}
                sx={{
                  bgcolor: alpha(theme.palette.action.active, 0.05),
                  '&:hover': { bgcolor: alpha(theme.palette.action.active, 0.1) },
                }}
              >
                <EditIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>

            {/* Overflow menu for secondary actions */}
            {menuItems.length > 0 && (
              <>
                <IconButton
                  size="small"
                  onClick={handleMenuOpen}
                  sx={{
                    bgcolor: alpha(theme.palette.action.active, 0.05),
                    '&:hover': { bgcolor: alpha(theme.palette.action.active, 0.1) },
                  }}
                >
                  <MoreIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <Menu
                  anchorEl={menuAnchor}
                  open={Boolean(menuAnchor)}
                  onClose={handleMenuClose}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  PaperProps={{
                    sx: {
                      minWidth: 160,
                      borderRadius: 2,
                      boxShadow: `0 8px 32px -8px ${alpha(theme.palette.common.black, 0.2)}`,
                    },
                  }}
                >
                  {menuItems.map((item) => (
                    <MenuItem
                      key={item.key}
                      onClick={item.onClick}
                      sx={{
                        color: item.color,
                        '&:hover': {
                          bgcolor: alpha(item.color || theme.palette.action.hover, 0.08),
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                      <ListItemText>{item.label}</ListItemText>
                    </MenuItem>
                  ))}
                </Menu>
              </>
            )}
          </Stack>
        </Stack>

        {/* Review Status Quick Actions */}
        {isReview && subscription.id && (
          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.info.main, 0.05),
              border: '1px solid',
              borderColor: alpha(theme.palette.info.main, 0.15),
            }}
          >
            <Stack direction="row" spacing={1.5}>
              <Button
                variant="contained"
                size="small"
                startIcon={<ApproveIcon />}
                onClick={() => onStatusChange(subscription.id!, 'active')}
                sx={{
                  flex: 1,
                  bgcolor: theme.palette.success.main,
                  '&:hover': { bgcolor: theme.palette.success.dark },
                }}
              >
                {t('actions.approve')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<IgnoreIcon />}
                onClick={() => onStatusChange(subscription.id!, 'keep')}
                sx={{
                  flex: 1,
                  borderColor: alpha(theme.palette.info.main, 0.3),
                  color: theme.palette.info.main,
                  '&:hover': {
                    borderColor: theme.palette.info.main,
                    bgcolor: alpha(theme.palette.info.main, 0.08),
                  },
                }}
              >
                {t('actions.ignore')}
              </Button>
            </Stack>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SubscriptionCard;
