import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Collapse,
  CircularProgress,
  useTheme,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Card,
  Grid,
  Alert,
  Divider,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Timeline as TimelineIcon,
  Close as CloseIcon,
  AccountBalance as AccountIcon,
  School as SchoolIcon,
  ShowChart as StockIcon,
  CurrencyBitcoin as CryptoIcon,
  Savings as PiggyBankIcon,
  CreditCard as CardIcon,
  Dashboard as DashboardIcon,
  AttachMoney as MoneyIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';
import type { PikadonAutoDetectResponse, PikadonAutoSetupResponse } from '@/types/investments';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioSummary, PortfolioHistoryPoint, InvestmentAccountSummary } from '@renderer/types/investments';
import { useInvestmentsFilters } from '../InvestmentsFiltersContext';

interface PortfolioBreakdownSectionProps {
  portfolioData: PortfolioSummary;
  accountHistories: Record<number, PortfolioHistoryPoint[]>;
  historyLoading: boolean;
}

const PortfolioBreakdownSection: React.FC<PortfolioBreakdownSectionProps> = ({
  portfolioData,
  accountHistories,
  historyLoading,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { historyTimeRange } = useInvestmentsFilters();
  const [expandedAccounts, setExpandedAccounts] = useState<Record<number, boolean>>({});

  // Pikadon auto-setup state
  const [detectDialogOpen, setDetectDialogOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState<PikadonAutoDetectResponse | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<number | ''>('');
  const [settingUp, setSettingUp] = useState(false);
  const [setupResult, setSetupResult] = useState<PikadonAutoSetupResponse | null>(null);

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const toggleAccountChart = (accountId: number) => {
    setExpandedAccounts((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
  };

  // Pikadon auto-setup functions
  const handleAutoDetect = async () => {
    setDetecting(true);
    setDetectionResult(null);
    setSetupResult(null);
    try {
      const response = await apiClient.get('/api/investments/pikadon/auto-detect');
      if (response.ok) {
        setDetectionResult(response.data as PikadonAutoDetectResponse);
      }
    } catch (err) {
      console.error('Error detecting pikadon:', err);
    } finally {
      setDetecting(false);
    }
  };

  const openDetectDialog = async (accountId: number) => {
    setSelectedAccount(accountId);
    setSetupResult(null);
    setDetectDialogOpen(true);
    await handleAutoDetect();
  };

  const handleAutoSetup = async () => {
    if (!selectedAccount) return;

    setSettingUp(true);
    try {
      const response = await apiClient.post('/api/investments/pikadon/auto-setup', {
        account_id: selectedAccount,
      });

      if (response.ok) {
        setSetupResult(response.data as PikadonAutoSetupResponse);
        setDetectionResult(null);
      }
    } catch (err) {
      console.error('Error auto-setting up pikadon:', err);
    } finally {
      setSettingUp(false);
    }
  };

  const handleCloseDialog = () => {
    setDetectDialogOpen(false);
    setDetectionResult(null);
    setSetupResult(null);
    setSelectedAccount('');
  };

  const getAccountTypeIcon = (type: string, investmentCategory?: string) => {
    const iconProps = {
      fontSize: 'medium' as const,
      sx: {
        color:
          investmentCategory === 'liquid'
            ? 'info.main'
            : investmentCategory === 'restricted'
            ? 'warning.main'
            : 'primary.main',
      },
    };

    switch (type) {
      case 'pension':
        return <AccountIcon {...iconProps} />;
      case 'provident':
      case 'study_fund':
        return <SchoolIcon {...iconProps} />;
      case 'brokerage':
        return <StockIcon {...iconProps} />;
      case 'crypto':
        return <CryptoIcon {...iconProps} />;
      case 'savings':
        return <PiggyBankIcon {...iconProps} />;
      case 'mutual_fund':
        return <TimelineIcon {...iconProps} />;
      case 'bonds':
        return <CardIcon {...iconProps} />;
      case 'real_estate':
        return <DashboardIcon {...iconProps} />;
      default:
        return <MoneyIcon {...iconProps} />;
    }
  };

  const renderSparkline = (history: PortfolioHistoryPoint[]) => {
    if (!history || history.length === 0) {
      return null;
    }

    const data = history.map((h) => ({
      date: h.date,
      value: h.currentValue,
    }));

    return (
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  const renderFullChart = (history: PortfolioHistoryPoint[]) => {
    if (!history || history.length === 0) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No historical data available
          </Typography>
        </Box>
      );
    }

    const data = history.map((h) => ({
      date: new Date(h.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: history.length > 90 ? '2-digit' : undefined,
      }),
      'Current Value': h.currentValue,
      'Cost Basis': h.costBasis,
      fullDate: h.date,
    }));

    return (
      <Box sx={{ p: 2, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[300]}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              angle={history.length > 30 ? -45 : 0}
              textAnchor={history.length > 30 ? 'end' : 'middle'}
              height={history.length > 30 ? 60 : 30}
              stroke={theme.palette.text.disabled}
            />
            <YAxis
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              tickFormatter={(value: number) => (maskAmounts ? '***' : `₪${(value / 1000).toFixed(0)}k`)}
              stroke={theme.palette.text.disabled}
            />
            <RechartsTooltip
              formatter={(value: number | string) =>
                typeof value === 'number' ? formatCurrencyValue(value) : value
              }
              labelStyle={{ color: theme.palette.text.primary }}
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: theme.shape.borderRadius,
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="Current Value"
              stroke={theme.palette.primary.main}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="Cost Basis"
              stroke={theme.palette.success.main}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  if (!portfolioData.breakdown || portfolioData.breakdown.length === 0) {
    return null;
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Portfolio Breakdown
      </Typography>

      {portfolioData.breakdown.map((group, index) => (
        <Accordion key={index} sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{
              '&:hover': { bgcolor: 'action.hover' },
              minHeight: 56,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, justifyContent: 'space-between', pr: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: theme.palette.mode === 'dark' ? 'grey.800' : 'primary.light',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'primary.main',
                  }}
                >
                  {getAccountTypeIcon(group.type)}
                </Box>
                <Box>
                  <Typography fontWeight="medium">{group.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {group.count} account{group.count !== 1 ? 's' : ''}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="h6" fontWeight="bold">
                  {formatCurrencyValue(group.totalValue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {group.percentage.toFixed(1)}% •
                  {group.totalCost > 0 && (
                    <span
                      style={{
                        color:
                          group.totalValue - group.totalCost >= 0
                            ? theme.palette.success.main
                            : theme.palette.error.main,
                        fontWeight: 500,
                        marginLeft: 4,
                      }}
                    >
                      {(((group.totalValue - group.totalCost) / group.totalCost) * 100).toFixed(1)}% ROI
                    </span>
                  )}
                </Typography>
              </Box>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <List disablePadding>
              {(group.accounts ?? []).map((account: InvestmentAccountSummary, accIndex: number) => {
                const accountHistory = accountHistories[account.id] || [];
                const hasHistory = accountHistory.length > 0;
                const isExpanded = expandedAccounts[account.id] || false;

                return (
                  <React.Fragment key={accIndex}>
                    <ListItem
                      sx={{
                        py: 1.5,
                        px: 2,
                        bgcolor: accIndex % 2 === 0 ? 'transparent' : 'action.hover',
                        borderRadius: 1,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <ListItemText
                          primary={
                            <Typography variant="body2" fontWeight="medium">
                              {account.account_name}
                            </Typography>
                          }
                          secondary={
                            <Box component="span">
                              {account.institution && `${account.institution} • `}
                              {account.as_of_date &&
                                `Updated ${new Date(account.as_of_date).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}`}
                              {account.assets && account.assets.length > 0 && ` • ${account.assets.length} holdings`}
                            </Box>
                          }
                        />

                        {/* Mini sparkline */}
                        {hasHistory && !isExpanded && (
                          <Box
                            sx={{
                              width: 120,
                              height: 40,
                              mx: 2,
                              cursor: 'pointer',
                              '&:hover': { opacity: 0.7 },
                            }}
                            onClick={() => toggleAccountChart(account.id)}
                          >
                            {renderSparkline(accountHistory)}
                          </Box>
                        )}

                        <Box sx={{ textAlign: 'right', ml: 2, minWidth: 120 }}>
                          <Typography variant="body1" fontWeight="600">
                            {formatCurrencyValue(account.current_value || 0)}
                          </Typography>
                          {account.cost_basis > 0 && (
                            <Typography
                              variant="caption"
                              sx={{
                                color:
                                  account.current_value - account.cost_basis >= 0
                                    ? 'success.main'
                                    : 'error.main',
                                fontWeight: 500,
                              }}
                            >
                              {account.current_value - account.cost_basis >= 0 ? '+' : ''}
                              {(((account.current_value - account.cost_basis) / account.cost_basis) * 100).toFixed(1)}%
                            </Typography>
                          )}
                        </Box>

                        {/* Chart toggle button */}
                        {hasHistory && (
                          <IconButton
                            size="small"
                            onClick={() => toggleAccountChart(account.id)}
                            sx={{ ml: 1 }}
                            aria-label="Toggle performance chart"
                          >
                            <TimelineIcon fontSize="small" />
                          </IconButton>
                        )}

                        {/* Pikadon auto-setup button for savings accounts */}
                        {account.account_type === 'savings' && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AddIcon />}
                            onClick={() => openDetectDialog(account.id)}
                            sx={{ ml: 1, textTransform: 'none', fontSize: '0.75rem' }}
                          >
                            Setup Pikadon
                          </Button>
                        )}
                      </Box>

                      {/* Expandable chart */}
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider', width: '100%' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="subtitle2" fontWeight="medium">
                              Performance Over Time ({historyTimeRange})
                            </Typography>
                            <IconButton
                              size="small"
                              onClick={() => toggleAccountChart(account.id)}
                              aria-label="Close chart"
                            >
                              <CloseIcon fontSize="small" />
                            </IconButton>
                          </Box>
                          {historyLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                              <CircularProgress size={30} />
                            </Box>
                          ) : (
                            renderFullChart(accountHistory)
                          )}
                        </Box>
                      </Collapse>
                    </ListItem>
                    </React.Fragment>
                  );
                })}
              </List>
            </AccordionDetails>
          </Accordion>
        ))}

      {/* Pikadon Auto-Setup Dialog */}
      <Dialog
        open={detectDialogOpen}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SearchIcon />
            Auto-Setup Pikadon (פיקדונות)
          </Box>
        </DialogTitle>
        <DialogContent>
          {detecting ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
              <Typography sx={{ ml: 2 }}>Analyzing transactions...</Typography>
            </Box>
          ) : setupResult ? (
            // Show setup results
            <Box>
              <Alert severity="success" sx={{ mb: 3 }}>
                Successfully created {setupResult.created} pikadon entries!
              </Alert>

              {setupResult.totals && (
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Total Interest Earned
                      </Typography>
                      <Typography variant="h6" color="success.main">
                        {formatCurrencyValue(setupResult.totals.total_interest_earned)}
                      </Typography>
                    </Card>
                  </Grid>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Tax Paid
                      </Typography>
                      <Typography variant="h6" color="error.main">
                        {formatCurrencyValue(setupResult.totals.total_tax_paid)}
                      </Typography>
                    </Card>
                  </Grid>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Matured Deposits
                      </Typography>
                      <Typography variant="h6">
                        {setupResult.totals.maturity_count}
                      </Typography>
                    </Card>
                  </Grid>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Active Principal
                      </Typography>
                      <Typography variant="h6" color="primary.main">
                        {formatCurrencyValue(setupResult.totals.total_active_principal)}
                      </Typography>
                    </Card>
                  </Grid>
                </Grid>
              )}

              {setupResult.details && setupResult.details.length > 0 && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Created Entries:
                  </Typography>
                  <List dense>
                    {setupResult.details.map((item, idx) => (
                      <ListItem key={idx} sx={{ py: 0.5 }}>
                        <ListItemText
                          primary={`${formatCurrencyValue(item.amount)} - ${item.type.replace('_', ' ')}`}
                          secondary={`${formatDate(item.date)}${item.interest ? ` • Interest: ${formatCurrencyValue(item.interest)}` : ''}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}
            </Box>
          ) : detectionResult ? (
            // Show detection results with one-click setup
            <Box>
              {detectionResult.chains.length === 0 && detectionResult.active_deposits.length === 0 ? (
                <Alert severity="info">
                  No pikadon transactions found. Make sure your bank transactions contain pikadon keywords (פיקדון, פקדון, פירעון, רווח, etc.)
                </Alert>
              ) : (
                <>
                  <Alert severity="info" sx={{ mb: 3 }}>
                    Found {detectionResult.chains.length} completed maturity chains and {detectionResult.active_deposits.length} active deposits.
                  </Alert>

                  {/* Summary Stats */}
                  <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={6}>
                      <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          Total Interest Earned
                        </Typography>
                        <Typography variant="h6" color="success.main">
                          {formatCurrencyValue(detectionResult.totals.total_interest_earned)}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          Tax Paid
                        </Typography>
                        <Typography variant="h6" color="error.main">
                          {formatCurrencyValue(detectionResult.totals.total_tax_paid)}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          Net Gain
                        </Typography>
                        <Typography variant="h6" color="primary.main">
                          {formatCurrencyValue(detectionResult.totals.total_interest_earned - detectionResult.totals.total_tax_paid)}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          Active Principal
                        </Typography>
                        <Typography variant="h6">
                          {formatCurrencyValue(detectionResult.totals.total_active_principal)}
                        </Typography>
                      </Card>
                    </Grid>
                  </Grid>

                  {/* Maturity Events Preview */}
                  {detectionResult.chains.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>
                        Maturity Chains:
                      </Typography>
                      {detectionResult.chains.slice(0, 3).map((chain, idx) => (
                        <Card key={idx} variant="outlined" sx={{ mb: 1, p: 1.5 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box>
                              <Typography variant="body2" fontWeight="medium">
                                {formatCurrencyValue(chain.start_deposit.amount)} → {formatCurrencyValue(chain.start_deposit.amount + chain.interest_earned)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(chain.start_deposit.date)} → {formatDate(chain.maturity_event.date)}
                              </Typography>
                            </Box>
                            <Box sx={{ textAlign: 'right' }}>
                              <Typography variant="body2" color="success.main">
                                +{formatCurrencyValue(chain.net_gain)}
                              </Typography>
                              {chain.rollover_deposit && (
                                <Typography variant="caption" color="info.main">
                                  Rolled over
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        </Card>
                      ))}
                      {detectionResult.chains.length > 3 && (
                        <Typography variant="caption" color="text.secondary">
                          ...and {detectionResult.chains.length - 3} more
                        </Typography>
                      )}
                    </Box>
                  )}

                  <Divider sx={{ my: 2 }} />

                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    startIcon={settingUp ? <CircularProgress size={20} color="inherit" /> : <AddIcon />}
                    onClick={handleAutoSetup}
                    disabled={settingUp}
                    sx={{ py: 1.5 }}
                  >
                    {settingUp ? 'Setting Up...' : `Setup All ${detectionResult.chains.length + detectionResult.active_deposits.length} Pikadon Entries`}
                  </Button>
                </>
              )}
            </Box>
          ) : (
            <Alert severity="info">
              Detecting pikadon transactions...
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Close</Button>
          {!setupResult && (
            <Button
              variant="outlined"
              onClick={handleAutoDetect}
              disabled={detecting}
              startIcon={detecting ? <CircularProgress size={16} /> : <RefreshIcon />}
            >
              Re-detect
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default PortfolioBreakdownSection;
