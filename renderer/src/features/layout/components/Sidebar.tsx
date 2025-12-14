import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Box,
  useTheme,
  useMediaQuery,
  Typography,
  Divider,
  Button,
  Tooltip,
  Badge,
  CircularProgress,
  Popover,
} from '@mui/material';
import {
  Home as HomeIcon,
  TrendingUp as AnalysisIcon,
  ShowChart as InvestmentIcon,
  Settings as SettingsIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  Add as AddIcon,
  Sync as SyncIcon,
  Category as CategoryIcon,
  AccountBalance as AccountIcon,
  Storage as StorageIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  WarningAmber as WarningAmberIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import AccountsModal from '@renderer/shared/modals/AccountsModal';
import ScrapeModal from '@renderer/shared/modals/ScrapeModal';
import CategoryHierarchyModal from '@renderer/shared/modals/CategoryHierarchyModal';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import { STALE_SYNC_THRESHOLD_MS } from '@app/utils/constants';
import { apiClient } from '@/lib/api-client';
import { useScrapeProgress } from '@/hooks/useScrapeProgress';

const DRAWER_WIDTH = 260;
const DRAWER_WIDTH_COLLAPSED = 65;

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  onDataRefresh?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange, onDataRefresh }) => {
  const [open, setOpen] = useState(true);
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [scrapeModalOpen, setScrapeModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  interface AccountSyncStatus {
    id: string;
    vendor: string;
    nickname: string | null;
    lastSync: Date | null;
    status: 'green' | 'orange' | 'red' | 'never';
  }

  const [stats, setStats] = useState({
    totalAccounts: 0,
    lastSync: null as Date | null,
    dbStatus: 'checking' as 'connected' | 'disconnected' | 'checking',
  });
  const [accountSyncStatuses, setAccountSyncStatuses] = useState<AccountSyncStatus[]>([]);
  const [accountAlerts, setAccountAlerts] = useState({
    noBank: false,
    noCredit: false,
    noPension: false
  });
  const [uncategorizedCount, setUncategorizedCount] = useState<number>(0);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [syncPopoverAnchor, setSyncPopoverAnchor] = useState<HTMLElement | null>(null);
  const { showNotification } = useNotification();
  const { getPageAccessStatus } = useOnboarding();
  const { t } = useTranslation('translation', { keyPrefix: 'sidebar' });
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { latestEvent: scrapeEvent } = useScrapeProgress();

  const menuItems = useMemo(
    () => [
      { id: 'home', label: t('menu.overview'), icon: <HomeIcon /> },
      { id: 'analysis', label: t('menu.analysis'), icon: <AnalysisIcon /> },
      { id: 'investments', label: t('menu.investments'), icon: <InvestmentIcon /> },
      { id: 'settings', label: t('menu.settings'), icon: <SettingsIcon /> },
    ],
    [t],
  );

  const getAccountSyncStatus = (lastSyncDate: Date | null): 'green' | 'orange' | 'red' | 'never' => {
    if (!lastSyncDate) return 'never';
    const now = Date.now();
    const diffMs = now - lastSyncDate.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 24) return 'green'; // < 24 hours
    if (diffHours < 48) return 'orange'; // 1-2 days
    return 'red'; // > 2 days
  };

  const fetchStats = useCallback(async () => {
    try {
      const accountsRes = await apiClient.get('/api/credentials');
      const accountsData = accountsRes.ok ? (accountsRes.data as any) : [];
      const accounts = Array.isArray(accountsData) ? accountsData : accountsData?.items ?? [];

      // Process accounts with sync status
      const accountStatuses: AccountSyncStatus[] = accounts.map((account: any) => {
        const lastSyncDate = account.lastUpdate ? new Date(account.lastUpdate) : null;
        return {
          id: account.id,
          vendor: account.vendor,
          nickname: account.nickname,
          lastSync: lastSyncDate,
          status: getAccountSyncStatus(lastSyncDate),
        };
      });

      // Find the oldest (farthest) sync time
      const oldestSync = accountStatuses.reduce<Date | null>((oldest, account) => {
        if (!account.lastSync) return oldest;
        if (!oldest || account.lastSync < oldest) return account.lastSync;
        return oldest;
      }, null);

      setAccountSyncStatuses(accountStatuses);
      setStats(prev => ({
        ...prev,
        totalAccounts: accounts.length || 0,
        lastSync: oldestSync,
      }));
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, []);

  const checkDBStatus = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/ping');
      setStats(prev => ({
        ...prev,
        dbStatus: response.ok ? 'connected' : 'disconnected',
      }));
    } catch {
      setStats(prev => ({ ...prev, dbStatus: 'disconnected' }));
    }
  }, []);

  const fetchAccountStatus = useCallback(async () => {
    try {
      const credsResponse = await apiClient.get('/api/credentials');
      const credentialsData = credsResponse.ok ? (credsResponse.data as any) : [];
      const credentials = Array.isArray(credentialsData) ? credentialsData : credentialsData?.items ?? [];

      const hasBank = credentials.some((cred: any) => cred?.institution?.institution_type === 'bank');
      const hasCredit = credentials.some((cred: any) => cred?.institution?.institution_type === 'credit_card');

      const missingInstitution = credentials.filter((cred: any) => !cred.institution_id);
      if (missingInstitution.length > 0) {
        console.warn(
          `[Sidebar] ${missingInstitution.length} credential(s) missing institution_id. Vendors:`,
          missingInstitution.map((cred: any) => cred.vendor),
        );
      }

      // Fetch investment accounts for pension check
      const investResponse = await apiClient.get('/api/investments/accounts');
      const investData = investResponse.ok ? (investResponse.data as any) : { accounts: [] };
      const investAccounts = Array.isArray(investData?.accounts) ? investData.accounts : [];

      const PENSION_TYPES = new Set(['pension', 'provident', 'study_fund']);
      const hasPension = investAccounts.some((acc: any) => PENSION_TYPES.has(acc.account_type));

      setAccountAlerts({
        noBank: !hasBank,
        noCredit: !hasCredit,
        noPension: !hasPension
      });

      console.log('[Sidebar] Account alerts:', { noBank: !hasBank, noCredit: !hasCredit, noPension: !hasPension });
    } catch (error) {
      console.error('Error fetching account status:', error);
    }
  }, []);

  const fetchUncategorizedCount = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/categories/hierarchy');
      if (response.ok) {
        const data = response.data as any;
        const totalUncategorized = data.uncategorized?.totalCount || 0;
        setUncategorizedCount(totalUncategorized);
        console.log('[Sidebar] Uncategorized count:', totalUncategorized);
      }
    } catch (error) {
      console.error('Error fetching uncategorized count:', error);
    }
  }, []);

  const handleScrapeComplete = useCallback(() => {
    fetchStats();
    fetchAccountStatus();
    fetchUncategorizedCount();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dataRefresh'));
    }
    onDataRefresh?.();
  }, [fetchStats, fetchAccountStatus, fetchUncategorizedCount, onDataRefresh]);

  useEffect(() => {
    if (!scrapeEvent || !scrapeEvent.status) {
      return;
    }

    if (scrapeEvent.status === 'starting' || scrapeEvent.status === 'in_progress') {
      setIsBulkSyncing(true);
      return;
    }

    if (scrapeEvent.status === 'completed') {
      setIsBulkSyncing(false);
      handleScrapeComplete();
      return;
    }

    if (scrapeEvent.status === 'failed') {
      setIsBulkSyncing(false);
    }
  }, [scrapeEvent, handleScrapeComplete]);

  const handleBulkRefresh = async () => {
    setIsBulkSyncing(true);
    const hasScrapeBridge =
      typeof window !== 'undefined' &&
      Boolean(window.electronAPI?.events?.onScrapeProgress);
    try {
      const response = await apiClient.post('/api/scrape/bulk', {});
      if (!response.ok) {
        throw new Error(response.statusText || 'Bulk sync failed');
      }
      const result = (response.data as any) ?? {};
      
      if (result.success) {
        const message = result.totalProcessed === 0 
          ? 'All accounts are up to date'
          : `Synced ${result.successCount}/${result.totalProcessed} accounts (${result.totalTransactions || 0} transactions)`;
        
        showNotification(
          message,
          result.successCount === result.totalProcessed ? 'success' : 'warning'
        );

        if (!hasScrapeBridge) {
          handleScrapeComplete();
        }
      } else {
        showNotification(result.message || 'Bulk sync failed', 'error');
      }
    } catch (error) {
      console.error('Bulk sync error:', error);
      showNotification('Bulk sync failed', 'error');
      setIsBulkSyncing(false);
    } finally {
      if (!hasScrapeBridge) {
        setIsBulkSyncing(false);
      }
    }
  };

  useEffect(() => {
    fetchStats();
    checkDBStatus();
    fetchAccountStatus();
    fetchUncategorizedCount();
    const interval = setInterval(checkDBStatus, 30000); // Check DB every 30s

    // Listen for onboarding custom events
    const handleOpenProfile = () => {
      // Navigate to settings page where profile setup should be
      onPageChange('settings');
    };

    const handleOpenAccounts = () => {
      setAccountsModalOpen(true);
    };

    const handleOpenScrape = () => {
      setScrapeModalOpen(true);
    };

    // Listen for data refresh events to update badges
    const handleDataRefresh = () => {
      fetchStats();
      fetchAccountStatus();
      fetchUncategorizedCount();
    };

    globalThis.addEventListener('openProfileSetup', handleOpenProfile);
    globalThis.addEventListener('openAccountsModal', handleOpenAccounts);
    globalThis.addEventListener('openScrapeModal', handleOpenScrape);
    globalThis.addEventListener('dataRefresh', handleDataRefresh);

    return () => {
      clearInterval(interval);
      globalThis.removeEventListener('openProfileSetup', handleOpenProfile);
      globalThis.removeEventListener('openAccountsModal', handleOpenAccounts);
      globalThis.removeEventListener('openScrapeModal', handleOpenScrape);
      globalThis.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, [fetchStats, checkDBStatus, fetchAccountStatus, fetchUncategorizedCount, onPageChange]);

  const handleSyncIconClick = () => {
    const isSyncStale = stats.lastSync && (Date.now() - stats.lastSync.getTime()) > STALE_SYNC_THRESHOLD_MS;
    
    if (isSyncStale && !isBulkSyncing) {
      // If sync is stale, trigger bulk refresh
      handleBulkRefresh();
    } else {
      // Otherwise, open accounts modal
      setAccountsModalOpen(true);
    }
  };

  const handleDrawerToggle = () => {
    setOpen(!open);
  };

  const formatLastSync = () => {
    if (!stats.lastSync) return t('sync.never');
    const now = new Date();
    const diff = now.getTime() - stats.lastSync.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return t('sync.daysAgo', { count: days });
    if (hours > 0) return t('sync.hoursAgo', { count: hours });
    if (minutes > 0) return t('sync.minutesAgo', { count: minutes });
    return t('sync.justNow');
  };

  const formatAccountLastSync = (lastSync: Date | null) => {
    if (!lastSync) return t('accountSync.neverSynced');
    const now = new Date();
    const diff = now.getTime() - lastSync.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 1) return t('sync.daysAgo', { count: days });
    if (days === 1) return t('sync.yesterday');
    if (hours > 0) return t('sync.hoursAgo', { count: hours });
    if (minutes > 0) return t('sync.minutesAgo', { count: minutes });
    return t('sync.justNow');
  };

  const getStatusColor = (status: 'green' | 'orange' | 'red' | 'never') => {
    switch (status) {
      case 'green':
        return theme.palette.success.main;
      case 'orange':
        return theme.palette.warning.main;
      case 'red':
        return theme.palette.error.main;
      case 'never':
        return theme.palette.text.disabled;
    }
  };

  const handleSyncPopoverOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSyncPopoverAnchor(event.currentTarget);
  };

  const handleSyncPopoverClose = () => {
    setSyncPopoverAnchor(null);
  };

  const handleRefreshStaleAccounts = () => {
    handleSyncPopoverClose();
    handleBulkRefresh();
  };

  const staleAccounts = accountSyncStatuses.filter(
    (account) => account.status === 'orange' || account.status === 'red'
  );

  const drawerWidth = open ? DRAWER_WIDTH : DRAWER_WIDTH_COLLAPSED;

  return (
    <>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? open : true}
        onClose={handleDrawerToggle}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: open ? 'space-between' : 'center',
            padding: 2,
            minHeight: 64,
          }}
        >
          <IconButton onClick={handleDrawerToggle}>
            {open ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
        </Box>

        {/* Menu Items */}
        <List sx={{ flexGrow: 1 }}>
          {menuItems.map((item) => {
            const accessStatus = getPageAccessStatus(item.id);
            const isLocked = accessStatus.isLocked;

            return (
              <ListItem key={item.id} disablePadding>
                <Tooltip
                  title={isLocked ? accessStatus.reason : ''}
                  placement="right"
                  arrow
                >
                  <ListItemButton
                    selected={currentPage === item.id}
                    onClick={() => onPageChange(item.id)}
                    sx={{
                      minHeight: 48,
                      justifyContent: open ? 'initial' : 'center',
                      px: 2.5,
                      opacity: isLocked ? 0.5 : 1,
                      '&:hover': {
                        opacity: isLocked ? 0.6 : 1,
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        mr: open ? 3 : 'auto',
                        justifyContent: 'center',
                        position: 'relative',
                      }}
                    >
                      {item.icon}
                      {isLocked && (
                        <LockIcon
                          sx={{
                            position: 'absolute',
                            bottom: -4,
                            right: -4,
                            fontSize: 12,
                            color: 'text.secondary',
                          }}
                        />
                      )}
                    </ListItemIcon>
                    {open && <ListItemText primary={item.label} />}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })}
        </List>

        {/* Bottom Section */}
        {open && (
          <>
            <Divider />
            <Box sx={{ p: 2 }}>
              {/* Action Buttons */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                <Badge
                  badgeContent={(accountAlerts.noBank || accountAlerts.noCredit || accountAlerts.noPension) ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : null}
                  color="warning"
                  overlap="circular"
                  anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                >
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => setAccountsModalOpen(true)}
                    fullWidth
                  >
                    {t('actions.addAccount')}
                  </Button>
                </Badge>
                <Badge
                  badgeContent={uncategorizedCount > 0 ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : null}
                  color="warning"
                  overlap="circular"
                  anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                >
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<CategoryIcon />}
                    onClick={() => setCategoryModalOpen(true)}
                    fullWidth
                  >
                    {t('actions.categories')}
                  </Button>
                </Badge>
              </Box>

              {/* Stats */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AccountIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    {t('stats.accounts', { count: stats.totalAccounts })}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    cursor: isBulkSyncing ? 'wait' : 'pointer',
                    '&:hover': {
                      backgroundColor: 'rgba(0, 0, 0, 0.04)',
                      borderRadius: 1,
                    },
                    padding: '4px',
                    borderRadius: 1,
                    transition: 'background-color 0.2s',
                  }}
                  onClick={handleSyncIconClick}
                  onMouseEnter={handleSyncPopoverOpen}
                  onMouseLeave={handleSyncPopoverClose}
                >
                  {isBulkSyncing ? (
                    <CircularProgress size={16} />
                  ) : (
                    <SyncIcon
                      fontSize="small"
                      color={
                        stats.lastSync && (Date.now() - stats.lastSync.getTime()) > STALE_SYNC_THRESHOLD_MS
                          ? 'warning'
                          : 'action'
                      }
                    />
                  )}
                  <Typography
                    variant="caption"
                    color={
                      stats.lastSync && (Date.now() - stats.lastSync.getTime()) > STALE_SYNC_THRESHOLD_MS
                        ? 'warning.main'
                        : 'text.secondary'
                    }
                  >
                    {formatLastSync()}
                  </Typography>
                </Box>
                <Popover
                  open={Boolean(syncPopoverAnchor)}
                  anchorEl={syncPopoverAnchor}
                  onClose={handleSyncPopoverClose}
                  anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                  }}
                  sx={{
                    pointerEvents: 'none',
                  }}
                  slotProps={{
                    paper: {
                      onMouseEnter: () => setSyncPopoverAnchor(syncPopoverAnchor),
                      onMouseLeave: handleSyncPopoverClose,
                      sx: {
                        pointerEvents: 'auto',
                        maxWidth: 320,
                        p: 2,
                      },
                    },
                  }}
                >
                  <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                    {t('popover.title')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    {accountSyncStatuses.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        {t('popover.noAccounts')}
                      </Typography>
                    ) : (
                      accountSyncStatuses.map((account) => (
                        <Box
                          key={account.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 1,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: getStatusColor(account.status),
                                flexShrink: 0,
                              }}
                            />
                            <Typography
                              variant="caption"
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {account.nickname || account.vendor}
                            </Typography>
                          </Box>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ flexShrink: 0, fontSize: '0.7rem' }}
                          >
                            {formatAccountLastSync(account.lastSync)}
                          </Typography>
                        </Box>
                      ))
                    )}
                  </Box>
                  {staleAccounts.length > 0 && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Button
                        variant="contained"
                        size="small"
                        fullWidth
                        startIcon={<SyncIcon />}
                        onClick={handleRefreshStaleAccounts}
                        disabled={isBulkSyncing}
                      >
                        {t('popover.refreshStaleAccounts', { count: staleAccounts.length })}
                      </Button>
                    </>
                  )}
                </Popover>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {stats.dbStatus === 'connected' ? (
                    <>
                      <CheckIcon fontSize="small" color="success" />
                      <Typography variant="caption" color="success.main">
                        {t('dbStatus.connected')}
                      </Typography>
                    </>
                  ) : stats.dbStatus === 'disconnected' ? (
                    <>
                      <ErrorIcon fontSize="small" color="error" />
                      <Typography variant="caption" color="error.main">
                        {t('dbStatus.disconnected')}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <StorageIcon fontSize="small" color="action" />
                      <Typography variant="caption" color="text.secondary">
                        {t('dbStatus.checking')}
                      </Typography>
                    </>
                  )}
                </Box>
              </Box>
            </Box>
          </>
        )}

        {/* Collapsed view icons */}
        {!open && (
          <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
            <Divider sx={{ width: '100%', mb: 1 }} />
            <Tooltip title={t('tooltips.addAccount')} placement="right">
              <IconButton size="small" onClick={() => setAccountsModalOpen(true)}>
                <Badge
                  badgeContent={(accountAlerts.noBank || accountAlerts.noCredit || accountAlerts.noPension) ? <WarningAmberIcon sx={{ fontSize: 10 }} /> : null}
                  color="warning"
                >
                  <AddIcon />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title={t('tooltips.categories')} placement="right">
              <IconButton size="small" onClick={() => setCategoryModalOpen(true)}>
                <Badge
                  badgeContent={uncategorizedCount > 0 ? <WarningAmberIcon sx={{ fontSize: 10 }} /> : null}
                  color="warning"
                >
                  <CategoryIcon />
                </Badge>
              </IconButton>
            </Tooltip>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%',
                      backgroundColor: stats.dbStatus === 'connected' ? 'success.main' : 'error.main',
                      mt: 1
            }} />
          </Box>
        )}
      </Drawer>

      {/* Mobile menu button */}
      {isMobile && !open && (
        <IconButton
          sx={{
            position: 'fixed',
            top: 16,
            left: 16,
            zIndex: theme.zIndex.drawer + 1,
          }}
          onClick={handleDrawerToggle}
        >
          <MenuIcon />
        </IconButton>
      )}

      {/* Modals */}
      <AccountsModal
        isOpen={accountsModalOpen}
        onClose={() => {
          setAccountsModalOpen(false);
          fetchStats();
          fetchAccountStatus();
        }}
      />

      <ScrapeModal
        isOpen={scrapeModalOpen}
        onClose={() => setScrapeModalOpen(false)}
        onSuccess={handleScrapeComplete}
      />

      <CategoryHierarchyModal
        open={categoryModalOpen}
        onClose={() => {
          setCategoryModalOpen(false);
          fetchUncategorizedCount();
        }}
        onCategoriesUpdated={handleScrapeComplete}
      />
    </>
  );
};

export default Sidebar;
