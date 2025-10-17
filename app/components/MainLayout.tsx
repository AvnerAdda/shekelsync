import React, { useState } from 'react';
import { Box, useTheme, AppBar, Toolbar, Typography } from '@mui/material';
import Sidebar from './Sidebar';
import HomePage from './HomePage';
import AnalysisPage from './AnalysisPage';
import InvestmentsPage from './InvestmentsPage';
import BudgetsPage from './BudgetsPage';
import SettingsPage from './SettingsPage';
import FinancialChatbot from './FinancialChatbot';
import SmartNotifications from './SmartNotifications';

const DRAWER_WIDTH_COLLAPSED = 65;

const MainLayout: React.FC = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const theme = useTheme();

  const handleDataRefresh = () => {
    setDataRefreshKey(prev => prev + 1);
    // Trigger custom event for backward compatibility
    window.dispatchEvent(new Event('dataRefresh'));
  };
  
  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage key={dataRefreshKey} />;
      case 'analysis':
        return <AnalysisPage />;
      case 'investments':
        return <InvestmentsPage key={dataRefreshKey} />;
      case 'budgets':
        return <BudgetsPage key={dataRefreshKey} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage key={dataRefreshKey} />;
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top AppBar with Smart Notifications */}
      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          backgroundColor: 'background.paper',
          color: 'text.primary',
          boxShadow: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            ShekelSync
          </Typography>
          <SmartNotifications />
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flexGrow: 1, mt: 8 }}>
        {/* Sidebar with integrated controls */}
        <Sidebar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onDataRefresh={handleDataRefresh}
        />

        {/* Main Content */}
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
          {renderPage()}
        </Box>
      </Box>

      {/* Financial Chatbot - Floating Button */}
      <FinancialChatbot />
    </Box>
  );
};

export default MainLayout;
