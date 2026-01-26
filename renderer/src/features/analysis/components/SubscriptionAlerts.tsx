import React, { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  IconButton,
  Chip,
  Tooltip,
  Skeleton,
  Collapse,
  Button,
  alpha,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  TrendingUp as PriceIncreaseIcon,
  TrendingDown as PriceDecreaseIcon,
  Warning as MissedIcon,
  ContentCopy as DuplicateIcon,
  NotInterested as UnusedIcon,
  Event as RenewalIcon,
  Error as CancelledChargingIcon,
  Close as DismissIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  KeyboardArrowDown as ShowMoreIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import type { SubscriptionAlert, AlertType } from '@renderer/types/subscriptions';
import { ALERT_SEVERITY_COLORS } from '@renderer/types/subscriptions';

const MAX_VISIBLE_ALERTS = 5;
const SCROLL_HEIGHT = 320;

interface SubscriptionAlertsProps {
  alerts: SubscriptionAlert[];
  loading: boolean;
  onDismiss: (alertId: number) => void;
}

const getAlertIcon = (type: AlertType) => {
  switch (type) {
    case 'price_increase':
      return <PriceIncreaseIcon fontSize="small" />;
    case 'price_decrease':
      return <PriceDecreaseIcon fontSize="small" />;
    case 'missed_charge':
      return <MissedIcon fontSize="small" />;
    case 'duplicate':
      return <DuplicateIcon fontSize="small" />;
    case 'unused':
      return <UnusedIcon fontSize="small" />;
    case 'upcoming_renewal':
      return <RenewalIcon fontSize="small" />;
    case 'cancelled_still_charging':
      return <CancelledChargingIcon fontSize="small" />;
    default:
      return <MissedIcon fontSize="small" />;
  }
};

const SubscriptionAlerts: React.FC<SubscriptionAlertsProps> = ({
  alerts,
  loading,
  onDismiss,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions' });
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Use 2 columns on larger screens
  const isLargeScreen = useMediaQuery(theme.breakpoints.up('md'));
  const useColumns = isLargeScreen && alerts.length > 2;

  const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
  const warningAlerts = alerts.filter((a) => a.severity === 'warning');
  const infoAlerts = alerts.filter((a) => a.severity === 'info');

  // Sort alerts by severity (critical first, then warning, then info)
  const sortedAlerts = useMemo(() => {
    return [...alerts].sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }, [alerts]);

  const visibleAlerts = showAll ? sortedAlerts : sortedAlerts.slice(0, MAX_VISIBLE_ALERTS);
  const hasMore = alerts.length > MAX_VISIBLE_ALERTS;

  if (loading && alerts.length === 0) {
    return (
      <Card
        elevation={0}
        sx={{
          mb: 3,
          borderRadius: 3,
          bgcolor: alpha(theme.palette.background.paper, 0.4),
        }}
      >
        <CardContent>
          <Skeleton variant="text" width={200} height={28} sx={{ mb: 2 }} />
          <Stack spacing={1}>
            {[1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={60} />
            ))}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0) {
    return null;
  }

  const renderAlert = (alert: SubscriptionAlert, idx: number) => {
    const severityColor = ALERT_SEVERITY_COLORS[alert.severity];

    return (
      <Box
        key={alert.id || `alert-${idx}`}
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: alpha(severityColor, 0.05),
          border: '1px solid',
          borderColor: alpha(severityColor, 0.2),
          transition: 'all 0.2s',
          '&:hover': {
            bgcolor: alpha(severityColor, 0.08),
          },
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          {/* Icon */}
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1,
              bgcolor: alpha(severityColor, 0.1),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: severityColor,
              flexShrink: 0,
            }}
          >
            {getAlertIcon(alert.alert_type)}
          </Box>

          {/* Content */}
          <Box flex={1} minWidth={0}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <Box minWidth={0}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {alert.subscription_name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {alert.title}
                </Typography>
              </Box>

              {/* Price change info */}
              {alert.old_amount != null && alert.new_amount != null && (
                <Box textAlign="right" flexShrink={0}>
                  <Typography
                    variant="caption"
                    color={alert.alert_type === 'price_increase' ? 'error.main' : 'success.main'}
                    fontWeight={600}
                  >
                    {formatCurrency(alert.old_amount)} → {formatCurrency(alert.new_amount)}
                  </Typography>
                  {alert.percentage_change != null && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {alert.percentage_change > 0 ? '+' : ''}
                      {alert.percentage_change.toFixed(1)}%
                    </Typography>
                  )}
                </Box>
              )}
            </Stack>
          </Box>

          {/* Dismiss button */}
          {alert.id && (
            <Tooltip title={t('alerts.dismiss')}>
              <IconButton
                size="small"
                onClick={() => onDismiss(alert.id!)}
                sx={{
                  flexShrink: 0,
                  opacity: 0.6,
                  '&:hover': { opacity: 1 },
                }}
              >
                <DismissIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Box>
    );
  };

  return (
    <Card
      elevation={0}
      sx={{
        mb: 3,
        borderRadius: 3,
        bgcolor: alpha(theme.palette.background.paper, 0.4),
        backdropFilter: 'blur(12px)',
        border: '1px solid',
        borderColor: alpha(
          criticalAlerts.length > 0
            ? theme.palette.error.main
            : warningAlerts.length > 0
            ? theme.palette.warning.main
            : theme.palette.info.main,
          0.3
        ),
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        {/* Header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          onClick={() => setExpanded(!expanded)}
          sx={{ cursor: 'pointer', mb: expanded ? 2 : 0 }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="subtitle1" fontWeight="bold">
              {t('alerts.title')}
            </Typography>
            {criticalAlerts.length > 0 && (
              <Chip
                label={criticalAlerts.length}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  bgcolor: alpha(ALERT_SEVERITY_COLORS.critical, 0.1),
                  color: ALERT_SEVERITY_COLORS.critical,
                  fontWeight: 600,
                }}
              />
            )}
            {warningAlerts.length > 0 && (
              <Chip
                label={warningAlerts.length}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  bgcolor: alpha(ALERT_SEVERITY_COLORS.warning, 0.1),
                  color: ALERT_SEVERITY_COLORS.warning,
                  fontWeight: 600,
                }}
              />
            )}
            {infoAlerts.length > 0 && (
              <Chip
                label={infoAlerts.length}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  bgcolor: alpha(ALERT_SEVERITY_COLORS.info, 0.1),
                  color: ALERT_SEVERITY_COLORS.info,
                  fontWeight: 600,
                }}
              />
            )}
          </Stack>
          <IconButton size="small">
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </IconButton>
        </Stack>

        {/* Alert list */}
        <Collapse in={expanded}>
          <Box
            sx={{
              maxHeight: showAll ? SCROLL_HEIGHT : 'none',
              overflowY: showAll ? 'auto' : 'visible',
              pr: showAll ? 1 : 0,
              '&::-webkit-scrollbar': {
                width: 6,
              },
              '&::-webkit-scrollbar-track': {
                bgcolor: alpha(theme.palette.action.active, 0.05),
                borderRadius: 3,
              },
              '&::-webkit-scrollbar-thumb': {
                bgcolor: alpha(theme.palette.action.active, 0.2),
                borderRadius: 3,
                '&:hover': {
                  bgcolor: alpha(theme.palette.action.active, 0.3),
                },
              },
            }}
          >
            {useColumns ? (
              // Two-column layout for larger screens
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 1.5,
                }}
              >
                {visibleAlerts.map((alert, idx) => renderAlert(alert, idx))}
              </Box>
            ) : (
              // Single column for smaller screens
              <Stack spacing={1.5}>
                {visibleAlerts.map((alert, idx) => renderAlert(alert, idx))}
              </Stack>
            )}
          </Box>

          {/* Show more/less button */}
          {hasMore && (
            <Box sx={{ textAlign: 'center', mt: 2 }}>
              <Button
                size="small"
                onClick={() => setShowAll(!showAll)}
                endIcon={<ShowMoreIcon sx={{ transform: showAll ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
                sx={{
                  textTransform: 'none',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: alpha(theme.palette.action.active, 0.05) },
                }}
              >
                {showAll
                  ? t('alerts.showLess')
                  : t('alerts.showMore', { count: alerts.length - MAX_VISIBLE_ALERTS })}
              </Button>
            </Box>
          )}
        </Collapse>
      </CardContent>
    </Card>
  );
};

export default SubscriptionAlerts;
