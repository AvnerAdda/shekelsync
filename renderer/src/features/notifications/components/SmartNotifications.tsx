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
} from '@mui/icons-material';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import { useNotification } from '../NotificationContext';
import { apiClient } from '@/lib/api-client';
import InsightsPanel from './InsightsPanel';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';

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

const SmartNotifications: React.FC = () => {
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
  const { showNotification } = useNotification();

  const open = Boolean(anchorEl);
  const INSIGHTS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
        setNotifications(Array.isArray(data.data?.notifications) ? data.data.notifications : []);
        setSummary(data.data?.summary ?? null);
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
        console.log('Using cached insights data');
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
      case 'view_category':
        // Navigate to category view
        console.log('Navigate to category:', params?.category_definition_id || params?.category);
        break;
      case 'edit_budget':
        // Open budget editing
        console.log('Edit budget for:', params?.category_definition_id || params?.category);
        break;
      case 'view_transaction':
        // Navigate to transaction details
        console.log('View transaction:', params?.id);
        break;
      case 'view_budgets':
        // Navigate to budgets page
        console.log('Navigate to budgets');
        break;
      case 'view_analytics':
        // Navigate to analytics
        console.log('Navigate to analytics');
        break;
      case 'view_uncategorized':
        // Navigate to transactions with uncategorized filter
        window.dispatchEvent(new CustomEvent('navigateToUncategorized'));
        console.log('Navigate to uncategorized transactions');
        break;
      default:
        console.log('Unknown action:', action, params);
    }
    handleClose();
  };

  const criticalCount = summary?.by_severity?.critical || 0;
  const warningCount = summary?.by_severity?.warning || 0;
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
              {summary && (
                <Box sx={{ mb: 2 }}>
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
                    {summary.by_severity.info > 0 && (
                      <Chip
                        size="small"
                        icon={<InfoIcon />}
                        label={`${summary.by_severity.info} Info`}
                        color="info"
                        variant="outlined"
                      />
                    )}
                  </Stack>
                </Box>
              )}

              {notifications.length === 0 ? (
            <Alert severity="success" sx={{ textAlign: 'center' }}>
              <Typography variant="body2">
                🎉 All good! No alerts at the moment.
              </Typography>
            </Alert>
          ) : (
            <List sx={{ maxHeight: 400, overflow: 'auto', p: 0 }}>
              {notifications.map((notification, index) => (
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
                  {index < notifications.length - 1 && <Divider />}
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

      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </>
  );
};

export default SmartNotifications;
