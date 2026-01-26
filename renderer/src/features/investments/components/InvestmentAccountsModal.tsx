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
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { apiClient } from '@/lib/api-client';
import InstitutionBadge from '@renderer/shared/components/InstitutionBadge';
import { useTranslation } from 'react-i18next';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';

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
  const { t } = useTranslation('translation', { keyPrefix: 'investmentAccountsModal' });
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>(undefined);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleLicenseError = (reason?: string) => {
    setLicenseAlertReason(reason);
    setLicenseAlertOpen(true);
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
        sx: { 
          height: '90vh', 
          maxHeight: '900px',
          borderRadius: '16px',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 20px 60px rgba(0, 0, 0, 0.7)'
            : '0 20px 60px rgba(0, 0, 0, 0.15)',
        }
      }}
      slotProps={{
        backdrop: {
          sx: {
            backdropFilter: 'blur(4px)',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
          }
        }
      }}
    >
      <DialogTitle sx={{
        background: (theme) => theme.palette.mode === 'dark'
          ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)'
          : 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(139, 92, 246, 0.02) 100%)',
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        pb: 2,
      }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h5" fontWeight="bold">
            {t('title')}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <Box sx={{ 
        borderBottom: 1, 
        borderColor: 'divider', 
        px: 3,
        background: (theme) => theme.palette.mode === 'dark'
          ? 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 100%)'
          : 'linear-gradient(180deg, rgba(0,0,0,0.02) 0%, transparent 100%)',
        boxShadow: (theme) => theme.palette.mode === 'dark'
          ? '0 2px 8px rgba(0, 0, 0, 0.2)'
          : '0 1px 4px rgba(0, 0, 0, 0.05)',
      }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          aria-label={t('aria.tabs')}
          sx={{
            '& .MuiTab-root': {
              transition: 'all 0.2s ease-in-out',
              fontWeight: 500,
              '&:hover': {
                backgroundColor: 'action.hover',
              },
            },
            '& .Mui-selected': {
              fontWeight: 700,
            },
          }}
        >
          <Tab
            icon={<LinkIcon />}
            iconPosition="start"
            label={t('tabs.links')}
          />
          <Tab
            icon={<PatternIcon />}
            iconPosition="start"
            label={t('tabs.patterns')}
          />
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 3, overflow: 'auto' }}>
        <TabPanel value={activeTab} index={0}>
          <TransactionLinksTabContent onRefresh={handleRefresh} onLicenseError={handleLicenseError} />
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <PatternsTabContent onRefresh={handleRefresh} onLicenseError={handleLicenseError} />
        </TabPanel>
      </DialogContent>

      {/* License Read-Only Alert */}
      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </Dialog>
  );
};

// Tab 1: Transaction Links
const TransactionLinksTabContent: React.FC<{ onRefresh: () => void; onLicenseError?: (reason?: string) => void }> = ({ onRefresh, onLicenseError }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentAccountsModal.links' });
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
      if (!res.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(data);
        if (licenseCheck.isReadOnly) {
          onLicenseError?.(licenseCheck.reason);
          return;
        }
      }
      if (res.ok && data?.success) {
        showNotification(
          action === 'approve' ? t('notifications.approved') : t('notifications.rejected'),
          'success'
        );
        setSuggestions(prev => prev.filter(s => s.id !== id));
        onRefresh();
      }
    } catch {
      showNotification(t('notifications.error'), 'error');
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
        <Typography variant="h6" fontWeight={700}>{t('title')}</Typography>
        <IconButton 
          onClick={loadSuggestions} 
          aria-label={t('aria.refresh')}
          sx={{
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              transform: 'rotate(90deg)',
              backgroundColor: 'action.hover',
            },
          }}
        >
          <Refresh />
        </IconButton>
      </Box>

      <Alert 
        severity="info" 
        sx={{ 
          mb: 2,
          borderRadius: '12px',
          border: (theme) => `1px solid ${theme.palette.info.main}`,
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 2px 8px rgba(33, 150, 243, 0.2)'
            : '0 2px 8px rgba(33, 150, 243, 0.1)',
        }}
      >
        {t('description')}
      </Alert>

      {suggestions.length === 0 ? (
        <Alert 
          severity="success"
          sx={{
            borderRadius: '12px',
            border: (theme) => `1px solid ${theme.palette.success.main}`,
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 2px 8px rgba(76, 175, 80, 0.2)'
              : '0 2px 8px rgba(76, 175, 80, 0.1)',
          }}
        >
          {t('empty')}
        </Alert>
      ) : (
        <TableContainer 
          component={Paper} 
          variant="outlined"
          sx={{
            borderRadius: '12px',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 4px 16px rgba(0, 0, 0, 0.4)'
              : '0 2px 12px rgba(0, 0, 0, 0.08)',
            border: (theme) => `1px solid ${theme.palette.divider}`,
            overflow: 'hidden',
          }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('table.date')}</TableCell>
                <TableCell>{t('table.transaction')}</TableCell>
                <TableCell>{t('table.amount')}</TableCell>
                <TableCell>{t('table.account')}</TableCell>
                <TableCell>{t('table.confidence')}</TableCell>
                <TableCell align="right">{t('table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {suggestions.map((s) => (
                <TableRow 
                  key={s.id}
                  sx={{
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': {
                      backgroundColor: (theme) => theme.palette.mode === 'dark' 
                        ? 'rgba(255, 255, 255, 0.08)' 
                        : 'rgba(0, 0, 0, 0.04)',
                      transform: 'scale(1.002)',
                      boxShadow: (theme) => theme.palette.mode === 'dark'
                        ? '0 2px 8px rgba(0, 0, 0, 0.4)'
                        : '0 2px 8px rgba(0, 0, 0, 0.1)',
                    },
                  }}
                >
                  <TableCell>{new Date(s.transaction_date).toLocaleDateString(undefined)}</TableCell>
                  <TableCell>{s.transaction_name}</TableCell>
                  <TableCell>₪{s.transaction_amount?.toLocaleString()}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Typography variant="body2">{s.account_name}</Typography>
                      {s.institution && (
                        <InstitutionBadge institution={s.institution} size="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip label={`${((s.confidence || 0) * 100).toFixed(0)}%`} size="small" color="success" />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('table.approve')}>
                      <IconButton
                        size="small"
                        color="success"
                        onClick={() => handleAction(s.id, 'approve')}
                        disabled={processing === s.id}
                      >
                        <CheckCircle fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('table.reject')}>
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
const PatternsTabContent: React.FC<{ onRefresh: () => void; onLicenseError?: (reason?: string) => void }> = ({ onRefresh, onLicenseError }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentAccountsModal.patterns' });
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
      showNotification(t('notifications.missingPattern'), 'warning');
      return;
    }

    try {
      const res = await apiClient.post('/api/investments/patterns', {
        account_id: accountId,
        pattern: pattern.trim(),
        pattern_type: 'substring',
      });
      const data = res.data as any;
      if (!res.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(data);
        if (licenseCheck.isReadOnly) {
          onLicenseError?.(licenseCheck.reason);
          return;
        }
      }
      if (res.ok && data?.success) {
        showNotification(t('notifications.added'), 'success');
        setNewPattern({ ...newPattern, [accountId]: '' });
        loadPatterns();
        onRefresh();
      }
    } catch {
      showNotification(t('notifications.addError'), 'error');
    }
  };

  const handleDeletePattern = async (patternId: number) => {
    if (!confirm(t('confirmDelete'))) return;

    try {
      const res = await apiClient.delete(`/api/investments/patterns?id=${patternId}`);
      const data = res.data as any;
      if (!res.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(data);
        if (licenseCheck.isReadOnly) {
          onLicenseError?.(licenseCheck.reason);
          return;
        }
      }
      if (res.ok && data?.success) {
        showNotification(t('notifications.deleted'), 'success');
        loadPatterns();
        onRefresh();
      }
    } catch {
      showNotification(t('notifications.deleteError'), 'error');
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h6" mb={2} fontWeight={700}>{t('title')}</Typography>
      <Alert 
        severity="info" 
        sx={{ 
          mb: 2,
          borderRadius: '12px',
          border: (theme) => `1px solid ${theme.palette.info.main}`,
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 2px 8px rgba(33, 150, 243, 0.2)'
            : '0 2px 8px rgba(33, 150, 243, 0.1)',
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: t('description') }} />
      </Alert>

      {accounts.length === 0 ? (
        <Alert 
          severity="warning"
          sx={{
            borderRadius: '12px',
            border: (theme) => `1px solid ${theme.palette.warning.main}`,
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 2px 8px rgba(255, 152, 0, 0.2)'
              : '0 2px 8px rgba(255, 152, 0, 0.1)',
          }}
        >
          {t('empty')}
        </Alert>
      ) : (
        accounts.map((account) => (
          <Accordion 
            key={account.id}
            sx={{
              mb: 2,
              borderRadius: '12px !important',
              boxShadow: (theme) => theme.palette.mode === 'dark'
                ? '0 2px 8px rgba(0, 0, 0, 0.3)'
                : '0 2px 8px rgba(0, 0, 0, 0.06)',
              border: (theme) => `1px solid ${theme.palette.divider}`,
              transition: 'all 0.3s ease-in-out',
              '&:hover': {
                boxShadow: (theme) => theme.palette.mode === 'dark'
                  ? '0 4px 16px rgba(0, 0, 0, 0.4)'
                  : '0 4px 16px rgba(0, 0, 0, 0.1)',
              },
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary 
              expandIcon={<ExpandMore />}
              sx={{
                borderRadius: '12px 12px 0 0',
                minHeight: '64px',
                '&.Mui-expanded': {
                  minHeight: '64px',
                  borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                },
                '& .MuiAccordionSummary-content': {
                  margin: '16px 0',
                },
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <Typography fontWeight="bold">{account.account_name}</Typography>
                <Chip label={account.account_type} size="small" />
                <Chip label={t('chipCount', { count: account.patterns.length })} size="small" color="primary" />
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Box>
                {account.patterns.length > 0 && (
                  <Table 
                    size="small" 
                    sx={{ 
                      mb: 2,
                      '& .MuiTableRow-root': {
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': {
                          backgroundColor: (theme) => theme.palette.mode === 'dark' 
                            ? 'rgba(255, 255, 255, 0.05)' 
                            : 'rgba(0, 0, 0, 0.02)',
                        },
                      },
                    }}
                  >
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
                    {t('actions.add')}
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
