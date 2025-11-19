import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  useTheme,
} from '@mui/material';
import Sidebar from '@renderer/features/layout/components/Sidebar';
import FinancialChatbot from '@renderer/features/chatbot/components/FinancialChatbot';
import TitleBar from '@renderer/features/layout/components/TitleBar';
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
  dataRefreshKey: number;
  triggerDataRefresh: () => void;
}

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const { session, loading: authLoading } = useAuth();
  const [currentPage, setCurrentPage] = useState<string>(() => pathToPage(location.pathname));
  const [dataRefreshKey, setDataRefreshKey] = useState<number>(0);
  const sessionDisplayName = session?.user?.name || session?.user?.email || null;

  useEffect(() => {
    setCurrentPage(pathToPage(location.pathname));
  }, [location.pathname]);

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

  const handleDataRefresh = useCallback(() => {
    setDataRefreshKey((prev) => prev + 1);
    window.dispatchEvent(new Event('dataRefresh'));
  }, []);

  const outletContext = useMemo<AppLayoutContext>(
    () => ({ dataRefreshKey, triggerDataRefresh: handleDataRefresh }),
    [dataRefreshKey, handleDataRefresh],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        position: 'relative',
        background: theme.palette.mode === 'dark'
          ? `
            radial-gradient(ellipse at 20% 20%, rgba(62,165,77,0.12) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 80%, rgba(165,77,62,0.12) 0%, transparent 50%),
            #0a0a0a
          `
          : `
            radial-gradient(ellipse at 20% 20%, rgba(200,250,207,0.25) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 80%, rgba(250,207,200,0.25) 0%, transparent 50%),
            #f8fef9
          `,
        backgroundAttachment: 'fixed',
        '&::before': {
          content: '""',
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: theme.palette.mode === 'dark'
            ? 'radial-gradient(circle at 50% 50%, rgba(62,165,77,0.05) 0%, transparent 70%)'
            : 'radial-gradient(circle at 50% 50%, rgba(200,250,207,0.15) 0%, transparent 70%)',
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
    </Box>
  );
};

export default AppLayout;
