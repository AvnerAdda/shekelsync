import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Box,
  Chip,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material';
import type { Theme } from '@mui/material';
import Sidebar from '@app/components/Sidebar';
import FinancialChatbot from '@app/components/FinancialChatbot';
import SmartNotifications from '@app/components/SmartNotifications';
import { useAuth } from '@app/contexts/AuthContext';
import logoUrl from '@app/public/logo.svg?url';

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
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (muiTheme: Theme) => muiTheme.zIndex.drawer + 1,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(30, 30, 30, 0.7)'
            : 'rgba(255, 255, 255, 0.7)',
          color: 'text.primary',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          borderBottom: theme.palette.mode === 'dark'
            ? '1px solid rgba(200, 250, 207, 0.1)'
            : '1px solid rgba(200, 250, 207, 0.2)',
          borderRadius: '0 0 24px 24px',
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between', minHeight: 64 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #c8facf 0%, #e0e2c8 50%, #facfc8 100%)',
                backgroundSize: '200% 200%',
                animation: 'gradient-flow 6s ease infinite',
                padding: '8px',
                boxShadow: `
                  0 0 20px rgba(200, 250, 207, 0.4),
                  0 0 40px rgba(250, 207, 200, 0.2),
                  0 8px 32px rgba(0, 0, 0, 0.1)
                `,
                position: 'relative',
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  inset: -2,
                  background: 'linear-gradient(135deg, #c8facf, #facfc8)',
                  borderRadius: '16px',
                  opacity: 0,
                  transition: 'opacity 0.3s',
                  filter: 'blur(8px)',
                  zIndex: -1,
                },
                '&:hover': {
                  transform: 'scale(1.05) rotate(5deg)',
                  boxShadow: `
                    0 0 30px rgba(200, 250, 207, 0.6),
                    0 0 60px rgba(250, 207, 200, 0.3),
                    0 12px 40px rgba(0, 0, 0, 0.15)
                  `,
                },
                '&:hover::before': {
                  opacity: 0.7,
                },
                '@keyframes gradient-flow': {
                  '0%, 100%': { backgroundPosition: '0% 50%' },
                  '50%': { backgroundPosition: '100% 50%' },
                },
              }}
            >
              <img
                src={logoUrl}
                alt="ShekelSync"
                width={28}
                height={28}
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </Box>
            <Typography
              variant="h6"
              component="div"
              sx={{
                fontWeight: 600,
                letterSpacing: '-0.5px',
                background: 'linear-gradient(135deg, #3ea54d 0%, #a54d3e 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              ShekelSync
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Chip
              size="small"
              color={sessionDisplayName ? 'success' : 'default'}
              variant={sessionDisplayName ? 'filled' : 'outlined'}
              label={authLoading
                ? 'Signing in…'
                : sessionDisplayName
                  ? `Signed in as ${sessionDisplayName}`
                  : 'Offline mode'}
              sx={{
                fontWeight: 500,
                ...(sessionDisplayName && {
                  backgroundColor: 'success.light',
                  color: 'success.contrastText',
                }),
              }}
            />
            <SmartNotifications />
          </Box>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flexGrow: 1, mt: 8 }}>
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
