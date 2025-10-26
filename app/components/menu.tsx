import * as React from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Menu from "@mui/material/Menu";
import Container from "@mui/material/Container";
import Button from "@mui/material/Button";
import Badge from "@mui/material/Badge";
import { styled } from "@mui/material/styles";
import Image from 'next/image';
import PersonIcon from '@mui/icons-material/Person';
import SettingsIcon from '@mui/icons-material/Settings';
import EditIcon from '@mui/icons-material/Edit';
import HistoryIcon from '@mui/icons-material/History';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ScrapeModal from './ScrapeModal';
import ManualModal from './ManualModal';
import DatabaseIndicator from './DatabaseIndicator';
import AccountsModal from './AccountsModal';
import CategoryManagementModal from './CategoryDashboard/components/CategoryManagementModal';
import ScrapeAuditModal from './ScrapeAuditModal';
import { useNotification } from './NotificationContext';

interface StringDictionary {
  [key: string]: string;
}

const pages: StringDictionary = {};

const StyledAppBar = styled(AppBar)({
  background: 'rgba(20, 20, 20, 0.8)',
  backdropFilter: 'blur(10px)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  boxShadow: 'none',
});

const Logo = styled(Typography)({
  fontFamily: "Assistant, sans-serif",
  fontWeight: 700,
  letterSpacing: ".3rem",
  color: "#fff",
  textDecoration: "none",
  cursor: "pointer",
  fontSize: '1.25rem',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  '&:hover': {
    color: '#3b82f6',
  },
});

const NavButton = styled(Button)({
  color: '#fff',
  textTransform: 'none',
  fontSize: '0.95rem',
  fontWeight: 500,
  padding: '6px 12px',
  borderRadius: '12px',
  margin: '0 4px',
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    transform: 'translateY(-1px)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
});

const SignOutButton = styled(Button)({
  color: '#fff',
  textTransform: 'none',
  fontSize: '0.95rem',
  fontWeight: 500,
  padding: '6px 12px',
  borderRadius: '12px',
  marginLeft: '8px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#ef4444',
    transform: 'translateY(-1px)',
    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.1)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
});

const redirectTo = (page: string) => {
  return () => (globalThis.location.href = page);
};

function ResponsiveAppBar() {
  const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(null);
  const [isScrapeModalOpen, setIsScrapeModalOpen] = React.useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = React.useState(false);
  const [isAccountsModalOpen, setIsAccountsModalOpen] = React.useState(false);
  const [isCategoryManagementOpen, setIsCategoryManagementOpen] = React.useState(false);
  const [isAuditOpen, setIsAuditOpen] = React.useState(false);
  const [accountAlerts, setAccountAlerts] = React.useState({
    noBank: false,
    noCredit: false,
    noPension: false
  });
  const [uncategorizedCount, setUncategorizedCount] = React.useState<number>(0);
  const [duplicatesCount, setDuplicatesCount] = React.useState<number>(0);
  const { showNotification} = useNotification();

  React.useEffect(() => {
    fetchAccountStatus();
    fetchUncategorizedCount();
    fetchDuplicatesCount();

    // Listen for data refresh events to update badges
    const handleDataRefresh = () => {
      fetchAccountStatus();
      fetchUncategorizedCount();
      fetchDuplicatesCount();
    };
    globalThis.addEventListener('dataRefresh', handleDataRefresh);
    
    return () => {
      globalThis.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, []);

  const fetchAccountStatus = async () => {
    try {
      // Fetch vendor credentials
      const credsResponse = await fetch('/api/credentials');
      const credentials = credsResponse.ok ? await credsResponse.json() : [];

      // Import vendor constants
      const BANK_VENDORS = new Set(['hapoalim', 'leumi', 'mizrahi', 'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union', 'discount', 'mercantile']);
      const CREDIT_CARD_VENDORS = new Set(['visaCal', 'max', 'isracard', 'amex']);

      const hasBank = credentials.some((cred: any) => BANK_VENDORS.has(cred.vendor));
      const hasCredit = credentials.some((cred: any) => CREDIT_CARD_VENDORS.has(cred.vendor));

      // Fetch investment accounts for pension check
      const investResponse = await fetch('/api/investments/accounts');
      const investAccounts = investResponse.ok ? await investResponse.json() : [];

      const PENSION_TYPES = new Set(['pension', 'provident', 'study_fund']);
      const hasPension = investAccounts.some((acc: any) => PENSION_TYPES.has(acc.account_type));

      setAccountAlerts({
        noBank: !hasBank,
        noCredit: !hasCredit,
        noPension: !hasPension
      });

      console.log('[Menu] Account alerts:', { noBank: !hasBank, noCredit: !hasCredit, noPension: !hasPension });

      // Also update duplicates count when account status changes
      // (only relevant if both bank and credit exist)
      if (hasBank && hasCredit) {
        fetchDuplicatesCount();
      } else {
        setDuplicatesCount(0);
      }
    } catch (error) {
      console.error('Error fetching account status:', error);
    }
  };

  const fetchUncategorizedCount = async () => {
    try {
      const response = await fetch('/api/analytics/unified-category?groupBy=category');
      if (response.ok) {
        const data = await response.json();
        // Count transactions where category_definition_id is null or N/A
        const uncategorized = data.filter((item: any) =>
          !item.category_definition_id || item.category === 'N/A'
        );
        const totalUncategorized = uncategorized.reduce((sum: number, item: any) =>
          sum + (item.transaction_count || 0), 0
        );
        setUncategorizedCount(totalUncategorized);
        console.log('[Menu] Uncategorized count:', totalUncategorized);
      }
    } catch (error) {
      console.error('Error fetching uncategorized count:', error);
    }
  };

  const fetchDuplicatesCount = async () => {
    try {
      const response = await fetch('/api/analytics/detect-duplicates?includeConfirmed=false');
      if (response.ok) {
        const data = await response.json();
        // Count potential duplicates that haven't been confirmed/excluded
        setDuplicatesCount(Array.isArray(data) ? data.length : 0);
        console.log('[Menu] Duplicates count:', Array.isArray(data) ? data.length : 0);
      }
    } catch (error) {
      console.error('Error fetching duplicates count:', error);
    }
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  const handleAddManualTransaction = async (transactionData: {
    name: string;
    amount: number;
    date: Date;
    type: 'income' | 'expense';
    category?: string;
    categoryDefinitionId?: number;
  }) => {
    try {
      const formattedDate = transactionData.date.toISOString().split('T')[0];
      
      const response = await fetch("/api/manual_transaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: transactionData.name,
          amount: transactionData.amount,
          date: formattedDate,
          type: transactionData.type,
          categoryDefinitionId: transactionData.categoryDefinitionId
        }),
      });

      if (response.ok) {
        setIsManualModalOpen(false);
        // Dispatch a custom event to trigger data refresh
        globalThis.dispatchEvent(new CustomEvent('dataRefresh'));
        // Refresh uncategorized count (manual transactions might need categorization)
        fetchUncategorizedCount();
      } else {
        console.error("Failed to add manual transaction");
      }
    } catch (error) {
      console.error("Error adding manual transaction:", error);
    }
  };

  const handleScrapeSuccess = () => {
    showNotification('Scraping process completed successfully!', 'success');
    // Dispatch a custom event to trigger data refresh
    globalThis.dispatchEvent(new CustomEvent('dataRefresh'));
    // Refresh all badge indicators
    fetchAccountStatus();
    fetchUncategorizedCount();
    fetchDuplicatesCount();
  };

  return (
    <>
      <StyledAppBar position="fixed">
        <Container maxWidth={false}>
          <Toolbar disableGutters variant="dense" sx={{ minHeight: '48px' }}>
            <Logo
              variant="h4"
              noWrap
              onClick={redirectTo("/")}
              sx={{
                mr: 2,
                display: { xs: "none", md: "flex" },
              }}
            >
              <Image 
                src="/logo.svg" 
                alt="ShekelSync Logo" 
                width={24} 
                height={24}
                style={{ width: 24, height: 24 }}
              />
              ShekelSync
            </Logo>

            <Box sx={{ 
              flexGrow: 1, 
              display: { xs: "none", md: "flex" },
              justifyContent: 'center',
              gap: '8px'
            }}>
              {Object.keys(pages).map((page: string) => (
                <NavButton
                  key={page}
                  onClick={redirectTo(pages[page])}
                >
                  {page}
                </NavButton>
              ))}
            </Box>
            <Box sx={{ flexGrow: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Badge
                badgeContent={duplicatesCount > 0 ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : null}
                color="warning"
                overlap="circular"
                anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
              >
                <NavButton
                  onClick={() => setIsAuditOpen(true)}
                  startIcon={<HistoryIcon />}
                >
                  Audit
                </NavButton>
              </Badge>
              <NavButton
                onClick={() => setIsManualModalOpen(true)}
                startIcon={<EditIcon />}
              >
                Manual
              </NavButton>
              <Badge
                badgeContent={uncategorizedCount > 0 ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : null}
                color="warning"
                overlap="circular"
                anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
              >
                <NavButton
                  onClick={() => setIsCategoryManagementOpen(true)}
                  startIcon={<SettingsIcon />}
                >
                  Categories
                </NavButton>
              </Badge>
              <Badge
                badgeContent={(accountAlerts.noBank || accountAlerts.noCredit || accountAlerts.noPension) ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : null}
                color="warning"
                overlap="circular"
                anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
              >
                <NavButton
                  onClick={() => setIsAccountsModalOpen(true)}
                  startIcon={<PersonIcon />}
                >
                  Accounts
                </NavButton>
              </Badge>
              <Menu
                sx={{ mt: "45px" }}
                id="menu-appbar"
                anchorEl={anchorElUser}
                anchorOrigin={{
                  vertical: "top",
                  horizontal: "right",
                }}
                keepMounted
                transformOrigin={{
                  vertical: "top",
                  horizontal: "right",
                }}
                open={Boolean(anchorElUser)}
                onClose={handleCloseUserMenu}
              />
              <DatabaseIndicator />
            </Box>
          </Toolbar>
        </Container>
      </StyledAppBar>
      <ScrapeModal
        isOpen={isScrapeModalOpen}
        onClose={() => setIsScrapeModalOpen(false)}
        onSuccess={handleScrapeSuccess}
      />
      <ManualModal
        open={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onSave={handleAddManualTransaction}
      />
      <AccountsModal
        isOpen={isAccountsModalOpen}
        onClose={() => {
          setIsAccountsModalOpen(false);
          fetchAccountStatus();
        }}
      />
      <CategoryManagementModal
        open={isCategoryManagementOpen}
        onClose={() => {
          setIsCategoryManagementOpen(false);
          fetchUncategorizedCount();
        }}
        onCategoriesUpdated={() => {
          // Dispatch a custom event to trigger data refresh
          globalThis.dispatchEvent(new CustomEvent('dataRefresh'));
          fetchUncategorizedCount();
        }}
      />
      <ScrapeAuditModal
        open={isAuditOpen}
        onClose={() => {
          setIsAuditOpen(false);
          fetchDuplicatesCount();
        }}
      />
    </>
  );
}

export default ResponsiveAppBar;
