import React, { useState } from 'react';
import { Box, useTheme } from '@mui/material';
import Sidebar from './Sidebar';
import HomePage from './HomePage';
import AnalysisPage from './AnalysisPage';
import InvestmentsPage from './InvestmentsPage';
import BudgetsPage from './BudgetsPage';
import SettingsPage from './SettingsPage';
import FinancialChatbot from './FinancialChatbot';

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
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
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

      {/* Financial Chatbot - Floating Button */}
      <FinancialChatbot />
    </Box>
  );
};

export default MainLayout;
