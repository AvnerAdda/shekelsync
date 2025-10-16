import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Grid,
  LinearProgress,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon,
  Lightbulb as LightbulbIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Star as StarIcon,
  AttachMoney as MoneyIcon
} from '@mui/icons-material';

interface Outlier {
  date: string;
  amount: number;
  merchant_name: string;
  description: string;
  deviation: string;
}

interface Trend {
  direction: 'increasing' | 'decreasing' | 'stable';
  change_percentage: number;
  description: string;
  first_half_avg?: number;
  second_half_avg?: number;
}

interface Suggestion {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  potential_savings: number;
  action_items: string[];
}

interface SpendingSummary {
  total_spending: number;
  avg_monthly_spending: number;
  months_active: number;
  total_transactions: number;
  avg_transaction_amount: number;
  highest_transaction: number;
  spending_variance: number;
}

interface Opportunity {
  category_definition_id: number;
  category_name: string;
  parent_id: number | null;
  parent_name: string | null;
  actionability_level: 'low' | 'medium' | 'high';
  spending_summary: SpendingSummary;
  outliers: Outlier[];
  trend: Trend;
  suggestions: Suggestion[];
  opportunity_score: number;
}

interface OpportunitiesSummary {
  total_opportunities: number;
  total_potential_savings: number;
  high_priority_count: number;
  medium_priority_count: number;
}

const CategoryOpportunitiesPanel: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [summary, setSummary] = useState<OpportunitiesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [expandedPanel, setExpandedPanel] = useState<string | false>(false);

  useEffect(() => {
    fetchOpportunities();
  }, []);

  const fetchOpportunities = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/analytics/category-opportunities?months=6&minTransactions=3');
      
      if (!response.ok) {
        throw new Error('Failed to fetch opportunities');
      }

      const data = await response.json();
      setOpportunities(data.opportunities || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Error fetching opportunities:', err);
      setError(err instanceof Error ? err.message : 'Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  };

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedPanel(isExpanded ? panel : false);
  };

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case 'increasing': return <TrendingUpIcon color="error" />;
      case 'decreasing': return <TrendingDownIcon color="success" />;
      default: return <TrendingFlatIcon color="action" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      default: return 'info';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'error';
    if (score >= 50) return 'warning';
    return 'info';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <Box sx={{ width: '100%', p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Analyzing Spending Opportunities...
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  }

  if (!opportunities || opportunities.length === 0) {
    return (
      <Alert severity="info" sx={{ m: 2 }}>
        No optimization opportunities found. Your spending appears to be well-managed!
      </Alert>
    );
  }

  return (
    <Box sx={{ width: '100%', mt: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LightbulbIcon color="primary" />
          Spending Optimization Opportunities
        </Typography>
        <Typography variant="body2" color="text.secondary">
          AI-detected opportunities to reduce costs and improve financial health
        </Typography>
      </Box>

      {/* Summary Cards */}
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">
                  Total Opportunities
                </Typography>
                <Typography variant="h4">
                  {summary.total_opportunities}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">
                  Potential Savings
                </Typography>
                <Typography variant="h4" color="success.main">
                  {formatCurrency(summary.total_potential_savings)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  per month
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">
                  High Priority
                </Typography>
                <Typography variant="h4" color="error.main">
                  {summary.high_priority_count}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">
                  Medium Priority
                </Typography>
                <Typography variant="h4" color="warning.main">
                  {summary.medium_priority_count}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Opportunities List */}
      <Box>
        {opportunities.map((opportunity, index) => (
          <Accordion
            key={`${opportunity.category_definition_id}-${index}`}
            expanded={expandedPanel === `panel-${index}`}
            onChange={handleAccordionChange(`panel-${index}`)}
            sx={{ mb: 2 }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h6">
                    {opportunity.category_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatCurrency(opportunity.spending_summary.avg_monthly_spending)}/month · {' '}
                    {opportunity.spending_summary.total_transactions} transactions
                  </Typography>
                </Box>

                <Chip
                  label={`Score: ${opportunity.opportunity_score}`}
                  color={getScoreColor(opportunity.opportunity_score)}
                  size="small"
                  icon={<StarIcon />}
                />

                <Chip
                  label={opportunity.actionability_level}
                  size="small"
                  variant="outlined"
                />

                {getTrendIcon(opportunity.trend.direction)}
              </Box>
            </AccordionSummary>

            <AccordionDetails>
              <Box>
                {/* Spending Summary */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Spending Overview
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6} md={3}>
                      <Typography variant="caption" color="text.secondary">
                        Total ({opportunity.spending_summary.months_active} months)
                      </Typography>
                      <Typography variant="body1">
                        {formatCurrency(opportunity.spending_summary.total_spending)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="caption" color="text.secondary">
                        Avg per Month
                      </Typography>
                      <Typography variant="body1">
                        {formatCurrency(opportunity.spending_summary.avg_monthly_spending)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="caption" color="text.secondary">
                        Avg Transaction
                      </Typography>
                      <Typography variant="body1">
                        {formatCurrency(opportunity.spending_summary.avg_transaction_amount)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="caption" color="text.secondary">
                        Highest Transaction
                      </Typography>
                      <Typography variant="body1">
                        {formatCurrency(opportunity.spending_summary.highest_transaction)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Trend Analysis */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {getTrendIcon(opportunity.trend.direction)}
                    Spending Trend
                  </Typography>
                  <Alert 
                    severity={opportunity.trend.direction === 'increasing' ? 'warning' : 'info'}
                    sx={{ mt: 1 }}
                  >
                    {opportunity.trend.description}
                    {opportunity.trend.change_percentage !== 0 && (
                      <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                        Change: {opportunity.trend.change_percentage > 0 ? '+' : ''}
                        {opportunity.trend.change_percentage.toFixed(1)}%
                      </Typography>
                    )}
                  </Alert>
                </Box>

                {/* Outliers */}
                {opportunity.outliers.length > 0 && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <WarningIcon color="warning" />
                        Unusual Transactions ({opportunity.outliers.length})
                      </Typography>
                      <List dense>
                        {opportunity.outliers.map((outlier, idx) => (
                          <ListItem key={idx}>
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <Typography variant="body2">
                                    {outlier.merchant_name || outlier.description}
                                  </Typography>
                                  <Typography variant="body2" color="error.main" fontWeight="bold">
                                    {formatCurrency(outlier.amount)}
                                  </Typography>
                                </Box>
                              }
                              secondary={
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <Typography variant="caption">
                                    {formatDate(outlier.date)}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {outlier.deviation}% above average
                                  </Typography>
                                </Box>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  </>
                )}

                {/* Suggestions */}
                <Divider sx={{ my: 2 }} />
                <Box>
                  <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LightbulbIcon color="primary" />
                    Optimization Suggestions ({opportunity.suggestions.length})
                  </Typography>
                  <Stack spacing={2} sx={{ mt: 2 }}>
                    {opportunity.suggestions.map((suggestion, idx) => (
                      <Card 
                        key={idx} 
                        variant="outlined"
                        sx={{ 
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'action.hover' }
                        }}
                        onClick={() => setSelectedSuggestion(suggestion)}
                      >
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="subtitle1" fontWeight="bold">
                                {suggestion.title}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {suggestion.description}
                              </Typography>
                            </Box>
                            <Chip
                              label={suggestion.priority}
                              color={getPriorityColor(suggestion.priority)}
                              size="small"
                            />
                          </Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
                            <Typography variant="body2" color="success.main" fontWeight="bold">
                              Potential savings: {formatCurrency(suggestion.potential_savings)}/month
                            </Typography>
                            <Button size="small" endIcon={<ExpandMoreIcon />}>
                              View Action Plan
                            </Button>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                </Box>
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>

      {/* Suggestion Details Dialog */}
      <Dialog
        open={selectedSuggestion !== null}
        onClose={() => setSelectedSuggestion(null)}
        maxWidth="sm"
        fullWidth
      >
        {selectedSuggestion && (
          <>
            <DialogTitle>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LightbulbIcon color="primary" />
                {selectedSuggestion.title}
              </Box>
            </DialogTitle>
            <DialogContent>
              <Alert severity="info" sx={{ mb: 2 }}>
                Potential savings: <strong>{formatCurrency(selectedSuggestion.potential_savings)}/month</strong>
              </Alert>

              <Typography variant="body2" paragraph>
                {selectedSuggestion.description}
              </Typography>

              <Typography variant="subtitle2" gutterBottom sx={{ mt: 3 }}>
                Action Items:
              </Typography>
              <List>
                {selectedSuggestion.action_items.map((item, idx) => (
                  <ListItem key={idx}>
                    <ListItemIcon>
                      <CheckCircleIcon color="primary" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={item} />
                  </ListItem>
                ))}
              </List>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedSuggestion(null)}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

export default CategoryOpportunitiesPanel;
