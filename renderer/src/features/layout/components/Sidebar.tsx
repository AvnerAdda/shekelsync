import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import AccountIcon from '@mui/icons-material/AccountBalance';
import AddIcon from '@mui/icons-material/Add';
import CategoryIcon from '@mui/icons-material/Category';
import CheckIcon from '@mui/icons-material/CheckCircle';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ErrorIcon from '@mui/icons-material/Error';
import HomeIcon from '@mui/icons-material/Home';
import InvestmentIcon from '@mui/icons-material/ShowChart';
import LockIcon from '@mui/icons-material/Lock';
import MenuIcon from '@mui/icons-material/Menu';
import ActivityIcon from '@mui/icons-material/ReceiptLong';
import PlanIcon from '@mui/icons-material/TrendingUp';
import ReviewIcon from '@mui/icons-material/AssignmentTurnedIn';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import SyncIcon from '@mui/icons-material/Sync';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';
import type { AccountsModalOpenRequest } from '@renderer/shared/modals/AccountsModal';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import { STALE_SYNC_THRESHOLD_MS } from '@app/utils/constants';
import { apiClient } from '@/lib/api-client';
import { useScrapeProgress } from '@/hooks/useScrapeProgress';
import { useCurrentMonthPairingGap } from '@renderer/shared/hooks/useCurrentMonthPairingGap';
import {
  formatSidebarAccountLastSync,
  formatSidebarLastSync,
  getAccountSyncStatus,
  type AccountSyncStatusColor,
} from './sidebar-helpers';
import { resolveOnboardingGate } from './onboarding-gate';

const AccountsModal = React.lazy(() => import('@renderer/shared/modals/AccountsModal'));
const ScrapeModal = React.lazy(() => import('@renderer/shared/modals/ScrapeModal'));
const CategoryHierarchyModal = React.lazy(() => import('@renderer/shared/modals/CategoryHierarchyModal'));

const DRAWER_WIDTH = 236;
const DRAWER_WIDTH_COLLAPSED = 72;

const LEGACY_PAGE_ALIASES: Record<string, string> = {
  analysis: 'plan',
  budgets: 'plan',
  investments: 'wealth',
};

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  onDataRefresh?: () => void;
}

interface CategoryModalEventDetail {
  tab?: string;
  vendor?: string;
  transaction?: {
    identifier?: string;
    vendor?: string;
  };
}

type CredentialsLoadStatus = 'loading' | 'ready' | 'error';

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange, onDataRefresh }) => {
  const onPageChangeRef = useRef(onPageChange);
  const credentialsRequestIdRef = useRef(0);
  const [open, setOpen] = useState(true);
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [accountsModalRequest, setAccountsModalRequest] = useState<AccountsModalOpenRequest | null>(null);
  const [scrapeModalOpen, setScrapeModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryInitialTab, setCategoryInitialTab] = useState(0);
  const [categoryInitialRuleVendor, setCategoryInitialRuleVendor] = useState<string | null>(null);
  const [categoryFocusedTransaction, setCategoryFocusedTransaction] = useState<{
    identifier: string;
    vendor: string;
  } | null>(null);
  interface AccountSyncStatus {
    id: string;
    vendor: string;
    nickname: string | null;
    lastSync: Date | null;
    status: AccountSyncStatusColor;
  }

  const [stats, setStats] = useState({
    totalAccounts: 0,
    lastSync: null as Date | null,
    dbStatus: 'checking' as 'connected' | 'disconnected' | 'checking',
  });
  const [accountSyncStatuses, setAccountSyncStatuses] = useState<AccountSyncStatus[]>([]);
  const [credentialsStatus, setCredentialsStatus] = useState<CredentialsLoadStatus>('loading');
  const [accountAlerts, setAccountAlerts] = useState({
    noBank: false,
    noCredit: false,
    noPension: false,
    hasInvestmentSuggestions: false,
  });
  const [uncategorizedCount, setUncategorizedCount] = useState<number>(0);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [syncPopoverAnchor, setSyncPopoverAnchor] = useState<HTMLElement | null>(null);
  const { showNotification } = useNotification();
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const { t } = useTranslation('translation', { keyPrefix: 'sidebar' });
  const {
    data: pairingGapData,
    loading: pairingGapLoading,
    refresh: refreshPairingGap,
  } = useCurrentMonthPairingGap({ days: 30 });
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { latestEvent: scrapeEvent } = useScrapeProgress();
  const modifierKeyLabel = window.electronAPI?.platform?.isMacOS ? '⌘' : 'Ctrl+';

  const openAccountsModal = useCallback((request: AccountsModalOpenRequest | null = null) => {
    setAccountsModalRequest(request);
    setAccountsModalOpen(true);
  }, []);

  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);

  const menuItems = useMemo(
    () => [
      {
        id: 'home',
        accessPage: 'home',
        label: t('menu.home', { defaultValue: 'Home' }),
        icon: <HomeIcon />,
        shortcut: `${modifierKeyLabel}1`,
      },
      {
        id: 'review',
        accessPage: 'review',
        label: t('menu.review', { defaultValue: 'Review' }),
        icon: <ReviewIcon />,
        shortcut: `${modifierKeyLabel}2`,
      },
      {
        id: 'activity',
        accessPage: 'activity',
        label: t('menu.activity', { defaultValue: 'Activity' }),
        icon: <ActivityIcon />,
        shortcut: `${modifierKeyLabel}3`,
      },
      {
        id: 'plan',
        accessPage: 'analysis',
        label: t('menu.plan', { defaultValue: 'Plan' }),
        icon: <PlanIcon />,
        shortcut: `${modifierKeyLabel}4`,
      },
      {
        id: 'wealth',
        accessPage: 'investments',
        label: t('menu.wealth', { defaultValue: 'Wealth' }),
        icon: <InvestmentIcon />,
        shortcut: `${modifierKeyLabel}5`,
      },
      {
        id: 'settings',
        accessPage: 'settings',
        label: t('menu.settings', { defaultValue: 'Settings' }),
        icon: <SettingsIcon />,
        shortcut: `${modifierKeyLabel}6`,
      },
    ],
    [modifierKeyLabel, t],
  );

  const fetchStats = useCallback(async () => {
    const requestId = ++credentialsRequestIdRef.current;
    setCredentialsStatus('loading');
    try {
      const accountsRes = await apiClient.get('/api/credentials');
      if (!accountsRes.ok) {
        throw new Error(accountsRes.statusText || 'Failed to load credentials');
      }

      const accountsData = accountsRes.data as any;
      const accounts = Array.isArray(accountsData)
        ? accountsData
        : Array.isArray(accountsData?.items)
          ? accountsData.items
          : null;
      if (!accounts) {
        throw new Error('Invalid credentials response');
      }

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

      if (requestId === credentialsRequestIdRef.current) {
        const hasBank = accounts.some(
          (credential: any) => credential?.institution?.institution_type === 'bank',
        );
        const hasCredit = accounts.some(
          (credential: any) => credential?.institution?.institution_type === 'credit_card',
        );
        const missingInstitution = accounts.filter((credential: any) => !credential.institution_id);
        if (missingInstitution.length > 0) {
          console.warn(
            `[Sidebar] ${missingInstitution.length} credential(s) missing institution_id. Vendors:`,
            missingInstitution.map((credential: any) => credential.vendor),
          );
        }

        setAccountSyncStatuses(accountStatuses);
        setStats(prev => ({
          ...prev,
          totalAccounts: accounts.length,
          lastSync: oldestSync,
        }));
        setAccountAlerts(prev => ({
          ...prev,
          noBank: !hasBank,
          noCredit: !hasCredit,
        }));
        setCredentialsStatus('ready');
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      if (requestId === credentialsRequestIdRef.current) {
        setCredentialsStatus('error');
      }
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
      const [investResponse, suggestionsResponse] = await Promise.all([
        apiClient.get('/api/investments/accounts'),
        apiClient.get('/api/investments/smart-suggestions?thresholdDays=90'),
      ]);

      const investData = investResponse.ok ? (investResponse.data as any) : { accounts: [] };
      const investAccounts = Array.isArray(investData?.accounts) ? investData.accounts : [];
      const suggestionsData = suggestionsResponse.ok ? (suggestionsResponse.data as any) : { suggestions: [] };
      const investmentSuggestions = Array.isArray(suggestionsData?.suggestions)
        ? suggestionsData.suggestions
        : [];

      const PENSION_TYPES = new Set(['pension', 'provident', 'study_fund']);
      const hasPension = investAccounts.some((acc: any) => PENSION_TYPES.has(acc.account_type));

      setAccountAlerts(prev => ({
        ...prev,
        noPension: !hasPension,
        hasInvestmentSuggestions: investmentSuggestions.length > 0,
      }));

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
      }
    } catch (error) {
      console.error('Error fetching uncategorized count:', error);
    }
  }, []);

  const handleScrapeComplete = useCallback(() => {
    // A single global refresh event fans out to Sidebar + active pages.
    if (onDataRefresh) {
      onDataRefresh();
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dataRefresh'));
    }
  }, [onDataRefresh]);

  useEffect(() => {
    if (!scrapeEvent || !scrapeEvent.status) {
      return;
    }

    if (scrapeEvent.status === 'starting' || scrapeEvent.status === 'in_progress') {
      setIsBulkSyncing(true);
      return;
    }

    if (scrapeEvent.status === 'completed' || scrapeEvent.status === 'partial') {
      setIsBulkSyncing(false);
      handleScrapeComplete();
      return;
    }

    if (scrapeEvent.status === 'blocked' || scrapeEvent.status === 'failed') {
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
      const successCount = Number(result.successCount) || 0;
      const isPartial = result.status === 'partial' || (!result.success && successCount > 0);

      if (result.success || isPartial) {
        let message: string;
        if (isPartial) {
          message = result.message || `Synced ${successCount}/${result.totalProcessed || 0} accounts (${result.totalTransactions || 0} transactions)`;
        } else if (result.totalProcessed === 0) {
          message = 'All accounts are up to date';
        } else {
          message = `Synced ${successCount}/${result.totalProcessed} accounts (${result.totalTransactions || 0} transactions)`;
        }

        showNotification(
          message,
          isPartial || result.successCount !== result.totalProcessed ? 'warning' : 'success'
        );

        if (!hasScrapeBridge && (result.success || successCount > 0)) {
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

  const openCategoriesModal = useCallback((detail: CategoryModalEventDetail = {}) => {
    const tabMap: Record<string, number> = {
      categorize: 0,
      categorize_investments: 0,
      manage_categories: 1,
      create_rules: 2,
      rules: 2,
    };
    const identifier = detail.transaction?.identifier?.trim();
    const vendor = detail.transaction?.vendor?.trim();

    setCategoryInitialTab(tabMap[detail.tab ?? ''] ?? 0);
    setCategoryInitialRuleVendor(detail.vendor?.trim() || null);
    setCategoryFocusedTransaction(
      identifier && vendor
        ? { identifier, vendor }
        : null,
    );
    setCategoryModalOpen(true);
  }, []);

  useEffect(() => {
    fetchStats();
    checkDBStatus();
    fetchAccountStatus();
    fetchUncategorizedCount();
    const checkDbStatusIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      checkDBStatus();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        checkDBStatus();
      }
    };

    const interval = setInterval(checkDbStatusIfVisible, 30000); // Check DB every 30s
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Listen for onboarding custom events
    const handleOpenProfile = () => {
      // Navigate to settings page where profile setup should be
      onPageChangeRef.current('settings');
    };

    const handleOpenAccounts = (event: Event) => {
      openAccountsModal((event as CustomEvent<AccountsModalOpenRequest>).detail || null);
    };

    const handleOpenScrape = () => {
      setScrapeModalOpen(true);
    };

    // Listen for data refresh events to update badges
    const handleDataRefresh = () => {
      fetchStats();
      fetchAccountStatus();
      fetchUncategorizedCount();
      refreshPairingGap();
    };

    const handleGuideOpenCategories = (event: Event) => {
      openCategoriesModal((event as CustomEvent<CategoryModalEventDetail>).detail || {});
    };

    const handleGuideTriggerBulkSync = () => {
      handleBulkRefresh();
    };

    const handleOpenCategoriesModal = (event: Event) => {
      openCategoriesModal((event as CustomEvent<CategoryModalEventDetail>).detail || {});
    };

    globalThis.addEventListener('openProfileSetup', handleOpenProfile);
    globalThis.addEventListener('openAccountsModal', handleOpenAccounts);
    globalThis.addEventListener('openScrapeModal', handleOpenScrape);
    globalThis.addEventListener('dataRefresh', handleDataRefresh);
    globalThis.addEventListener('guideOpenCategoriesModal', handleGuideOpenCategories);
    globalThis.addEventListener('guideTriggerBulkSync', handleGuideTriggerBulkSync);
    globalThis.addEventListener('openCategoriesModal', handleOpenCategoriesModal);

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      globalThis.removeEventListener('openProfileSetup', handleOpenProfile);
      globalThis.removeEventListener('openAccountsModal', handleOpenAccounts);
      globalThis.removeEventListener('openScrapeModal', handleOpenScrape);
      globalThis.removeEventListener('dataRefresh', handleDataRefresh);
      globalThis.removeEventListener('guideOpenCategoriesModal', handleGuideOpenCategories);
      globalThis.removeEventListener('guideTriggerBulkSync', handleGuideTriggerBulkSync);
      globalThis.removeEventListener('openCategoriesModal', handleOpenCategoriesModal);
    };
  }, [
    fetchStats,
    checkDBStatus,
    fetchAccountStatus,
    fetchUncategorizedCount,
    openAccountsModal,
    openCategoriesModal,
    refreshPairingGap,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSyncIconClick = () => {
    if (credentialsStatus !== 'ready') {
      if (credentialsStatus === 'error') {
        void fetchStats();
      }
      return;
    }

    const isSyncStale = stats.lastSync && (Date.now() - stats.lastSync.getTime()) > STALE_SYNC_THRESHOLD_MS;
    
    if (isSyncStale && !isBulkSyncing) {
      // If sync is stale, trigger bulk refresh
      handleBulkRefresh();
    } else {
      // Otherwise, open accounts modal
      openAccountsModal();
    }
  };

  const handleDrawerToggle = () => {
    setOpen(!open);
  };

  const formatLastSync = () => {
    if (credentialsStatus === 'loading') {
      return t('credentials.loading');
    }
    if (credentialsStatus === 'error') {
      return t('credentials.unavailable');
    }

    return formatSidebarLastSync(stats.lastSync, new Date(), {
      never: t('sync.never'),
      daysAgo: (count) => t('sync.daysAgo', { count }),
      hoursAgo: (count) => t('sync.hoursAgo', { count }),
      minutesAgo: (count) => t('sync.minutesAgo', { count }),
      justNow: t('sync.justNow'),
    });
  };

  const formatAccountLastSync = (lastSync: Date | null) => {
    return formatSidebarAccountLastSync(lastSync, new Date(), {
      neverSynced: t('accountSync.neverSynced'),
      daysAgo: (count) => t('sync.daysAgo', { count }),
      hoursAgo: (count) => t('sync.hoursAgo', { count }),
      minutesAgo: (count) => t('sync.minutesAgo', { count }),
      yesterday: t('sync.yesterday'),
      justNow: t('sync.justNow'),
    });
  };

  const getStatusColor = (status: AccountSyncStatusColor) => {
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

  const staleAccounts = credentialsStatus === 'ready'
    ? accountSyncStatuses.filter(
      (account) => account.status === 'orange' || account.status === 'red'
    )
    : [];
  const hasPairingGapWarning = !pairingGapLoading && Number(pairingGapData?.totals?.missingAmount || 0) > 2;
  const hasAddAccountWarning = credentialsStatus === 'ready' && (
    accountAlerts.noBank
      || accountAlerts.noCredit
      || accountAlerts.noPension
      || accountAlerts.hasInvestmentSuggestions
      || hasPairingGapWarning
  );
  const addAccountTooltip = hasPairingGapWarning
    ? t(
      'tooltips.addAccountPairingGap',
      'Current month may be missing card transactions. Open Account Pairing for unmatched cards and run Recovery Sync (100 days).',
    )
    : accountAlerts.hasInvestmentSuggestions
      ? t(
        'tooltips.addAccountInvestmentSuggestions',
        'You have investment transactions ready to link in Investments & Savings.',
      )
    : t('tooltips.addAccount');

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
            position: isMobile ? 'fixed' : 'relative',
            top: 0,
            left: 0,
            width: drawerWidth,
            height: '100%',
            boxSizing: 'border-box',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: theme.palette.mode === 'dark' ? '#141B17' : '#F9FAF7',
            borderRight: `1px solid ${theme.palette.divider}`,
            backdropFilter: 'none',
            paddingTop: '64px', // Account for TitleBar height
            borderTopLeftRadius: 'var(--app-window-radius, 12px)',
            borderBottomLeftRadius: 'var(--app-window-radius, 12px)',
          },
        }}
      >
        {/* Header - collapse toggle only (branding is in TitleBar) */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px 16px 8px',
            minHeight: 48,
          }}
        >
          <Tooltip title={open ? t('tooltips.collapseSidebar', 'Collapse sidebar') : t('tooltips.expandSidebar')} placement="right">
            <IconButton
              onClick={handleDrawerToggle}
              size="small"
              aria-label={open ? t('tooltips.collapseSidebar', 'Collapse sidebar') : t('tooltips.expandSidebar', 'Expand sidebar')}
              aria-expanded={open}
              sx={{
                color: theme.palette.text.secondary,
                transition: 'background-color 160ms ease, color 160ms ease',
                backgroundColor: alpha(theme.palette.primary.main, 0.08),
                '&:hover': {
                  color: theme.palette.primary.main,
                  backgroundColor: alpha(theme.palette.primary.main, 0.14),
                }
              }}
            >
              {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Menu Items */}
        <List sx={{ flexGrow: 1, px: 1.25, display: 'flex', flexDirection: 'column' }}>
          {menuItems.map((item) => {
            const { accessStatus, isLocked } = resolveOnboardingGate(
              onboardingStatus,
              getPageAccessStatus,
              item.accessPage,
            );
            const normalizedCurrentPage = LEGACY_PAGE_ALIASES[currentPage] ?? currentPage;
            const isActive = normalizedCurrentPage === item.id;
            const handleItemClick = () => {
              if (isLocked) {
                return;
              }

              onPageChange(item.id);
            };

            return (
              <ListItem
                key={item.id}
                disablePadding
                sx={{ mb: 0.5, mt: item.id === 'settings' ? 'auto' : 0 }}
              >
                <Tooltip
                  title={isLocked ? accessStatus.reason : (!open ? `${item.label} • ${item.shortcut}` : '')}
                  placement="right"
                  arrow
                >
                  <ListItemButton
                    selected={isActive}
                    onClick={handleItemClick}
                    aria-disabled={isLocked || undefined}
                    sx={{
                      minHeight: 44,
                      justifyContent: open ? 'initial' : 'center',
                      px: 2.5,
                      borderRadius: 2.25,
                      opacity: isLocked ? 0.5 : 1,
                      transition: 'background-color 160ms ease, color 160ms ease',
                      backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
                      color: isActive ? theme.palette.primary.main : theme.palette.text.secondary,
                      '&:hover': {
                        backgroundColor: isActive 
                          ? alpha(theme.palette.primary.main, 0.20) 
                          : alpha(theme.palette.text.primary, 0.04),
                        opacity: isLocked ? 0.6 : 1,
                      },
                      '&.Mui-selected': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.12),
                        '&:hover': {
                          backgroundColor: alpha(theme.palette.primary.main, 0.20),
                        },
                      }
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        mr: open ? 2 : 'auto',
                        justifyContent: 'center',
                        color: isActive ? theme.palette.primary.main : 'inherit',
                        transition: 'color 0.2s',
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
                    {open && (
                      <>
                        <ListItemText 
                          primary={item.label} 
                          slotProps={{
                            primary: {
                              sx: {
                                fontWeight: isActive ? 600 : 500,
                                fontSize: '0.95rem',
                              },
                            }
                          }}
                        />
                        <Typography
                          aria-hidden="true"
                          variant="caption"
                          sx={{
                            ml: 1,
                            color: isActive ? 'primary.main' : 'text.secondary',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.shortcut}
                        </Typography>
                      </>
                    )}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })}
        </List>

        {/* Bottom Section */}
        {open && (
          <>
            <Box sx={{ p: 2.5 }}>
              {/* Action Buttons */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
                <Tooltip title={addAccountTooltip} placement="right">
                  <Badge
                    badgeContent={hasAddAccountWarning ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : null}
                    color="warning"
                    overlap="circular"
                    anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                    sx={{ width: '100%' }}
                  >
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => openAccountsModal()}
                      fullWidth
                      aria-label={t('actions.addAccount')}
                      sx={{
                        borderRadius: 3,
                        py: 1,
                        textTransform: 'none',
                        fontWeight: 600,
                        boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}`,
                        background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                        color: theme.palette.primary.contrastText,
                        '&:hover': {
                          background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})`,
                          boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.4)}`,
                        }
                      }}
                    >
                      {t('actions.addAccount')}
                    </Button>
                  </Badge>
                </Tooltip>
                <Badge
                  badgeContent={uncategorizedCount > 0 ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : null}
                  color="warning"
                  overlap="circular"
                  anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                  sx={{ width: '100%' }}
                >
                  <Button
                    variant="outlined"
                    startIcon={<CategoryIcon />}
                    onClick={() => setCategoryModalOpen(true)}
                    fullWidth
                    aria-label={uncategorizedCount > 0 
                      ? `${t('actions.categories')} (${uncategorizedCount} ${t('uncategorized', 'uncategorized')})` 
                      : t('actions.categories')
                    }
                    sx={{
                      borderRadius: 3,
                      py: 1,
                      textTransform: 'none',
                      fontWeight: 600,
                      borderColor: alpha(theme.palette.divider, 0.2),
                      color: theme.palette.text.primary,
                      '&:hover': {
                        borderColor: theme.palette.primary.main,
                        backgroundColor: alpha(theme.palette.primary.main, 0.04),
                      }
                    }}
                  >
                    {t('actions.categories')}
                  </Button>
                </Badge>
              </Box>

              {/* Stats Card */}
              <Box sx={{ 
                p: 2, 
                borderRadius: 4, 
                backgroundColor: alpha(theme.palette.background.paper, 0.4),
                border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                display: 'flex', 
                flexDirection: 'column', 
                gap: 1.5 
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ 
                    p: 0.8, 
                    borderRadius: 2, 
                    backgroundColor: alpha(theme.palette.text.primary, 0.05),
                    display: 'flex'
                  }}>
                    {credentialsStatus === 'loading' ? (
                      <CircularProgress size={20} />
                    ) : credentialsStatus === 'error' ? (
                      <ErrorIcon fontSize="small" color="error" />
                    ) : (
                      <AccountIcon fontSize="small" color="action" />
                    )}
                  </Box>
                  <Box>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        lineHeight: 1
                      }}>
                      {t('stats.accounts', 'Accounts')}
                    </Typography>
                    <Typography
                      variant="body2"
                      color={credentialsStatus === 'error' ? 'error.main' : 'text.primary'}
                      sx={{ fontWeight: 600 }}
                    >
                      {credentialsStatus === 'ready'
                        ? `${stats.totalAccounts} ${t('stats.connected', 'Connected')}`
                        : credentialsStatus === 'loading'
                          ? t('credentials.loading')
                          : t('credentials.unavailable')}
                    </Typography>
                  </Box>
                </Box>

                <Divider sx={{ borderColor: alpha(theme.palette.divider, 0.1) }} />

                <Box
                  role="button"
                  tabIndex={0}
                  aria-label={credentialsStatus === 'error'
                    ? t('credentials.retry')
                    : credentialsStatus === 'loading'
                      ? t('credentials.loading')
                      : isBulkSyncing
                        ? t('sync.syncing', 'Syncing...')
                        : t('sync.clickToSync', 'Click to sync accounts')}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    cursor: credentialsStatus === 'loading' || isBulkSyncing ? 'wait' : 'pointer',
                    '&:hover': {
                      '& .sync-icon-bg': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.1),
                      }
                    },
                    '&:focus-visible': {
                      outline: `2px solid ${theme.palette.primary.main}`,
                      outlineOffset: 2,
                      borderRadius: 1,
                    },
                  }}
                  onClick={handleSyncIconClick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSyncIconClick();
                    }
                  }}
                  onMouseEnter={handleSyncPopoverOpen}
                  onMouseLeave={handleSyncPopoverClose}
                >
                  <Box className="sync-icon-bg" sx={{ 
                    p: 0.8, 
                    borderRadius: 2, 
                    backgroundColor: alpha(theme.palette.text.primary, 0.05),
                    display: 'flex',
                    transition: 'background-color 0.2s'
                  }}>
                    {credentialsStatus === 'loading' || isBulkSyncing ? (
                      <CircularProgress size={16} />
                    ) : credentialsStatus === 'error' ? (
                      <ErrorIcon fontSize="small" color="error" />
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
                  </Box>
                  <Box>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        lineHeight: 1
                      }}>
                      {t('stats.lastSync', 'Last Sync')}
                    </Typography>
                    <Typography
                      variant="body2"
                      color={
                        stats.lastSync && (Date.now() - stats.lastSync.getTime()) > STALE_SYNC_THRESHOLD_MS
                          ? 'warning.main'
                          : 'text.primary'
                      }
                      sx={{
                        fontWeight: 600
                      }}
                    >
                      {formatLastSync()}
                    </Typography>
                  </Box>
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
                        borderRadius: 3,
                        boxShadow: theme.shadows[8],
                        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                      },
                    },
                  }}
                >
                  <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>
                    {t('popover.title')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    {credentialsStatus === 'loading' && (
                      <Typography variant="caption" color="text.secondary">
                        {t('credentials.loading')}
                      </Typography>
                    )}
                    {credentialsStatus === 'error' && (
                      <Typography variant="caption" color="error.main">
                        {t('credentials.loadFailed')}
                      </Typography>
                    )}
                    {credentialsStatus === 'ready' && accountSyncStatuses.length === 0 ? (
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {t('popover.noAccounts')}
                      </Typography>
                    ) : accountSyncStatuses.length > 0 ? (
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
                                boxShadow: `0 0 8px ${alpha(getStatusColor(account.status), 0.5)}`
                              }}
                            />
                            <Typography
                              variant="caption"
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontWeight: 500
                              }}
                            >
                              {account.nickname || account.vendor}
                            </Typography>
                          </Box>
                          <Typography
                            variant="caption"
                            sx={{
                              color: "text.secondary",
                              flexShrink: 0,
                              fontSize: '0.7rem'
                            }}>
                            {formatAccountLastSync(account.lastSync)}
                          </Typography>
                        </Box>
                      ))
                    ) : null}
                  </Box>
                  {credentialsStatus === 'error' && (
                    <Button
                      variant="outlined"
                      size="small"
                      fullWidth
                      startIcon={<SyncIcon />}
                      onClick={() => {
                        void fetchStats();
                      }}
                      sx={{ mb: staleAccounts.length > 0 ? 1 : 0, borderRadius: 2 }}
                    >
                      {t('credentials.retry')}
                    </Button>
                  )}
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
                        sx={{ borderRadius: 2 }}
                      >
                        {t('popover.refreshStaleAccounts', { count: staleAccounts.length })}
                      </Button>
                    </>
                  )}
                </Popover>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ 
                    p: 0.8, 
                    borderRadius: 2, 
                    backgroundColor: alpha(theme.palette.text.primary, 0.05),
                    display: 'flex'
                  }}>
                    {stats.dbStatus === 'connected' ? (
                      <CheckIcon fontSize="small" color="success" />
                    ) : stats.dbStatus === 'disconnected' ? (
                      <ErrorIcon fontSize="small" color="error" />
                    ) : (
                      <StorageIcon fontSize="small" color="action" />
                    )}
                  </Box>
                  <Box>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        lineHeight: 1
                      }}>
                      {t('stats.database', 'Database')}
                    </Typography>
                    <Typography variant="body2" color={
                      stats.dbStatus === 'connected' ? 'success.main' : 
                      stats.dbStatus === 'disconnected' ? 'error.main' : 'text.secondary'
                    } sx={{
                      fontWeight: 600
                    }}>
                      {stats.dbStatus === 'connected' ? t('dbStatus.connected') : 
                       stats.dbStatus === 'disconnected' ? t('dbStatus.disconnected') : t('dbStatus.checking')}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          </>
        )}

        {/* Collapsed view icons */}
        {!open && (
          <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
            <Divider sx={{ width: '100%', mb: 1 }} />

            {/* Account count indicator */}
            <Tooltip
              title={credentialsStatus === 'ready'
                ? `${stats.totalAccounts} ${t('stats.accountsConnected')}`
                : credentialsStatus === 'loading'
                  ? t('credentials.loading')
                  : t('credentials.unavailable')}
              placement="right"
            >
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: alpha(theme.palette.text.primary, 0.05),
              }}>
                {credentialsStatus === 'loading' ? (
                  <CircularProgress size={16} />
                ) : credentialsStatus === 'error' ? (
                  <ErrorIcon fontSize="small" color="error" />
                ) : (
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      color: "text.secondary"
                    }}>
                    {stats.totalAccounts}
                  </Typography>
                )}
              </Box>
            </Tooltip>

            {/* Add Account Button */}
            <Tooltip title={addAccountTooltip} placement="right">
              <IconButton
                size="small"
                onClick={() => openAccountsModal()}
                sx={{
                  backgroundColor: alpha(theme.palette.primary.main, 0.1),
                  color: theme.palette.primary.main,
                  '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.2) }
                }}
              >
                <Badge
                  badgeContent={hasAddAccountWarning ? <WarningAmberIcon sx={{ fontSize: 10 }} /> : null}
                  color="warning"
                >
                  <AddIcon />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* Categories Button */}
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

            {/* Sync/Refresh Button */}
            <Tooltip title={formatLastSync()} placement="right">
              <IconButton
                size="small"
                onClick={credentialsStatus === 'ready'
                  ? handleBulkRefresh
                  : () => {
                    void fetchStats();
                  }}
                disabled={credentialsStatus === 'loading' || isBulkSyncing}
                aria-label={credentialsStatus === 'error'
                  ? t('credentials.retry')
                  : t('sync.clickToSync', 'Click to sync accounts')}
                sx={{
                  backgroundColor: alpha(theme.palette.text.primary, 0.05),
                  '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.1) }
                }}
              >
                {credentialsStatus === 'loading' || isBulkSyncing ? (
                  <CircularProgress size={18} />
                ) : credentialsStatus === 'error' ? (
                  <ErrorIcon fontSize="small" color="error" />
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
              </IconButton>
            </Tooltip>

            {/* Database Status */}
            <Box
              role="status"
              aria-label={`${t('stats.database', 'Database')}: ${stats.dbStatus === 'connected' ? t('dbStatus.connected') : t('dbStatus.disconnected')}`}
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: stats.dbStatus === 'connected' ? 'success.main' : 'error.main',
                mt: 1,
                boxShadow: `0 0 8px ${alpha(stats.dbStatus === 'connected' ? theme.palette.success.main : theme.palette.error.main, 0.5)}`
              }}
            />
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
      {/* Closed modals stay out of the startup dependency graph. */}
      {accountsModalOpen && (
        <React.Suspense fallback={null}>
          <AccountsModal
            isOpen
            openRequest={accountsModalRequest}
            onClose={() => {
              setAccountsModalRequest(null);
              setAccountsModalOpen(false);
              fetchStats();
              fetchAccountStatus();
            }}
          />
        </React.Suspense>
      )}
      {scrapeModalOpen && (
        <React.Suspense fallback={null}>
          <ScrapeModal
            isOpen
            onClose={() => setScrapeModalOpen(false)}
            onSuccess={handleScrapeComplete}
          />
        </React.Suspense>
      )}
      {categoryModalOpen && (
        <React.Suspense fallback={null}>
          <CategoryHierarchyModal
            open
            onClose={() => {
              setCategoryModalOpen(false);
              setCategoryInitialRuleVendor(null);
              setCategoryFocusedTransaction(null);
              fetchUncategorizedCount();
            }}
            onCategoriesUpdated={handleScrapeComplete}
            initialTab={categoryInitialTab}
            initialRuleVendor={categoryInitialRuleVendor}
            focusedTransaction={categoryFocusedTransaction}
          />
        </React.Suspense>
      )}
    </>
  );
};

export default Sidebar;
