import React, { useState, useEffect } from 'react';
import {
  Paper,
  Box,
  Button,
  Typography,
  Chip,
  Grid,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  Sync as SyncIcon,
  Category as CategoryIcon,
  AccountBalance as AccountIcon,
} from '@mui/icons-material';
import AccountsModal from './AccountsModal';
import ScrapeModal from './ScrapeModal';
import CategoryManagementModal from './CategoryDashboard/components/CategoryManagementModal';

interface BottomPanelProps {
  onDataRefresh?: () => void;
}

const BottomPanel: React.FC<BottomPanelProps> = ({ onDataRefresh }) => {
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [scrapeModalOpen, setScrapeModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    lastSync: null as Date | null,
  });

  const theme = useTheme();

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      // Fetch total accounts
      const accountsRes = await fetch('/api/credentials');
      const accounts = await accountsRes.json();

      // Fetch last scrape event
      const scrapeRes = await fetch('/api/scrape/events?limit=1');
      const scrapeEvents = await scrapeRes.json();

      setStats({
        totalAccounts: accounts.length || 0,
        lastSync: scrapeEvents[0]?.created_at ? new Date(scrapeEvents[0].created_at) : null,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleScrapeComplete = () => {
    fetchStats();
    if (onDataRefresh) {
      onDataRefresh();
    }
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

  return (
    <>
      <Paper
        elevation={3}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 2,
          backgroundColor: theme.palette.background.paper,
          borderTop: `1px solid ${theme.palette.divider}`,
          zIndex: theme.zIndex.appBar,
        }}
      >
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setAccountsModalOpen(true)}
                size="small"
              >
                Add Account
              </Button>
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={() => setScrapeModalOpen(true)}
                size="small"
              >
                Scrape Data
              </Button>
              <Button
                variant="outlined"
                startIcon={<CategoryIcon />}
                onClick={() => setCategoryModalOpen(true)}
                size="small"
              >
                Categories
              </Button>
            </Box>
          </Grid>

          <Grid item xs={12} md={6}>
            <Box
              sx={{
                display: 'flex',
                gap: 2,
                justifyContent: { xs: 'flex-start', md: 'flex-end' },
                flexWrap: 'wrap',
              }}
            >
              <Chip
                icon={<AccountIcon />}
                label={`${stats.totalAccounts} Accounts`}
                variant="outlined"
                size="small"
              />
              <Chip
                label={`Last sync: ${formatLastSync()}`}
                variant="outlined"
                size="small"
              />
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Modals */}
      <AccountsModal
        isOpen={accountsModalOpen}
        onClose={() => {
          setAccountsModalOpen(false);
          fetchStats();
        }}
      />

      <ScrapeModal
        isOpen={scrapeModalOpen}
        onClose={() => setScrapeModalOpen(false)}
        onSuccess={handleScrapeComplete}
      />

      <CategoryManagementModal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        onCategoriesUpdated={handleScrapeComplete}
      />
    </>
  );
};

export default BottomPanel;
