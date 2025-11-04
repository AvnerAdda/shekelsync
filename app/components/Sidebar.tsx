import React, { useCallback, useEffect, useState } from 'react';
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
} from '@mui/material';
import {
  Home as HomeIcon,
  TrendingUp as AnalysisIcon,
  ShowChart as InvestmentIcon,
  AccountBalanceWallet as BudgetIcon,
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
import AccountsModal from './AccountsModal';
import ScrapeModal from './ScrapeModal';
import CategoryHierarchyModal from './CategoryHierarchyModal';
import { useNotification } from './NotificationContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { STALE_SYNC_THRESHOLD_MS } from '../utils/constants';
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
  const [stats, setStats] = useState({
    totalAccounts: 0,
    lastSync: null as Date | null,
    dbStatus: 'checking' as 'connected' | 'disconnected' | 'checking',
  });
  const [accountAlerts, setAccountAlerts] = useState({
    noBank: false,
    noCredit: false,
    noPension: false
  });
  const [uncategorizedCount, setUncategorizedCount] = useState<number>(0);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const { showNotification } = useNotification();
  const { getPageAccessStatus } = useOnboarding();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { latestEvent: scrapeEvent } = useScrapeProgress();

  const menuItems = [
    { id: 'home', label: 'Home', icon: <HomeIcon /> },
    { id: 'analysis', label: 'Analysis', icon: <AnalysisIcon /> },
    { id: 'investments', label: 'Investments', icon: <InvestmentIcon /> },
    { id: 'budgets', label: 'Budgets', icon: <BudgetIcon /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
  ];

  const fetchStats = useCallback(async () => {
    try {
      const accountsRes = await apiClient.get('/api/credentials');
      const accountsData = accountsRes.ok ? (accountsRes.data as any) : [];
      const accounts = Array.isArray(accountsData) ? accountsData : accountsData?.items ?? [];

      const scrapeRes = await apiClient.get('/api/scrape_events?limit=1');
      const scrapeData = scrapeRes.ok ? (scrapeRes.data as any) : [];
      const scrapeEvents = Array.isArray(scrapeData) ? scrapeData : [];

      setStats(prev => ({
        ...prev,
        totalAccounts: accounts.length || 0,
        lastSync: scrapeEvents[0]?.created_at ? new Date(scrapeEvents[0].created_at) : null,
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
    } catch (error) {
      setStats(prev => ({ ...prev, dbStatus: 'disconnected' }));
    }
  }, []);

  const fetchAccountStatus = useCallback(async () => {
    try {
      const credsResponse = await apiClient.get('/api/credentials');
      const credentialsData = credsResponse.ok ? (credsResponse.data as any) : [];
      const credentials = Array.isArray(credentialsData) ? credentialsData : credentialsData?.items ?? [];

      // Import vendor constants
      const BANK_VENDORS = new Set(['hapoalim', 'leumi', 'mizrahi', 'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union', 'discount', 'mercantile']);
      const CREDIT_CARD_VENDORS = new Set(['visaCal', 'max', 'isracard', 'amex']);

      const hasBank = credentials.some((cred: any) => BANK_VENDORS.has(cred.vendor));
      const hasCredit = credentials.some((cred: any) => CREDIT_CARD_VENDORS.has(cred.vendor));

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
    if (!stats.lastSync) return 'Never';
    const now = new Date();
    const diff = now.getTime() - stats.lastSync.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

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
                    Add Account
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
                    Categories
                  </Button>
                </Badge>
              </Box>

              {/* Stats */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AccountIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    {stats.totalAccounts} Accounts
                  </Typography>
                </Box>
                <Tooltip 
                  title={
                    isBulkSyncing 
                      ? 'Syncing accounts...' 
                      : (stats.lastSync && (Date.now() - stats.lastSync.getTime()) > STALE_SYNC_THRESHOLD_MS)
                        ? 'Click to sync all stale accounts'
                        : 'Manage accounts'
                  }
                >
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
                </Tooltip>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {stats.dbStatus === 'connected' ? (
                    <>
                      <CheckIcon fontSize="small" color="success" />
                      <Typography variant="caption" color="success.main">
                        DB Connected
                      </Typography>
                    </>
                  ) : stats.dbStatus === 'disconnected' ? (
                    <>
                      <ErrorIcon fontSize="small" color="error" />
                      <Typography variant="caption" color="error.main">
                        DB Disconnected
                      </Typography>
                    </>
                  ) : (
                    <>
                      <StorageIcon fontSize="small" color="action" />
                      <Typography variant="caption" color="text.secondary">
                        Checking...
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
            <Tooltip title="Add Account" placement="right">
              <IconButton size="small" onClick={() => setAccountsModalOpen(true)}>
                <Badge
                  badgeContent={(accountAlerts.noBank || accountAlerts.noCredit || accountAlerts.noPension) ? <WarningAmberIcon sx={{ fontSize: 10 }} /> : null}
                  color="warning"
                >
                  <AddIcon />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="Categories" placement="right">
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
