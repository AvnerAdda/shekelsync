import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Collapse,
  Grid,
  Tooltip,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import {
  Autorenew as RecurringIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CheckCircle as CheckIcon,
  Cancel as CancelIcon,
  Star as StarIcon,
  MoreVert as MoreIcon,
  Lightbulb as LightbulbIcon,
  TrendingUp as TrendingUpIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../../contexts/FinancePrivacyContext';

interface RecurringPattern {
  merchant_pattern: string;
  merchant_display_name: string;
  category: string;
  parent_category: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  transaction_count: number;
  average_amount: number;
  amount_variance: number;
  monthly_equivalent: number;
  confidence: number;
  is_subscription: boolean;
  first_transaction: string;
  last_transaction: string;
  next_expected_date: string;
  average_interval_days: number;
  user_status: 'active' | 'marked_cancel' | 'essential' | 'reviewed';
  optimization_suggestions: OptimizationSuggestion[];
}

interface OptimizationSuggestion {
  type: string;
  title: string;
  description: string;
  potential_savings: number;
  action: string;
}

interface RecurringTransactionManagerProps {
  months?: number;
}

const RecurringTransactionManager: React.FC<RecurringTransactionManagerProps> = ({ months = 6 }) => {
  const [patterns, setPatterns] = useState<RecurringPattern[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [anchorEl, setAnchorEl] = useState<{ [key: string]: HTMLElement | null }>({});
  const [selectedPattern, setSelectedPattern] = useState<RecurringPattern | null>(null);
  const [suggestionsDialogOpen, setSuggestionsDialogOpen] = useState(false);
  const { formatCurrency } = useFinancePrivacy();

  useEffect(() => {
    fetchRecurringPatterns();
  }, [months]);

  const fetchRecurringPatterns = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/analytics/recurring-analysis?months=${months}&minOccurrences=3&minConfidence=0.5`);
      if (!response.ok) throw new Error('Failed to fetch recurring patterns');

      const data = await response.json();
      setPatterns(data.recurring_patterns || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching recurring patterns:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (pattern: RecurringPattern, newStatus: string) => {
    try {
      const response = await fetch('/api/analytics/recurring-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_pattern: pattern.merchant_pattern,
          frequency: pattern.frequency,
          user_status: newStatus
        })
      });

      if (!response.ok) throw new Error('Failed to update status');

      // Update local state
      setPatterns(prev =>
        prev.map(p =>
          p.merchant_pattern === pattern.merchant_pattern && p.frequency === pattern.frequency
            ? { ...p, user_status: newStatus as any }
            : p
        )
      );

      // Close menu
      setAnchorEl(prev => ({ ...prev, [pattern.merchant_pattern]: null }));
    } catch (err) {
      console.error('Error updating status:', err);
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const toggleExpand = (merchantPattern: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(merchantPattern)) {
        newSet.delete(merchantPattern);
      } else {
        newSet.add(merchantPattern);
      }
      return newSet;
    });
  };

  const openSuggestionsDialog = (pattern: RecurringPattern) => {
    setSelectedPattern(pattern);
    setSuggestionsDialogOpen(true);
  };

  const getFrequencyColor = (frequency: string) => {
    switch (frequency) {
      case 'weekly': return 'info';
      case 'monthly': return 'primary';
      case 'quarterly': return 'warning';
      case 'yearly': return 'secondary';
      default: return 'default';
    }
  };

  const getFrequencyLabel = (frequency: string) => {
    switch (frequency) {
      case 'weekly': return 'Weekly';
      case 'monthly': return 'Monthly';
      case 'quarterly': return 'Quarterly';
      case 'yearly': return 'Yearly';
      default: return frequency;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'essential': return <StarIcon fontSize="small" />;
      case 'marked_cancel': return <CancelIcon fontSize="small" />;
      case 'reviewed': return <CheckIcon fontSize="small" />;
      default: return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'essential': return 'warning';
      case 'marked_cancel': return 'error';
      case 'reviewed': return 'success';
      default: return 'default';
    }
  };

  const filteredPatterns = patterns.filter(p => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'subscriptions') return p.is_subscription;
    return p.user_status === filterStatus;
  });

  const summary = {
    total: patterns.length,
    totalMonthlyCost: patterns.reduce((sum, p) => sum + p.monthly_equivalent, 0),
    subscriptions: patterns.filter(p => p.is_subscription).length,
    markedForCancel: patterns.filter(p => p.user_status === 'marked_cancel').length,
    potentialSavings: patterns.reduce((sum, p) => {
      const maxSaving = Math.max(...p.optimization_suggestions.map(s => s.potential_savings || 0), 0);
      return sum + maxSaving;
    }, 0)
  };

  if (loading && patterns.length === 0) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RecurringIcon color="primary" />
          <Typography variant="h6" fontWeight="bold">
            Recurring Charges
          </Typography>
          <Tooltip title="Automatically detected recurring transactions based on patterns">
            <InfoIcon fontSize="small" color="action" />
          </Tooltip>
        </Box>
        <Button
          size="small"
          startIcon={loading ? <CircularProgress size={16} /> : <RecurringIcon />}
          onClick={fetchRecurringPatterns}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h4" color="primary.main">{summary.total}</Typography>
              <Typography variant="caption" color="text.secondary">Total Recurring</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h4" color="primary.main">
                {formatCurrency(summary.totalMonthlyCost, { maximumFractionDigits: 0 })}
              </Typography>
              <Typography variant="caption" color="text.secondary">Monthly Cost</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h4" color="secondary.main">{summary.subscriptions}</Typography>
              <Typography variant="caption" color="text.secondary">Subscriptions</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h4" color="success.main">
                {formatCurrency(summary.potentialSavings, { maximumFractionDigits: 0 })}
              </Typography>
              <Typography variant="caption" color="text.secondary">Potential Savings</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          label="All"
          onClick={() => setFilterStatus('all')}
          color={filterStatus === 'all' ? 'primary' : 'default'}
          variant={filterStatus === 'all' ? 'filled' : 'outlined'}
        />
        <Chip
          label="Subscriptions"
          onClick={() => setFilterStatus('subscriptions')}
          color={filterStatus === 'subscriptions' ? 'secondary' : 'default'}
          variant={filterStatus === 'subscriptions' ? 'filled' : 'outlined'}
        />
        <Chip
          label="Essential"
          icon={<StarIcon />}
          onClick={() => setFilterStatus('essential')}
          color={filterStatus === 'essential' ? 'warning' : 'default'}
          variant={filterStatus === 'essential' ? 'filled' : 'outlined'}
        />
        <Chip
          label="Marked for Cancel"
          icon={<CancelIcon />}
          onClick={() => setFilterStatus('marked_cancel')}
          color={filterStatus === 'marked_cancel' ? 'error' : 'default'}
          variant={filterStatus === 'marked_cancel' ? 'filled' : 'outlined'}
        />
      </Box>

      {/* Recurring Patterns List */}
      {filteredPatterns.length === 0 ? (
        <Alert severity="info">
          No recurring transactions detected. Try adjusting the time period or minimum occurrences.
        </Alert>
      ) : (
        <Box>
          {filteredPatterns.map((pattern) => (
            <Card key={`${pattern.merchant_pattern}-${pattern.frequency}`} sx={{ mb: 2 }} variant="outlined">
              <CardContent>
                {/* Main Row */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle1" fontWeight="medium">
                        {pattern.merchant_display_name}
                      </Typography>
                      {pattern.is_subscription && (
                        <Chip label="Subscription" size="small" color="secondary" />
                      )}
                      {pattern.user_status !== 'active' && (
                        <Chip
                          icon={getStatusIcon(pattern.user_status) || undefined}
                          label={pattern.user_status.replace('_', ' ')}
                          size="small"
                          color={getStatusColor(pattern.user_status) as any}
                        />
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <Chip
                        label={getFrequencyLabel(pattern.frequency)}
                        size="small"
                        color={getFrequencyColor(pattern.frequency) as any}
                        variant="outlined"
                      />
                      <Typography variant="body2" color="text.secondary">
                        {pattern.transaction_count} transactions
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Confidence: {Math.round(pattern.confidence * 100)}%
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" color="primary.main">
                        {formatCurrency(pattern.monthly_equivalent, { maximumFractionDigits: 0 })}/mo
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Avg: {formatCurrency(pattern.average_amount, { maximumFractionDigits: 0 })}
                      </Typography>
                    </Box>

                    <IconButton
                      size="small"
                      onClick={(e) => setAnchorEl(prev => ({ ...prev, [pattern.merchant_pattern]: e.currentTarget }))}
                    >
                      <MoreIcon />
                    </IconButton>

                    <IconButton
                      size="small"
                      onClick={() => toggleExpand(pattern.merchant_pattern)}
                    >
                      {expandedItems.has(pattern.merchant_pattern) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </Box>

                  {/* Status Menu */}
                  <Menu
                    anchorEl={anchorEl[pattern.merchant_pattern]}
                    open={Boolean(anchorEl[pattern.merchant_pattern])}
                    onClose={() => setAnchorEl(prev => ({ ...prev, [pattern.merchant_pattern]: null }))}
                  >
                    <MenuItem onClick={() => handleStatusChange(pattern, 'essential')}>
                      <ListItemIcon><StarIcon fontSize="small" /></ListItemIcon>
                      Mark as Essential
                    </MenuItem>
                    <MenuItem onClick={() => handleStatusChange(pattern, 'marked_cancel')}>
                      <ListItemIcon><CancelIcon fontSize="small" /></ListItemIcon>
                      Mark for Cancellation
                    </MenuItem>
                    <MenuItem onClick={() => handleStatusChange(pattern, 'reviewed')}>
                      <ListItemIcon><CheckIcon fontSize="small" /></ListItemIcon>
                      Mark as Reviewed
                    </MenuItem>
                    <MenuItem onClick={() => handleStatusChange(pattern, 'active')}>
                      Reset to Active
                    </MenuItem>
                  </Menu>
                </Box>

                {/* Expanded Details */}
                <Collapse in={expandedItems.has(pattern.merchant_pattern)}>
                  <Divider sx={{ my: 2 }} />
                  
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">Details</Typography>
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="body2">
                          <strong>Category:</strong> {pattern.category}
                        </Typography>
                        <Typography variant="body2">
                          <strong>First seen:</strong> {new Date(pattern.first_transaction).toLocaleDateString()}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Last charged:</strong> {new Date(pattern.last_transaction).toLocaleDateString()}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Next expected:</strong> {new Date(pattern.next_expected_date).toLocaleDateString()}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Amount variance:</strong> ±{formatCurrency(pattern.amount_variance, { maximumFractionDigits: 2 })}
                        </Typography>
                      </Box>
                    </Grid>

                    {pattern.optimization_suggestions.length > 0 && (
                      <Grid item xs={12} sm={6}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <LightbulbIcon color="warning" fontSize="small" />
                          <Typography variant="caption" color="text.secondary">
                            Optimization Opportunities
                          </Typography>
                        </Box>
                        <List dense>
                          {pattern.optimization_suggestions.slice(0, 2).map((suggestion, idx) => (
                            <ListItem key={idx} sx={{ pl: 0 }}>
                              <ListItemText
                                primary={suggestion.title}
                                secondary={`Save up to ${formatCurrency(suggestion.potential_savings, { maximumFractionDigits: 0 })}`}
                                primaryTypographyProps={{ variant: 'body2' }}
                                secondaryTypographyProps={{ variant: 'caption' }}
                              />
                            </ListItem>
                          ))}
                        </List>
                        {pattern.optimization_suggestions.length > 2 && (
                          <Button
                            size="small"
                            startIcon={<LightbulbIcon />}
                            onClick={() => openSuggestionsDialog(pattern)}
                          >
                            View All Suggestions ({pattern.optimization_suggestions.length})
                          </Button>
                        )}
                      </Grid>
                    )}
                  </Grid>
                </Collapse>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Suggestions Dialog */}
      <Dialog
        open={suggestionsDialogOpen}
        onClose={() => setSuggestionsDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Optimization Suggestions
          {selectedPattern && (
            <Typography variant="body2" color="text.secondary">
              {selectedPattern.merchant_display_name}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          {selectedPattern?.optimization_suggestions.map((suggestion, idx) => (
            <Box key={idx} sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                {suggestion.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {suggestion.description}
              </Typography>
              <Typography variant="body2" color="success.main" gutterBottom>
                💰 Potential Savings: {formatCurrency(suggestion.potential_savings, { maximumFractionDigits: 0 })}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                Action: {suggestion.action}
              </Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuggestionsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RecurringTransactionManager;
