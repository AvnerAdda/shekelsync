import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  Typography,
  useTheme,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import Sidebar from '@renderer/features/layout/components/Sidebar';
import TitleBar from '@renderer/features/layout/components/TitleBar';
import GlobalTransactionSearch, {
  type TransactionSearchFilters,
} from '@renderer/features/search/components/GlobalTransactionSearch';
import { DonationReminderDialog, useDonationStatus } from '@renderer/features/support';
import { useAuth } from '@app/contexts/AuthContext';
import TransactionDetailModal, {
  type TransactionForModal,
} from '@renderer/shared/modals/TransactionDetailModal';
import { apiClient, invalidateApiCache } from '@renderer/lib/api-client';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { useTranslation } from 'react-i18next';
import {
  onStartupReady,
  scheduleStartupIdleWork,
  signalStartupReady,
} from '@renderer/app/startup/startup-readiness';

const FinancialChatbot = lazy(() => import('@renderer/features/chatbot/components/FinancialChatbot'));
const FinancialOptimizer = lazy(() => import('@renderer/features/optimizer/components/FinancialOptimizer'));

const ChatbotLoadedSignal = ({
  openOnMount,
  onLoaded,
}: {
  openOnMount: boolean;
  onLoaded: () => void;
}) => {
  useEffect(() => {
    onLoaded();
    if (!openOnMount) return undefined;

    const openTimer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('openChatbotDrawer'));
    }, 0);
    return () => window.clearTimeout(openTimer);
  }, [onLoaded, openOnMount]);

  return null;
};

const DeferredFinancialChatbot = () => {
  const [shouldLoad, setShouldLoad] = useState(false);
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const chatbotLoadedRef = useRef(false);

  const handleChatbotLoaded = useCallback(() => {
    chatbotLoadedRef.current = true;
  }, []);

  useEffect(() => {
    let cancelIdleLoad = () => {};
    const loadChatbot = () => setShouldLoad(true);
    const scheduleChatbot = () => {
      cancelIdleLoad = scheduleStartupIdleWork(loadChatbot, {
        timeoutMs: 5_000,
        fallbackDelayMs: 2_000,
      });
    };
    const handleOpenChatbot = () => {
      if (chatbotLoadedRef.current) return;
      cancelIdleLoad();
      setOpenOnLoad(true);
      loadChatbot();
    };
    const unsubscribeFromStartup = onStartupReady(scheduleChatbot);

    window.addEventListener('openChatbotDrawer', handleOpenChatbot);
    return () => {
      unsubscribeFromStartup();
      cancelIdleLoad();
      window.removeEventListener('openChatbotDrawer', handleOpenChatbot);
    };
  }, []);

  if (!shouldLoad) return null;

  return (
    <Suspense fallback={null}>
      <FinancialChatbot showLauncher={false} />
      <ChatbotLoadedSignal
        openOnMount={openOnLoad}
        onLoaded={handleChatbotLoaded}
      />
    </Suspense>
  );
};

const OptimizerLoadedSignal = ({
  openOnMount,
  onLoaded,
}: {
  openOnMount: boolean;
  onLoaded: () => void;
}) => {
  useEffect(() => {
    onLoaded();
    if (!openOnMount) return undefined;

    const openTimer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('openOptimizerDrawer'));
    }, 0);
    return () => window.clearTimeout(openTimer);
  }, [onLoaded, openOnMount]);

  return null;
};

const DeferredFinancialOptimizer = () => {
  const [shouldLoad, setShouldLoad] = useState(false);
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const optimizerLoadedRef = useRef(false);

  const handleOptimizerLoaded = useCallback(() => {
    optimizerLoadedRef.current = true;
  }, []);

  useEffect(() => {
    let cancelIdleLoad = () => {};
    const loadOptimizer = () => setShouldLoad(true);
    const scheduleOptimizer = () => {
      cancelIdleLoad = scheduleStartupIdleWork(loadOptimizer, {
        timeoutMs: 4_000,
        fallbackDelayMs: 1_200,
      });
    };
    const handleOpenOptimizer = () => {
      if (optimizerLoadedRef.current) return;
      cancelIdleLoad();
      setOpenOnLoad(true);
      loadOptimizer();
    };
    const unsubscribeFromStartup = onStartupReady(scheduleOptimizer);

    window.addEventListener('openOptimizerDrawer', handleOpenOptimizer);
    return () => {
      unsubscribeFromStartup();
      cancelIdleLoad();
      window.removeEventListener('openOptimizerDrawer', handleOpenOptimizer);
    };
  }, []);

  if (!shouldLoad) return null;

  return (
    <Suspense fallback={null}>
      <FinancialOptimizer showLauncher={false} />
      <OptimizerLoadedSignal
        openOnMount={openOnLoad}
        onLoaded={handleOptimizerLoaded}
      />
    </Suspense>
  );
};

const pageToPath: Record<string, string> = {
  home: '/',
  review: '/review',
  activity: '/activity',
  plan: '/plan',
  wealth: '/wealth',
  settings: '/settings',
};

const legacyPathToPage: Record<string, string> = {
  '/analysis': 'plan',
  '/budgets': 'plan',
  '/investments': 'wealth',
};

const pathToPage = (pathname: string): string => {
  const match = Object.entries(pageToPath).find(([, value]) => value === pathname);
  return match ? match[0] : legacyPathToPage[pathname] ?? 'home';
};

const primaryNavigationShortcuts: Record<string, string> = {
  '1': '/',
  '2': '/review',
  '3': '/activity',
  '4': '/plan',
  '5': '/wealth',
  '6': '/settings',
};

export interface AppLayoutContext {
  triggerDataRefresh: () => void;
}

interface NavigateToDetail {
  path?: string;
  search?: string;
  hash?: string;
}

interface TransactionDetailRequest {
  identifier?: string;
  vendor?: string;
}

interface AppLayoutContentProps {
  authLoading: boolean;
  sessionDisplayName: string | null;
}

const AppLayoutContent: React.FC<AppLayoutContentProps> = ({ authLoading, sessionDisplayName }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const { showNotification } = useNotification();
  const { t } = useTranslation('translation');
  const [currentPage, setCurrentPage] = useState<string>(() => pathToPage(location.pathname));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialFilters, setSearchInitialFilters] = useState<TransactionSearchFilters | null>(null);
  const [transactionDetailOpen, setTransactionDetailOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionForModal | null>(null);
  const [donationReminderOpen, setDonationReminderOpen] = useState(false);
  const [donationReminderBusy, setDonationReminderBusy] = useState(false);
  const pendingDataRefreshRef = useRef(false);
  const { status: donationStatus, loading: donationStatusLoading, markReminderShown } = useDonationStatus();

  useEffect(() => {
    setCurrentPage(pathToPage(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    if (donationStatusLoading || !donationStatus) {
      return;
    }

    if (donationStatus.shouldShowMonthlyReminder) {
      setDonationReminderOpen(true);
      return;
    }

    setDonationReminderOpen(false);
  }, [donationStatus, donationStatusLoading]);

  const dispatchDataRefresh = useCallback(() => {
    invalidateApiCache();
    window.dispatchEvent(new Event('dataRefresh'));
  }, []);

  const handleDataRefresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      pendingDataRefreshRef.current = true;
      return;
    }
    dispatchDataRefresh();
  }, [dispatchDataRefresh]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && pendingDataRefreshRef.current) {
        pendingDataRefreshRef.current = false;
        dispatchDataRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [dispatchDataRefresh]);

  // Global keyboard shortcuts
  useEffect(() => {
    const isModifierPressed = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;
    const isLetterShortcut = (event: KeyboardEvent, letter: string) => {
      const normalizedLetter = letter.toLowerCase();
      const normalizedKey = event.key.toLowerCase();
      const normalizedCode = event.code.toLowerCase();
      return normalizedKey === normalizedLetter || normalizedCode === `key${normalizedLetter}`;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd/Ctrl + K: Open global transaction search
      if (isModifierPressed(event) && isLetterShortcut(event, 'k')) {
        event.preventDefault();
        setSearchOpen(true);
      }
      
      // Cmd/Ctrl + 1-6: Navigate between primary pages
      if (isModifierPressed(event)) {
        const codeDigit = event.code.startsWith('Digit') ? event.code.slice('Digit'.length) : '';
        const shortcutPath = primaryNavigationShortcuts[codeDigit]
          ?? primaryNavigationShortcuts[event.key];

        if (shortcutPath) {
          event.preventDefault();
          navigate(shortcutPath);
        }
      }
      
      // Cmd/Ctrl + R: Refresh data (prevent browser refresh)
      if (isModifierPressed(event) && isLetterShortcut(event, 'r') && !event.shiftKey) {
        // Only handle if not in a text input
        const target = event.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          event.preventDefault();
          handleDataRefresh();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, handleDataRefresh]);

  const handlePageChange = useCallback(
    (page: string) => {
      setCurrentPage(page);
      const targetPath = pageToPath[page] ?? '/';
      if (location.pathname !== targetPath) {
        navigate(targetPath);
      }
    },
    [location.pathname, navigate],
  );

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchInitialFilters(null);
  }, []);

  const handleTransactionDetailClose = useCallback(() => {
    setTransactionDetailOpen(false);
    setSelectedTransaction(null);
  }, []);

  const handleTransactionSave = useCallback((updatedTransaction: TransactionForModal) => {
    setSelectedTransaction(updatedTransaction);
  }, []);

  const openTransactionDetail = useCallback(async (detail: TransactionDetailRequest) => {
    const identifier = detail.identifier?.trim();
    const vendor = detail.vendor?.trim();

    if (!identifier || !vendor) {
      showNotification(
        t('smartNotifications.errors.missingTransactionContext', {
          defaultValue: 'Missing transaction details for this action.',
        }),
        'error',
      );
      return;
    }

    try {
      const response = await apiClient.get<TransactionForModal>(
        `/api/transactions/${encodeURIComponent(`${identifier}|${vendor}`)}`,
      );

      if (!response.ok || !response.data) {
        throw new Error('Transaction not found');
      }

      setSelectedTransaction(response.data);
      setTransactionDetailOpen(true);
    } catch (error) {
      console.error('Failed to load transaction detail:', error);
      showNotification(
        t('smartNotifications.errors.transactionLoadFailed', {
          defaultValue: 'Unable to open that transaction right now.',
        }),
        'error',
      );
    }
  }, [showNotification, t]);

  const navigateToDetail = useCallback(({ path, search, hash }: NavigateToDetail) => {
    const targetPath = path?.trim();
    if (!targetPath) {
      return;
    }

    const canonicalPath = targetPath === '/analysis' || targetPath === '/budgets'
      ? '/plan'
      : targetPath === '/investments'
        ? '/wealth'
        : targetPath;
    const canonicalSearch = targetPath === '/budgets' && !search ? 'tab=budget' : search;
    const query = canonicalSearch
      ? (canonicalSearch.startsWith('?') ? canonicalSearch : `?${canonicalSearch}`)
      : '';
    const fragment = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
    navigate(`${canonicalPath}${query}${fragment}`);
  }, [navigate]);

  useEffect(() => {
    const handleNavigateTo = (event: Event) => {
      navigateToDetail((event as CustomEvent<NavigateToDetail>).detail || {});
    };

    const handleNavigateToAnalysis = () => {
      navigate('/plan');
    };

    const handleOpenTransactionDetail = (event: Event) => {
      void openTransactionDetail((event as CustomEvent<TransactionDetailRequest>).detail || {});
    };

    const handleOpenTransactionSearch = (event: Event) => {
      setSearchInitialFilters((event as CustomEvent<TransactionSearchFilters>).detail || {});
      setSearchOpen(true);
    };

    globalThis.addEventListener('navigateTo', handleNavigateTo);
    globalThis.addEventListener('navigateToAnalysis', handleNavigateToAnalysis);
    globalThis.addEventListener('openTransactionDetail', handleOpenTransactionDetail);
    globalThis.addEventListener('openTransactionSearch', handleOpenTransactionSearch);

    return () => {
      globalThis.removeEventListener('navigateTo', handleNavigateTo);
      globalThis.removeEventListener('navigateToAnalysis', handleNavigateToAnalysis);
      globalThis.removeEventListener('openTransactionDetail', handleOpenTransactionDetail);
      globalThis.removeEventListener('openTransactionSearch', handleOpenTransactionSearch);
    };
  }, [navigate, navigateToDetail, openTransactionDetail]);

  const handleDismissDonationReminder = useCallback(async () => {
    if (!donationStatus) {
      setDonationReminderOpen(false);
      return;
    }

    try {
      setDonationReminderBusy(true);
      await markReminderShown({ monthKey: donationStatus.currentMonthKey });
    } catch (error) {
      console.error('Failed to mark donation reminder as shown:', error);
    } finally {
      setDonationReminderBusy(false);
      setDonationReminderOpen(false);
    }
  }, [donationStatus, markReminderShown]);

  const outletContext = useMemo<AppLayoutContext>(
    () => ({ triggerDataRefresh: handleDataRefresh }),
    [handleDataRefresh],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        boxSizing: 'border-box',
        pt: 8,
        position: 'relative',
        borderRadius: 'var(--app-window-radius, 12px)',
        overflow: 'hidden',
        background: theme.palette.background.default,
      }}
    >
      <TitleBar
        sessionDisplayName={sessionDisplayName}
        authLoading={authLoading}
      />

      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Sidebar
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onDataRefresh={handleDataRefresh}
        />

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            p: { xs: 2, md: 3 },
            ml: 0,
            overflow: 'auto',
            scrollbarGutter: 'stable',
            transition: theme.transitions.create(['margin'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
          }}
        >
          <Outlet context={outletContext} />
        </Box>
      </Box>

      <DeferredFinancialOptimizer />
      <DeferredFinancialChatbot />
      
      <GlobalTransactionSearch
        open={searchOpen}
        onClose={handleSearchClose}
        initialFilters={searchInitialFilters}
        onOpenTransaction={(identifier, vendor) => {
          handleSearchClose();
          void openTransactionDetail({ identifier, vendor });
        }}
      />

      <TransactionDetailModal
        open={transactionDetailOpen}
        onClose={handleTransactionDetailClose}
        transaction={selectedTransaction}
        onSave={handleTransactionSave}
      />

      <DonationReminderDialog
        open={donationReminderOpen}
        status={donationStatus}
        busy={donationReminderBusy}
        onDismissForMonth={handleDismissDonationReminder}
      />
    </Box>
  );
};

const AppLayout: React.FC = () => {
  const location = useLocation();
  const {
    session,
    loading: authLoading,
    sessionLoadError,
    refreshSession,
  } = useAuth();
  const { t } = useTranslation('translation', { keyPrefix: 'sessionRecovery' });

  useEffect(() => {
    if (authLoading || (!sessionLoadError && location.pathname === '/')) return;

    const frameId = window.requestAnimationFrame(() => signalStartupReady());
    return () => window.cancelAnimationFrame(frameId);
  }, [authLoading, location.pathname, sessionLoadError]);

  if (sessionLoadError) {
    return (
      <Box
        role="alert"
        aria-live="assertive"
        sx={{
          minHeight: '100vh',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
          bgcolor: 'background.default',
        }}
      >
        <Paper
          elevation={4}
          sx={{
            width: '100%',
            maxWidth: 560,
            p: { xs: 3, sm: 5 },
            textAlign: 'center',
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom color="error.main">
            {t('title', { defaultValue: 'Your saved session could not be unlocked' })}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {t('message', {
              defaultValue:
                'ShekelSync could not read the protected session on this Mac. Your data has not been cleared. Try again before signing in again.',
            })}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={authLoading ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
            disabled={authLoading}
            onClick={() => {
              void refreshSession();
            }}
          >
            {authLoading
              ? t('retrying', { defaultValue: 'Trying again...' })
              : t('retry', { defaultValue: 'Try again' })}
          </Button>
        </Paper>
      </Box>
    );
  }

  const sessionDisplayName = session?.user?.name || session?.user?.email || null;
  return (
    <AppLayoutContent
      authLoading={authLoading}
      sessionDisplayName={sessionDisplayName}
    />
  );
};

export default AppLayout;
