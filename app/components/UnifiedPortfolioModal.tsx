import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Tabs,
  Tab,
  IconButton,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  CircularProgress,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  Close as CloseIcon,
  AccountBalance as AccountIcon,
  Link as LinkIcon,
  Pattern as PatternIcon,
  CheckCircle,
  Cancel,
  RemoveCircle,
  Refresh,
  ExpandMore,
  Delete,
  Add,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useNotification } from './NotificationContext';

interface UnifiedPortfolioModalProps {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
  defaultTab?: number;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

const UnifiedPortfolioModal: React.FC<UnifiedPortfolioModalProps> = ({
  open,
  onClose,
  onComplete,
  defaultTab = 0,
}) => {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const { showNotification } = useNotification();

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleRefresh = () => {
    if (onComplete) {
      onComplete();
    }
  };

  const handleOpenPortfolioSetup = () => {
    setSetupModalOpen(true);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: { height: '90vh', maxHeight: '900px' }
        }}
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h5" fontWeight="bold">
              Portfolio Management
            </Typography>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            aria-label="portfolio management tabs"
          >
            <Tab
              icon={<AccountIcon />}
              iconPosition="start"
              label="Accounts"
            />
            <Tab
              icon={<LinkIcon />}
              iconPosition="start"
              label="Transaction Links"
            />
            <Tab
              icon={<PatternIcon />}
              iconPosition="start"
              label="Patterns"
            />
          </Tabs>
        </Box>

        <DialogContent sx={{ p: 3, overflow: 'auto' }}>
          <TabPanel value={activeTab} index={0}>
            <AccountsTabContent 
              onOpenSetup={handleOpenPortfolioSetup}
              onRefresh={handleRefresh}
            />
          </TabPanel>

          <TabPanel value={activeTab} index={1}>
            <TransactionLinksTabContent onRefresh={handleRefresh} />
          </TabPanel>

          <TabPanel value={activeTab} index={2}>
            <PatternsTabContent onRefresh={handleRefresh} />
          </TabPanel>
        </DialogContent>
      </Dialog>

      {/* Keep the full Portfolio Setup modal separate - it's complex */}
      {setupModalOpen && (
        <PortfolioSetupModalWrapper
          open={setupModalOpen}
          onClose={() => setSetupModalOpen(false)}
          onComplete={handleRefresh}
        />
      )}
    </>
  );
};

// Lazy load the complex setup modal
const PortfolioSetupModalWrapper = (props: any) => {
  const PortfolioSetupModal = require('./PortfolioSetupModal').default;
  return <PortfolioSetupModal {...props} />;
};

// Tab 1: Accounts Overview
const AccountsTabContent: React.FC<{ onOpenSetup: () => void; onRefresh: () => void }> = ({ 
  onOpenSetup,
  onRefresh 
}) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const res = await fetch('/api/investments/summary');
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (error) {
      console.error('Error loading accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6">Investment Accounts</Typography>
        <Button
          variant="contained"
          startIcon={<SettingsIcon />}
          onClick={onOpenSetup}
        >
          Full Setup Wizard
        </Button>
      </Box>

      {accounts.length === 0 ? (
        <Alert severity="info">
          No accounts set up yet. Click "Full Setup Wizard" to add your first investment account.
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Account Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Institution</TableCell>
                <TableCell>Current Value</TableCell>
                <TableCell>Cost Basis</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>{account.account_name}</TableCell>
                  <TableCell>
                    <Chip label={account.account_type} size="small" />
                  </TableCell>
                  <TableCell>{account.institution || '-'}</TableCell>
                  <TableCell>
                    {account.current_value ? `₪${account.current_value.toLocaleString()}` : '-'}
                  </TableCell>
                  <TableCell>
                    {account.cost_basis ? `₪${account.cost_basis.toLocaleString()}` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

// Tab 2: Transaction Links
const TransactionLinksTabContent: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);
  const { showNotification } = useNotification();

  useEffect(() => {
    loadSuggestions();
  }, []);

  const loadSuggestions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/investments/pending-suggestions?status=pending');
      const data = await res.json();
      setSuggestions(data.pending_suggestions || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: number, action: string) => {
    setProcessing(id);
    try {
      const res = await fetch('/api/investments/pending-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action })
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Suggestion ${action}d`, 'success');
        setSuggestions(prev => prev.filter(s => s.id !== id));
        onRefresh();
      }
    } catch (error) {
      showNotification('Failed to process suggestion', 'error');
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6">Pending Transaction Suggestions</Typography>
        <IconButton onClick={loadSuggestions}><Refresh /></IconButton>
      </Box>

      {suggestions.length === 0 ? (
        <Alert severity="success">
          No pending suggestions. All investment transactions are linked!
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Transaction</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Suggested Account</TableCell>
                <TableCell>Confidence</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {suggestions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{new Date(s.transaction_date).toLocaleDateString()}</TableCell>
                  <TableCell>{s.transaction_name}</TableCell>
                  <TableCell>₪{s.transaction_amount.toLocaleString()}</TableCell>
                  <TableCell>{s.account_name}</TableCell>
                  <TableCell>
                    <Chip label={`${(s.confidence * 100).toFixed(0)}%`} size="small" color="success" />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Approve">
                      <IconButton
                        size="small"
                        color="success"
                        onClick={() => handleAction(s.id, 'approve')}
                        disabled={processing === s.id}
                      >
                        <CheckCircle fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Reject">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleAction(s.id, 'reject')}
                        disabled={processing === s.id}
                      >
                        <Cancel fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

// Tab 3: Pattern Management
const PatternsTabContent: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPattern, setNewPattern] = useState<{ [key: number]: string }>({});
  const { showNotification } = useNotification();

  useEffect(() => {
    loadPatterns();
  }, []);

  const loadPatterns = async () => {
    setLoading(true);
    try {
      const [accountsRes, patternsRes] = await Promise.all([
        fetch('/api/investments/summary'),
        fetch('/api/investments/patterns')
      ]);
      const accountsData = await accountsRes.json();
      const patternsData = await patternsRes.json();

      const accountsWithPatterns = accountsData.accounts.map((acc: any) => ({
        ...acc,
        patterns: patternsData.patterns.filter((p: any) => p.account_id === acc.id)
      }));

      setAccounts(accountsWithPatterns);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPattern = async (accountId: number) => {
    const pattern = newPattern[accountId];
    if (!pattern?.trim()) {
      showNotification('Please enter a pattern', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/investments/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          pattern: pattern.trim(),
          pattern_type: 'substring'
        })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('Pattern added', 'success');
        setNewPattern({ ...newPattern, [accountId]: '' });
        loadPatterns();
        onRefresh();
      }
    } catch (error) {
      showNotification('Failed to add pattern', 'error');
    }
  };

  const handleDeletePattern = async (patternId: number) => {
    if (!confirm('Delete this pattern?')) return;

    try {
      const res = await fetch(`/api/investments/patterns?id=${patternId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        showNotification('Pattern deleted', 'success');
        loadPatterns();
        onRefresh();
      }
    } catch (error) {
      showNotification('Failed to delete pattern', 'error');
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h6" mb={2}>Pattern Matching Rules</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Patterns define which transactions belong to which accounts. Use <code>%</code> as wildcard.
        Example: <code>%פיקדון%</code>
      </Alert>

      {accounts.map((account) => (
        <Accordion key={account.id}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box display="flex" alignItems="center" gap={2}>
              <Typography fontWeight="bold">{account.account_name}</Typography>
              <Chip label={account.account_type} size="small" />
              <Chip label={`${account.patterns.length} patterns`} size="small" color="primary" />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              {account.patterns.length > 0 && (
                <Table size="small" sx={{ mb: 2 }}>
                  <TableBody>
                    {account.patterns.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{p.pattern}</TableCell>
                        <TableCell><Chip label={p.pattern_type} size="small" /></TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeletePattern(p.id)}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <Box display="flex" gap={1}>
                <TextField
                  size="small"
                  placeholder="Enter pattern (e.g., %פיקדון%)"
                  value={newPattern[account.id] || ''}
                  onChange={(e) => setNewPattern({ ...newPattern, [account.id]: e.target.value })}
                  fullWidth
                  sx={{ fontFamily: 'monospace' }}
                />
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={() => handleAddPattern(account.id)}
                  size="small"
                >
                  Add
                </Button>
              </Box>
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
};

export default UnifiedPortfolioModal;
