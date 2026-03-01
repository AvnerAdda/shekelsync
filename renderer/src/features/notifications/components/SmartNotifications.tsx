import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Badge,
  IconButton,
  Popover,
  List,
  ListItem,
  Button,
  Chip,
  Divider,
  Alert,
  CircularProgress,
  Tooltip,
  Stack,
  Avatar,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  Warning as WarningIcon,
  Error as CriticalIcon,
  Info as InfoIcon,
  TrendingUp as BudgetIcon,
  ShoppingCart as SpendingIcon,
  Store as VendorIcon,
  MonetizationOn as HighTransactionIcon,
  Timeline as CashFlowIcon,
  CheckCircle as GoalIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
  Sync as SyncIcon,
  Category as CategoryIcon,
  CloudDone as SyncSuccessIcon,
  Lightbulb as LightbulbIcon,
  DoneAll as DoneAllIcon,
  VisibilityOff as DismissIcon,
} from '@mui/icons-material';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import { useNotification } from '../NotificationContext';
import { apiClient } from '@/lib/api-client';
import InsightsPanel from './InsightsPanel';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';
import SnapshotProgressModal, { SnapshotProgressData } from './SnapshotProgressModal';
import { useTranslation } from 'react-i18next';

interface Notification {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  data: any;
  timestamp: string;
  actionable: boolean;
  actions?: Array<{
    label: string;
    action: string;
    params?: any;
  }>;
}

interface NotificationSummary {
  total: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
}

const SNAPSHOT_NOTIFICATION_TYPE = 'snapshot_progress';
const SNAPSHOT_SEEN_STORAGE_KEY = 'smart_alert.snapshot_seen_trigger_key.v1';
const DISMISSED_NOTIFICATIONS_KEY = 'smart_alert.dismissed_ids.v1';

function loadDismissedIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function saveDismissedIds(ids: Set<string>) {
  window.localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify([...ids]));
}

const toISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfWeekSunday = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - result.getDay());
  result.setHours(0, 0, 0, 0);
  return result;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const startOfBiMonth = (date: Date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 2) * 2, 1);

const startOfHalfYear = (date: Date) => new Date(date.getFullYear(), date.getMonth() < 6 ? 0 : 6, 1);

const startOfYear = (date: Date) => new Date(date.getFullYear(), 0, 1);

const computeSnapshotTriggerKey = (now: Date) => {
  const boundaries = [
    startOfWeekSunday(now),
    startOfMonth(now),
    startOfBiMonth(now),
    startOfHalfYear(now),
    startOfYear(now),
  ];

  const latestBoundary = boundaries.reduce((latest, candidate) =>
    candidate.getTime() > latest.getTime() ? candidate : latest
  );

  return toISODate(latestBoundary);
};

const buildNotificationSummary = (
  items: Notification[],
  baseSummary?: NotificationSummary | null,
): NotificationSummary => {
  const byType: Record<string, number> = { ...(baseSummary?.by_type || {}) };
  Object.keys(byType).forEach((key) => {
    byType[key] = 0;
  });

  const bySeverity = {
    critical: 0,
    warning: 0,
    info: 0,
    ...(baseSummary?.by_severity || {}),
  } as Record<string, number>;

  bySeverity.critical = 0;
  bySeverity.warning = 0;
  bySeverity.info = 0;

  items.forEach((item) => {
    byType[item.type] = (byType[item.type] || 0) + 1;
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
  });

  return {
    total: items.length,
    by_type: byType,
    by_severity: bySeverity,
  };
};

const SmartNotifications: React.FC = () => {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'alerts' | 'insights'>('alerts');
  const [insights, setInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsCacheTime, setInsightsCacheTime] = useState<Date | null>(null);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>();
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [snapshotData, setSnapshotData] = useState<SnapshotProgressData | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const { showNotification } = useNotification();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissedIds());

  const open = Boolean(anchorEl);
  const INSIGHTS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  const handleDismissNotification = (id: string) => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      saveDismissedIds(next);
      return next;
    });
  };

  const handleDismissAll = () => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      notifications.forEach(n => next.add(n.id));
      saveDismissedIds(next);
      return next;
    });
  };

  const buildSnapshotAlert = (triggerKey: string, isRead = false): Notification => ({
    id: `snapshot_progress_${triggerKey}`,
    type: SNAPSHOT_NOTIFICATION_TYPE,
    severity: isRead ? 'info' : 'warning',
    title: t('insights.snapshot.alert.title'),
    message: t('insights.snapshot.alert.message'),
    data: {
      triggerKey,
      synthetic: true,
      read: isRead,
    },
    timestamp: new Date().toISOString(),
    actionable: true,
    actions: [
      {
        label: t('insights.snapshot.alert.action'),
        action: 'view_snapshot',
        params: { triggerKey },
      },
    ],
  });

  useEffect(() => {
    fetchNotifications();

    // Set up periodic refresh (every 5 minutes)
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/api/notifications?limit=20');
      const data = response.data as any;

      if (response.ok && data?.success) {
        const baseNotifications = Array.isArray(data.data?.notifications) ? data.data.notifications : [];
        const triggerKey = computeSnapshotTriggerKey(new Date());
        const seenTriggerKey = window.localStorage.getItem(SNAPSHOT_SEEN_STORAGE_KEY);
        const snapshotIsRead = seenTriggerKey === triggerKey;
        const nonSnapshotNotifications = baseNotifications.filter((item: Notification) => item.type !== SNAPSHOT_NOTIFICATION_TYPE);
        const mergedNotifications = [buildSnapshotAlert(triggerKey, snapshotIsRead), ...nonSnapshotNotifications];

        setNotifications(mergedNotifications);
        setSummary(buildNotificationSummary(mergedNotifications, data.data?.summary ?? null));
        setLastFetch(new Date());
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchInsights = async (forceRefresh = false) => {
    // Check if we have cached data and it's still valid
    if (!forceRefresh && insights && insightsCacheTime) {
      const now = new Date();
      const cacheAge = now.getTime() - insightsCacheTime.getTime();
      if (cacheAge < INSIGHTS_CACHE_DURATION) {
        return;
      }
    }

    setInsightsLoading(true);
    try {
      const response = await apiClient.get('/api/insights?period=all');
      const data = response.data as any;

      if (response.ok && data?.success) {
        setInsights(data.data);
        setInsightsCacheTime(new Date());
      }
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
    if (notifications.length === 0) {
      fetchNotifications();
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: 'alerts' | 'insights') => {
    setActiveTab(newValue);
    if (newValue === 'insights' && !insights) {
      fetchInsights();
    }
  };

  const getNotificationIcon = (type: string, severity: string) => {
    const iconProps = {
      fontSize: 'small' as const,
      color: severity === 'critical' ? 'error' as const :
             severity === 'warning' ? 'warning' as const : 'info' as const
    };

    switch (type) {
      case 'budget_warning':
      case 'budget_exceeded':
        return <BudgetIcon {...iconProps} />;
      case 'unusual_spending':
        return <SpendingIcon {...iconProps} />;
      case 'high_transaction':
        return <HighTransactionIcon {...iconProps} />;
      case 'new_vendor':
        return <VendorIcon {...iconProps} />;
      case 'cash_flow_alert':
        return <CashFlowIcon {...iconProps} />;
      case 'snapshot_progress':
        return <CashFlowIcon {...iconProps} />;
      case 'goal_milestone':
        return <GoalIcon {...iconProps} />;
      case 'stale_sync':
        return <SyncIcon {...iconProps} />;
      case 'uncategorized_transactions':
        return <CategoryIcon {...iconProps} />;
      case 'sync_success':
        return <SyncSuccessIcon sx={{ ...iconProps, color: 'success.main' }} />;
      default:
        return severity === 'critical' ? <CriticalIcon {...iconProps} /> :
               severity === 'warning' ? <WarningIcon {...iconProps} /> :
               <InfoIcon {...iconProps} />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'error';
      case 'warning': return 'warning';
      default: return 'info';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (isToday(date)) {
      return `Today ${format(date, 'HH:mm')}`;
    } else if (isYesterday(date)) {
      return `Yesterday ${format(date, 'HH:mm')}`;
    } else {
      return formatDistanceToNow(date, { addSuffix: true });
    }
  };

  const handleNotificationAction = async (action: string, params?: any) => {
    // Handle different notification actions
    switch (action) {
      case 'bulk_refresh':
        // Trigger bulk account refresh
        setIsBulkSyncing(true);
        try {
          const response = await apiClient.post('/api/scrape/bulk', { payload: {} });
          const result = response.data as any;

          if (!response.ok) {
            // Check for license read-only error
            const licenseCheck = isLicenseReadOnlyError(response.data);
            if (licenseCheck.isReadOnly) {
              setLicenseAlertReason(licenseCheck.reason);
              setLicenseAlertOpen(true);
              setIsBulkSyncing(false);
              return;
            }
          }

          if (response.ok && result.success) {
            const message = result.totalProcessed === 0
              ? 'All accounts are up to date'
              : `Synced ${result.successCount}/${result.totalProcessed} accounts (${result.totalTransactions || 0} transactions)`;

            showNotification(
              message,
              result.successCount === result.totalProcessed ? 'success' : 'warning'
            );

            // Refresh notifications to clear the stale sync alert
            await fetchNotifications();

            // Trigger global data refresh
            window.dispatchEvent(new CustomEvent('dataRefresh'));
          } else {
            showNotification(result.message || 'Bulk sync failed', 'error');
          }
        } catch (error) {
          console.error('Bulk sync error:', error);
          showNotification('Bulk sync failed', 'error');
        } finally {
          setIsBulkSyncing(false);
        }
        break;
      case 'view_snapshot': {
        const triggerKey = params?.triggerKey || computeSnapshotTriggerKey(new Date());
        window.localStorage.setItem(SNAPSHOT_SEEN_STORAGE_KEY, triggerKey);
        setNotifications((previous) => {
          const nonSnapshotNotifications = previous.filter((item) => item.type !== SNAPSHOT_NOTIFICATION_TYPE);
          const updated = [buildSnapshotAlert(triggerKey, true), ...nonSnapshotNotifications];
          setSummary((currentSummary) => buildNotificationSummary(updated, currentSummary));
          return updated;
        });

        setSnapshotModalOpen(true);
        setSnapshotLoading(true);
        setSnapshotError(null);
        setSnapshotData(null);

        try {
          const response = await apiClient.get('/api/notifications/snapshot-progress');
          const payload = response.data as any;

          if (response.ok && payload?.success) {
            setSnapshotData(payload.data as SnapshotProgressData);
          } else {
            setSnapshotError(payload?.error || t('insights.snapshot.modal.fetchError'));
          }
        } catch (error) {
          console.error('Snapshot fetch error:', error);
          setSnapshotError(t('insights.snapshot.modal.fetchError'));
        } finally {
          setSnapshotLoading(false);
        }
        break;
      }
      case 'view_category':
        break;
      case 'edit_budget':
        break;
      case 'view_transaction':
        break;
      case 'view_budgets':
        break;
      case 'view_analytics':
        break;
      case 'view_uncategorized':
        window.dispatchEvent(new CustomEvent('navigateToUncategorized'));
        break;
      default:
        break;
    }
    handleClose();
  };

  const visibleNotifications = notifications.filter(n => !dismissedIds.has(n.id));
  const visibleSummary = buildNotificationSummary(visibleNotifications, null);
  const criticalCount = visibleSummary.by_severity?.critical || 0;
  const warningCount = visibleSummary.by_severity?.warning || 0;
  const totalAlerts = criticalCount + warningCount;

  return (
    <>
      <Tooltip title="Smart Alerts">
        <IconButton
          color="inherit"
          onClick={handleClick}
          sx={{
            color: totalAlerts > 0 ? 'warning.main' : 'inherit',
            '&:hover': {
              backgroundColor: 'action.hover',
            }
          }}
        >
          <Badge badgeContent={totalAlerts} color="error" max={99}>
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: { width: 400, maxHeight: 600 }
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              {activeTab === 'alerts' ? 'Smart Alerts' : 'Financial Insights'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Refresh">
                <IconButton
                  size="small"
                  onClick={activeTab === 'alerts' ? fetchNotifications : () => fetchInsights(true)}
                  disabled={activeTab === 'alerts' ? loading : insightsLoading}
                >
                  {(activeTab === 'alerts' ? loading : insightsLoading) ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
              <IconButton size="small" onClick={handleClose}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            variant="fullWidth"
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab
              icon={<NotificationsIcon fontSize="small" />}
              iconPosition="start"
              label="Alerts"
              value="alerts"
            />
            <Tab
              icon={<LightbulbIcon fontSize="small" />}
              iconPosition="start"
              label="Insights"
              value="insights"
            />
          </Tabs>

          {activeTab === 'alerts' && (
            <>
              {visibleSummary && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Stack direction="row" spacing={1}>
                    {criticalCount > 0 && (
                      <Chip
                        size="small"
                        icon={<CriticalIcon />}
                        label={`${criticalCount} Critical`}
                        color="error"
                        variant="outlined"
                      />
                    )}
                    {warningCount > 0 && (
                      <Chip
                        size="small"
                        icon={<WarningIcon />}
                        label={`${warningCount} Warning`}
                        color="warning"
                        variant="outlined"
                      />
                    )}
                    {(visibleSummary.by_severity.info || 0) > 0 && (
                      <Chip
                        size="small"
                        icon={<InfoIcon />}
                        label={`${visibleSummary.by_severity.info} Info`}
                        color="info"
                        variant="outlined"
                      />
                    )}
                  </Stack>
                  {visibleNotifications.length > 0 && (
                    <Tooltip title={t('smartNotifications.dismissAll', 'Dismiss all')}>
                      <IconButton size="small" onClick={handleDismissAll}>
                        <DoneAllIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              )}

              {visibleNotifications.length === 0 ? (
            <Alert severity="success" sx={{ textAlign: 'center' }}>
              <Typography variant="body2">
                {t('smartNotifications.allGood', 'All good! No alerts at the moment.')}
              </Typography>
            </Alert>
          ) : (
            <List sx={{ maxHeight: 400, overflow: 'auto', p: 0 }}>
              {visibleNotifications.map((notification, index) => (
                <React.Fragment key={notification.id}>
                  <ListItem
                    sx={{
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      p: 2,
                      bgcolor: notification.severity === 'critical' ? 'error.light' :
                               notification.severity === 'warning' ? 'warning.light' :
                               'transparent',
                      borderRadius: 1,
                      mb: 1
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 1 }}>
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          bgcolor: `${getSeverityColor(notification.severity)}.main`
                        }}
                      >
                        {getNotificationIcon(notification.type, notification.severity)}
                      </Avatar>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          {notification.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {notification.message}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          {formatTimestamp(notification.timestamp)}
                        </Typography>
                      </Box>

                      <Tooltip title={t('smartNotifications.dismiss', 'Dismiss')}>
                        <IconButton
                          size="small"
                          onClick={() => handleDismissNotification(notification.id)}
                          sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}
                        >
                          <DismissIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>

                    {notification.actionable && notification.actions && (
                      <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                        {notification.actions.map((action, actionIndex) => (
                          <Button
                            key={actionIndex}
                            size="small"
                            variant="outlined"
                            onClick={() => handleNotificationAction(action.action, action.params)}
                            disabled={isBulkSyncing && action.action === 'bulk_refresh'}
                            startIcon={isBulkSyncing && action.action === 'bulk_refresh' ? <CircularProgress size={12} /> : null}
                            sx={{ fontSize: '0.75rem' }}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </Box>
                    )}
                  </ListItem>
                  {index < visibleNotifications.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
              )}

              {lastFetch && (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', mt: 2 }}>
                  Last updated: {formatDistanceToNow(lastFetch, { addSuffix: true })}
                </Typography>
              )}
            </>
          )}

          {activeTab === 'insights' && (
            <Box>
              {insightsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
                  <CircularProgress />
                </Box>
              ) : insights ? (
                <InsightsPanel insights={insights} onClose={handleClose} />
              ) : (
                <Alert severity="info">
                  <Typography variant="body2">
                    Click refresh to load your financial insights.
                  </Typography>
                </Alert>
              )}
            </Box>
          )}
        </Box>
      </Popover>

      <SnapshotProgressModal
        open={snapshotModalOpen}
        onClose={() => setSnapshotModalOpen(false)}
        data={snapshotData}
        loading={snapshotLoading}
        error={snapshotError}
      />

      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </>
  );
};

export default SmartNotifications;
