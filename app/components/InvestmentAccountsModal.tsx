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
} from '@mui/material';
import {
  Close as CloseIcon,
  Link as LinkIcon,
  Pattern as PatternIcon,
  CheckCircle,
  Cancel,
  Refresh,
  ExpandMore,
  Delete,
  Add,
} from '@mui/icons-material';
import { useNotification } from './NotificationContext';
import { apiClient } from '@/lib/api-client';

interface InvestmentAccountsModalProps {
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

const InvestmentAccountsModal: React.FC<InvestmentAccountsModalProps> = ({
  open,
  onClose,
  onComplete,
  defaultTab = 0,
}) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleRefresh = () => {
    if (onComplete) {
      onComplete();
    }
  };

  return (
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
            ניהול חשבונות השקעה - מתקדם
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
          aria-label="investment accounts management tabs"
        >
          <Tab
            icon={<LinkIcon />}
            iconPosition="start"
            label="קישורי עסקאות"
          />
          <Tab
            icon={<PatternIcon />}
            iconPosition="start"
            label="תבניות התאמה"
          />
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 3, overflow: 'auto' }}>
        <TabPanel value={activeTab} index={0}>
          <TransactionLinksTabContent onRefresh={handleRefresh} />
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <PatternsTabContent onRefresh={handleRefresh} />
        </TabPanel>
      </DialogContent>
    </Dialog>
  );
};

// Tab 1: Transaction Links
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
      const res = await apiClient.get('/api/investments/pending-suggestions?status=pending');
      const data = res.ok ? (res.data as any) : {};
      setSuggestions(Array.isArray(data?.pending_suggestions) ? data.pending_suggestions : []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: number, action: string) => {
    setProcessing(id);
    try {
      const res = await apiClient.post('/api/investments/pending-suggestions', { id, action });
      const data = res.data as any;
      if (res.ok && data?.success) {
        showNotification(`הצעה ${action === 'approve' ? 'אושרה' : 'נדחתה'}`, 'success');
        setSuggestions(prev => prev.filter(s => s.id !== id));
        onRefresh();
      }
    } catch (error) {
      showNotification('שגיאה בעיבוד ההצעה', 'error');
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
        <Typography variant="h6">הצעות לקישור עסקאות</Typography>
        <IconButton onClick={loadSuggestions}><Refresh /></IconButton>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        כאן תוכל לראות הצעות אוטומטיות לקישור עסקאות לחשבונות השקעה קיימים.
      </Alert>

      {suggestions.length === 0 ? (
        <Alert severity="success">
          אין הצעות ממתינות. כל עסקאות ההשקעה מקושרות!
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>תאריך</TableCell>
                <TableCell>עסקה</TableCell>
                <TableCell>סכום</TableCell>
                <TableCell>חשבון מוצע</TableCell>
                <TableCell>רמת ביטחון</TableCell>
                <TableCell align="right">פעולות</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {suggestions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{new Date(s.transaction_date).toLocaleDateString('he-IL')}</TableCell>
                  <TableCell>{s.transaction_name}</TableCell>
                  <TableCell>₪{s.transaction_amount?.toLocaleString()}</TableCell>
                  <TableCell>{s.account_name}</TableCell>
                  <TableCell>
                    <Chip label={`${((s.confidence || 0) * 100).toFixed(0)}%`} size="small" color="success" />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="אשר">
                      <IconButton
                        size="small"
                        color="success"
                        onClick={() => handleAction(s.id, 'approve')}
                        disabled={processing === s.id}
                      >
                        <CheckCircle fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="דחה">
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

// Tab 2: Pattern Management
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
        apiClient.get('/api/investments/summary'),
        apiClient.get('/api/investments/patterns'),
      ]);
      const accountsData = accountsRes.ok ? (accountsRes.data as any) : {};
      const patternsData = patternsRes.ok ? (patternsRes.data as any) : {};

      const accountsList = Array.isArray(accountsData?.accounts) ? accountsData.accounts : [];
      const patternsList = Array.isArray(patternsData?.patterns) ? patternsData.patterns : [];

      const accountsWithPatterns = accountsList.map((acc: any) => ({
        ...acc,
        patterns: patternsList.filter((p: any) => p.account_id === acc.id),
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
      showNotification('נא להזין תבנית', 'warning');
      return;
    }

    try {
      const res = await apiClient.post('/api/investments/patterns', {
        account_id: accountId,
        pattern: pattern.trim(),
        pattern_type: 'substring',
      });
      const data = res.data as any;
      if (res.ok && data?.success) {
        showNotification('תבנית נוספה בהצלחה', 'success');
        setNewPattern({ ...newPattern, [accountId]: '' });
        loadPatterns();
        onRefresh();
      }
    } catch (error) {
      showNotification('שגיאה בהוספת תבנית', 'error');
    }
  };

  const handleDeletePattern = async (patternId: number) => {
    if (!confirm('האם למחוק תבנית זו?')) return;

    try {
      const res = await apiClient.delete(`/api/investments/patterns?id=${patternId}`);
      const data = res.data as any;
      if (res.ok && data?.success) {
        showNotification('תבנית נמחקה', 'success');
        loadPatterns();
        onRefresh();
      }
    } catch (error) {
      showNotification('שגיאה במחיקת תבנית', 'error');
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h6" mb={2}>כללי התאמת תבניות</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        תבניות מגדירות אילו עסקאות שייכות לאילו חשבונות. השתמש ב-<code>%</code> כתו כללי.
        <br />
        דוגמה: <code>%פיקדון%</code> תתאים לכל עסקה המכילה את המילה "פיקדון"
      </Alert>

      {accounts.length === 0 ? (
        <Alert severity="warning">
          לא נמצאו חשבונות השקעה. צור חשבון השקעה ראשון כדי להוסיף תבניות.
        </Alert>
      ) : (
        accounts.map((account) => (
          <Accordion key={account.id}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Box display="flex" alignItems="center" gap={2}>
                <Typography fontWeight="bold">{account.account_name}</Typography>
                <Chip label={account.account_type} size="small" />
                <Chip label={`${account.patterns.length} תבניות`} size="small" color="primary" />
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
                    placeholder="הזן תבנית (למשל: %פיקדון%)"
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
                    הוסף
                  </Button>
                </Box>
              </Box>
            </AccordionDetails>
          </Accordion>
        ))
      )}
    </Box>
  );
};

export default InvestmentAccountsModal;
