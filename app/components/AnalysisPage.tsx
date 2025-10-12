import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Divider,
  Grid,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import {
  Psychology as BrainIcon,
  TrendingUp as TrendIcon,
  CalendarToday as CalendarIcon,
  LocalCafe as CoffeeIcon,
  Speed as SpeedIcon,
  CompareArrows as CompareIcon,
  Lightbulb as LightbulbIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Info as InfoIcon,
  Timeline as TimelineIcon,
  AccountBalance as BalanceIcon,
  PsychologyAlt as PsychologyAltIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

interface PersonalIntelligence {
  temporalIntelligence: any;
  behavioralIntelligence: any;
  comparativeIntelligence: any;
  microInsights: any;
  efficiencyMetrics: any;
  predictiveAnalytics: any;
  psychologicalInsights: any;
  recommendations: any[];
  overallHealthScore: number;
  healthBreakdown: any;
  userProfile: any;
}

const AnalysisPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [intelligence, setIntelligence] = useState<PersonalIntelligence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { formatCurrency } = useFinancePrivacy();

  const fetchIntelligence = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/analytics/personal-intelligence?months=3');

      if (!response.ok) {
        throw new Error('Failed to fetch intelligence data');
      }

      const data = await response.json();
      setIntelligence(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching personal intelligence:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntelligence();
  }, []);

  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return '#4caf50';
    if (score >= 60) return '#ff9800';
    return '#f44336';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'error';
      case 'high': return 'warning';
      case 'medium': return 'info';
      default: return 'default';
    }
  };

  if (loading && !intelligence) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ ml: 3 }}>
          Analyzing your financial DNA...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button variant="contained" onClick={fetchIntelligence}>
          Retry
        </Button>
      </Box>
    );
  }

  if (!intelligence) {
    return (
      <Box>
        <Alert severity="info">No data available. Please try again.</Alert>
      </Box>
    );
  }

  const {
    temporalIntelligence: temporal,
    behavioralIntelligence: behavioral,
    comparativeIntelligence: comparative,
    microInsights: micro,
    efficiencyMetrics: efficiency,
    predictiveAnalytics: predictive,
    psychologicalInsights: psychological,
    recommendations,
    overallHealthScore,
    healthBreakdown
  } = intelligence;

  const formatCurrencyValue = (
    value: number,
    options?: { absolute?: boolean; showSign?: boolean; minimumFractionDigits?: number; maximumFractionDigits?: number }
  ) =>
    formatCurrency(value, {
      maximumFractionDigits: options?.maximumFractionDigits ?? 0,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      ...(options?.absolute !== undefined ? { absolute: options.absolute } : {}),
      ...(options?.showSign ? { showSign: true } : {}),
    });

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Personal Financial Intelligence
        </Typography>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={16} /> : <TrendIcon />}
          onClick={fetchIntelligence}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {/* Overall Health Score */}
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${getHealthScoreColor(overallHealthScore)}15 0%, ${getHealthScoreColor(overallHealthScore)}05 100%)` }}>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={4}>
            <Box textAlign="center">
              <Typography variant="h2" fontWeight="bold" color={getHealthScoreColor(overallHealthScore)}>
                {overallHealthScore}
              </Typography>
              <Typography variant="h6" color="text.secondary">
                Financial Health Score
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} md={8}>
            <Grid container spacing={2}>
              {Object.entries(healthBreakdown).map(([key, value]) => (
                <Grid item xs={6} key={key}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {key.replace('Score', '').replace(/([A-Z])/g, ' $1').trim()}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={value as number}
                      sx={{ flex: 1, height: 8, borderRadius: 4 }}
                    />
                    <Typography variant="body2" fontWeight="bold">
                      {String(value)}
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* Critical Recommendations */}
      {recommendations.length > 0 && (
        <Box sx={{ mb: 3 }}>
          {recommendations.map((rec, idx) => (
            <Alert
              key={idx}
              severity={rec.priority === 'critical' ? 'error' : rec.priority === 'high' ? 'warning' : 'info'}
              icon={<LightbulbIcon />}
              sx={{ mb: 2 }}
            >
              <Typography variant="subtitle2" fontWeight="bold">{rec.title}</Typography>
              <Typography variant="body2">{rec.message}</Typography>
              <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                💡 {rec.action}
                {rec.potentialSavings && ` (Save up to ${formatCurrencyValue(rec.potentialSavings)}/month)`}
              </Typography>
            </Alert>
          ))}
        </Box>
      )}

      <Grid container spacing={3}>
        {/* Temporal Intelligence */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CalendarIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6" fontWeight="bold">
                  Your Financial Rhythm
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">Daily Burn Rate</Typography>
                <Typography variant="h4" color="primary.main">
                  {formatCurrencyValue(temporal.dailyBurnRate)}/day
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">Financial Runway</Typography>
                <Typography variant="h5">
                  {temporal.financialRunwayDays} days
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Your savings will last {Math.round(temporal.financialRunwayDays / 30)} months at current rate
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">Peak Spending Hour</Typography>
                <Typography variant="h5">
                  {temporal.peakSpendingHour}:00
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Payday Effect</Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box flex={1}>
                    <Typography variant="caption">Early Month</Typography>
                    <Typography variant="h6" color="primary.main">{formatCurrencyValue(temporal.earlyMonthSpend)}</Typography>
                  </Box>
                  <Box flex={1}>
                    <Typography variant="caption">Late Month</Typography>
                    <Typography variant="h6">{formatCurrencyValue(temporal.lateMonthSpend)}</Typography>
                  </Box>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={temporal.paydayEffect}
                  sx={{ mt: 1, height: 6, borderRadius: 3 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {temporal.paydayEffect}% of spending happens early month
                </Typography>
              </Box>

              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>Weekend vs Weekday</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Chip label={`Weekend: ${formatCurrencyValue(temporal.weekendVsWeekday.weekendSpend)}`} size="small" />
                  <Chip label={`Weekday: ${formatCurrencyValue(temporal.weekendVsWeekday.weekdaySpend)}`} size="small" variant="outlined" />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Behavioral Intelligence */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PsychologyAltIcon color="secondary" sx={{ mr: 1 }} />
                <Typography variant="h6" fontWeight="bold">
                  Your Money Personality
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Impulse Spending Score</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <LinearProgress
                    variant="determinate"
                    value={behavioral.impulseSpendingScore}
                    sx={{ flex: 1, height: 10, borderRadius: 5 }}
                    color={behavioral.impulseSpendingScore > 70 ? 'error' : behavioral.impulseSpendingScore > 40 ? 'warning' : 'success'}
                  />
                  <Typography variant="h6" fontWeight="bold">
                    {behavioral.impulseSpendingScore}/100
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {behavioral.smallTransactionCount} small transactions detected
                </Typography>
              </Box>

              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Decision Fatigue Index</Typography>
                <Typography variant="h5">
                  {behavioral.decisionFatigueIndex}%
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Evening spending vs morning baseline
                </Typography>
              </Box>

              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Financial FOMO Score</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <LinearProgress
                    variant="determinate"
                    value={behavioral.fomoScore}
                    sx={{ flex: 1, height: 10, borderRadius: 5 }}
                    color={behavioral.fomoScore > 60 ? 'warning' : 'success'}
                  />
                  <Typography variant="h6" fontWeight="bold">
                    {behavioral.fomoScore}/100
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Weekend entertainment spending indicator
                </Typography>
              </Box>

              <Box>
                <Typography variant="body2" color="text.secondary">Average Transaction Size</Typography>
                <Typography variant="h5">
                  {formatCurrencyValue(behavioral.averageTransactionSize)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Comparative Intelligence */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CompareIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6" fontWeight="bold">
                  How You Compare
                </Typography>
                <Chip label="AI Benchmark" size="small" sx={{ ml: 'auto' }} color="primary" variant="outlined" />
              </Box>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">Age Group ({comparative.ageGroup.bracket})</Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'baseline' }}>
                  <Typography variant="h5">{formatCurrencyValue(comparative.ageGroup.yourExpense)}</Typography>
                  <Typography variant="body2" color={comparative.ageGroup.difference > 0 ? 'error.main' : 'success.main'}>
                    {`${formatCurrencyValue(comparative.ageGroup.difference, { showSign: true })} vs avg`}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">Savings Rate</Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'baseline' }}>
                  <Typography variant="h5">{comparative.incomeGroup.yourSavingsRate}%</Typography>
                  <Typography variant="body2" color="text.secondary">
                    (Income bracket avg: {comparative.incomeGroup.avgSavingsRate}%)
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">Location: {comparative.location.city}</Typography>
                <Typography variant="body2">
                  Cost of Living Index: {comparative.location.costOfLivingIndex}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  City average: {formatCurrencyValue(comparative.location.avgExpense)}/month
                </Typography>
              </Box>

              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="caption">
                  <strong>Note:</strong> Benchmarks are AI-generated estimates based on Israeli market data.
                  Complete your profile for more accurate comparisons.
                </Typography>
              </Alert>
            </CardContent>
          </Card>
        </Grid>

        {/* Micro Insights */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CoffeeIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6" fontWeight="bold">
                  The Small Things
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ mb: 3, p: 2, bgcolor: '#fff3e0', borderRadius: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  ☕ Coffee Index
                </Typography>
                <Typography variant="h4" color="warning.main">
                  {formatCurrencyValue(micro.coffeeIndex.yearlyProjection)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  per year ({micro.coffeeIndex.transactionCount} purchases)
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 1, fontStyle: 'italic' }}>
                  💡 That's a flight to Europe!
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Recurring Subscriptions
                </Typography>
                {micro.subscriptions.slice(0, 3).map((sub: any, idx: number) => (
                  <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>
                      {sub.name}
                    </Typography>
                    <Chip label={`${formatCurrencyValue(sub.monthlyAmount)}/mo`} size="small" />
                  </Box>
                ))}
                {micro.subscriptions.length > 3 && (
                  <Typography variant="caption" color="primary.main">
                    +{micro.subscriptions.length - 3} more subscriptions
                  </Typography>
                )}
              </Box>

              <Box>
                <Typography variant="body2" color="text.secondary">Round Number Bias</Typography>
                <Typography variant="h6">
                  {micro.roundNumberBias}% of transactions
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Psychology: You tend to spend in round numbers
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Predictive Analytics */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TimelineIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6" fontWeight="bold">
                  Your Financial Future
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  End of Month Forecast
                </Typography>
                <Typography variant="h4" color="primary.main">
                  {formatCurrencyValue(predictive.forecastEndMonth)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Based on current velocity: {formatCurrencyValue(predictive.spendingVelocity)}/day
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  6-Month Savings Trajectory
                </Typography>
                <Typography variant="h5" color={predictive.savingsTrajectory6m > 0 ? 'success.main' : 'error.main'}>
                  {formatCurrencyValue(predictive.savingsTrajectory6m, { showSign: true })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Monthly savings: {formatCurrencyValue(predictive.monthlySavings)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Psychological Insights */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <BrainIcon color="error" sx={{ mr: 1 }} />
                <Typography variant="h6" fontWeight="bold">
                  Make It Real
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Your Time Exchange Rate
                </Typography>
                <Typography variant="h5">
                  {formatCurrencyValue(psychological.hourlyWage)}/hour
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Average transaction = {psychological.avgTransactionInHours} hours of work
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Biggest Purchase This Month
                </Typography>
                <Typography variant="h6">
                  {psychological.biggestPurchaseHours} hours of work
                </Typography>
              </Box>

              <Divider sx={{ my: 2 }} />

              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Opportunity Costs
              </Typography>
              {psychological.opportunityCosts.map((opp: any, idx: number) => (
                <Box key={idx} sx={{ mb: 1, p: 1, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                  <Typography variant="body2">
                    <strong>{opp.category}:</strong> {formatCurrencyValue(opp.monthlySpend)}/mo
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    = {opp.equivalentTo}
                  </Typography>
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AnalysisPage;
