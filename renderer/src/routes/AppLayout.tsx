import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  useTheme,
} from '@mui/material';
import Sidebar from '@renderer/features/layout/components/Sidebar';
import FinancialChatbot from '@renderer/features/chatbot/components/FinancialChatbot';
import TitleBar from '@renderer/features/layout/components/TitleBar';
import GlobalTransactionSearch from '@renderer/features/search/components/GlobalTransactionSearch';
import { DonationReminderDialog, useDonationStatus } from '@renderer/features/support';
import { useAuth } from '@app/contexts/AuthContext';

const DRAWER_WIDTH_COLLAPSED = 65;

const pageToPath: Record<string, string> = {
  home: '/',
  analysis: '/analysis',
  investments: '/investments',
  budgets: '/budgets',
  settings: '/settings',
};

const pathToPage = (pathname: string): string => {
  const match = Object.entries(pageToPath).find(([, value]) => value === pathname);
  return match ? match[0] : 'home';
};

export interface AppLayoutContext {
  triggerDataRefresh: () => void;
}

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const { session, loading: authLoading } = useAuth();
  const [currentPage, setCurrentPage] = useState<string>(() => pathToPage(location.pathname));
  const [searchOpen, setSearchOpen] = useState(false);
  const [donationReminderOpen, setDonationReminderOpen] = useState(false);
  const [donationReminderBusy, setDonationReminderBusy] = useState(false);
  const sessionDisplayName = session?.user?.name || session?.user?.email || null;
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

  const handleDataRefresh = useCallback(() => {
    window.dispatchEvent(new Event('dataRefresh'));
  }, []);

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
      
      // Cmd/Ctrl + 1-4: Navigate between pages
      if (isModifierPressed(event)) {
        let handledDigitShortcut = false;
        switch (event.code) {
          case 'Digit1':
            event.preventDefault();
            navigate('/');
            handledDigitShortcut = true;
            break;
          case 'Digit2':
            event.preventDefault();
            navigate('/analysis');
            handledDigitShortcut = true;
            break;
          case 'Digit3':
            event.preventDefault();
            navigate('/investments');
            handledDigitShortcut = true;
            break;
          case 'Digit4':
            event.preventDefault();
            navigate('/settings');
            handledDigitShortcut = true;
            break;
        }

        // Fallback for unusual keyboard layouts where event.code is unavailable
        if (!handledDigitShortcut) {
          switch (event.key) {
            case '1':
              event.preventDefault();
              navigate('/');
              break;
            case '2':
              event.preventDefault();
              navigate('/analysis');
              break;
            case '3':
              event.preventDefault();
              navigate('/investments');
              break;
            case '4':
              event.preventDefault();
              navigate('/settings');
              break;
          }
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
        minHeight: '100vh',
        position: 'relative',
        borderRadius: 'inherit',
        overflow: 'hidden',
        background: theme.palette.mode === 'dark'
          ? `
            radial-gradient(ellipse at 20% 20%, rgba(62,165,77,0.15) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 80%, rgba(165,77,62,0.15) 0%, transparent 50%),
            #0a0a0a
          `
          : `
            radial-gradient(ellipse at 20% 20%, rgba(200,250,207,0.4) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 80%, rgba(250,207,200,0.4) 0%, transparent 50%),
            #f8fef9
          `,
        backgroundAttachment: 'fixed',
        '&::before': {
          content: '""',
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: theme.palette.mode === 'dark'
            ? 'radial-gradient(circle at 50% 50%, rgba(62,165,77,0.08) 0%, transparent 70%)'
            : 'radial-gradient(circle at 50% 50%, rgba(200,250,207,0.2) 0%, transparent 70%)',
          animation: 'pulse 8s ease-in-out infinite',
        },
        '@keyframes pulse': {
          '0%, 100%': { opacity: 0.6, transform: 'scale(1)' },
          '50%': { opacity: 1, transform: 'scale(1.05)' },
        },
      }}
    >
      <TitleBar
        sessionDisplayName={sessionDisplayName}
        authLoading={authLoading}
      />

      <Box sx={{ display: 'flex', flexGrow: 1, mt: 8, overflow: 'hidden' }}>
        <Sidebar
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onDataRefresh={handleDataRefresh}
        />

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            ml: { xs: 0, md: `${DRAWER_WIDTH_COLLAPSED}px` },
            overflow: 'auto',
            transition: theme.transitions.create(['margin'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
          }}
        >
          <Outlet context={outletContext} />
        </Box>
      </Box>

      <FinancialChatbot />
      
      <GlobalTransactionSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
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

export default AppLayout;
