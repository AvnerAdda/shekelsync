import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Grid,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
} from '@mui/material';
import {
  TrendingUp as TrendIcon,
  Settings as SettingsIcon,
  ExpandMore as ExpandMoreIcon,
  CalendarToday as CalendarIcon,
  Psychology as PsychologyIcon,
  AttachMoney as MoneyIcon,
  CompareArrows as CompareIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import ActionabilitySetupModal from './AnalysisPage/ActionabilitySetupModal';
import RecurringTransactionManager from './AnalysisPage/RecurringTransactionManager';
import CategoryOpportunitiesPanel from './AnalysisPage/CategoryOpportunitiesPanel';
import HealthScoreRoadmapModal from './AnalysisPage/HealthScoreRoadmapModal';
import ActionItemsDashboard from './AnalysisPage/ActionItemsDashboard';

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
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | false>('actions');
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

  return (
    <Box sx={{ width: '100%', p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Financial Intelligence
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={() => setSetupModalOpen(true)}
            size="small"
          >
            Setup
          </Button>
          <Button
            variant="outlined"
            startIcon={loading ? <CircularProgress size={16} /> : <TrendIcon />}
            onClick={fetchIntelligence}
            disabled={loading}
            size="small"
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Modals */}
      <ActionabilitySetupModal
        open={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        onSave={() => fetchIntelligence()}
      />
      
      <HealthScoreRoadmapModal
        open={roadmapModalOpen}
        onClose={() => setRoadmapModalOpen(false)}
        currentScore={overallHealthScore}
      />

      {/* Health Score Overview - Compact */}
      <Paper sx={{ p: 2, mb: 2, background: `linear-gradient(135deg, ${getHealthScoreColor(overallHealthScore)}15 0%, ${getHealthScoreColor(overallHealthScore)}05 100%)` }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={3}>
            <Box textAlign="center">
              <Typography variant="h3" fontWeight="bold" color={getHealthScoreColor(overallHealthScore)}>
                {overallHealthScore}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Health Score
              </Typography>
              <Box sx={{ mt: 1 }}>
                <Button 
                  variant="contained" 
                  color="primary" 
                  size="small"
                  fullWidth
                  startIcon={<TrendIcon />}
                  onClick={() => setRoadmapModalOpen(true)}
                >
                  Improve
                </Button>
              </Box>
            </Box>
          </Grid>
          <Grid item xs={12} sm={9}>
            <Grid container spacing={1}>
              {Object.entries(healthBreakdown).slice(0, 4).map(([key, value]) => (
                <Grid item xs={6} md={3} key={key}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {key.replace('Score', '').replace(/([A-Z])/g, ' $1').trim()}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <LinearProgress
                        variant="determinate"
                        value={value as number}
                        sx={{ flex: 1, height: 4, borderRadius: 2 }}
                      />
                      <Typography variant="caption" fontWeight="bold">
                        {String(value)}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* Critical Actions First */}
      {recommendations.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" fontWeight="bold">
            ⚡ {recommendations[0].title}
          </Typography>
          <Typography variant="body2">{recommendations[0].message}</Typography>
          {recommendations[0].potentialSavings && (
            <Typography variant="caption">
              💰 Potential savings: {formatCurrencyValue(recommendations[0].potentialSavings)}/month
            </Typography>
          )}
        </Alert>
      )}

      {/* Main Action Sections - Collapsible */}
      <Accordion 
        expanded={expandedSection === 'actions'} 
        onChange={() => setExpandedSection(expandedSection === 'actions' ? false : 'actions')}
        defaultExpanded
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">🎯 Your Action Items</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ActionItemsDashboard />
        </AccordionDetails>
      </Accordion>

      <Accordion 
        expanded={expandedSection === 'recurring'} 
        onChange={() => setExpandedSection(expandedSection === 'recurring' ? false : 'recurring')}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">🔄 Recurring Charges</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <RecurringTransactionManager months={3} />
        </AccordionDetails>
      </Accordion>

      <Accordion 
        expanded={expandedSection === 'opportunities'} 
        onChange={() => setExpandedSection(expandedSection === 'opportunities' ? false : 'opportunities')}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">💡 Spending Opportunities</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <CategoryOpportunitiesPanel />
        </AccordionDetails>
      </Accordion>

      {/* Insights - Grouped & Compact */}
      <Accordion 
        expanded={expandedSection === 'insights'} 
        onChange={() => setExpandedSection(expandedSection === 'insights' ? false : 'insights')}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">📊 Financial Insights</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            {/* Your Financial Rhythm */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <CalendarIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight="bold">
                      Your Financial Rhythm
                    </Typography>
                  </Box>
                  
                  {/* Hourly Spending Heatmap */}
                  {temporal.hourlyHeatmap && temporal.hourlyHeatmap.length > 0 && (
                    <Box sx={{ mb: 2, height: 80 }}>
                      <Typography variant="caption" color="text.secondary" gutterBottom>
                        Spending by Hour of Day
                      </Typography>
                      <BarChart
                        height={60}
                        margin={{ top: 5, bottom: 5, left: 0, right: 0 }}
                        xAxis={[{ 
                          data: Array.from({ length: 24 }, (_, i) => i),
                          scaleType: 'band',
                          tickMinStep: 6,
                          hideTooltip: false
                        }]}
                        series={[{
                          data: temporal.hourlyHeatmap,
                          color: '#1976d2',
                        }]}
                        tooltip={{ trigger: 'item' }}
                        slotProps={{
                          legend: { hidden: true },
                        }}
                      />
                    </Box>
                  )}

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Financial Runway</Typography>
                      <Typography variant="h6">{temporal.financialRunwayDays || 0} days</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Daily Burn Rate</Typography>
                      <Typography variant="h6">{formatCurrencyValue(temporal.dailyBurnRate || 0)}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Peak Hour</Typography>
                      <Typography variant="body2">
                        {temporal.peakSpendingHour !== undefined ? `${temporal.peakSpendingHour}:00` : 'N/A'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Payday Effect</Typography>
                      <Typography variant="body2">
                        {Math.round(temporal.paydayEffect || 0)}%
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Your Money Personality */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <PsychologyIcon color="secondary" />
                    <Typography variant="subtitle1" fontWeight="bold">
                      Your Money Personality
                    </Typography>
                  </Box>

                  {/* Impulse vs Planned Visual */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">Spending Style</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, mb: 1 }}>
                      <Box
                        sx={{
                          flex: behavioral.impulseSpendingScore || 0,
                          height: 8,
                          bgcolor: 'warning.main',
                          borderRadius: 1,
                          transition: 'all 0.3s'
                        }}
                      />
                      <Box
                        sx={{
                          flex: 100 - (behavioral.impulseSpendingScore || 0),
                          height: 8,
                          bgcolor: 'success.main',
                          borderRadius: 1,
                          transition: 'all 0.3s'
                        }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption" color="warning.main">
                        {Math.round(behavioral.impulseSpendingScore || 0)}% Impulse
                      </Typography>
                      <Typography variant="caption" color="success.main">
                        {Math.round(100 - (behavioral.impulseSpendingScore || 0))}% Planned
                      </Typography>
                    </Box>
                  </Box>

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Avg Transaction</Typography>
                      <Typography variant="h6">{formatCurrencyValue(behavioral.averageTransactionSize || 0)}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Small Purchases</Typography>
                      <Typography variant="h6">{behavioral.smallTransactionCount || 0}</Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary">FOMO Score</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={behavioral.fomoScore || 0}
                          sx={{ flex: 1, height: 6, borderRadius: 3 }}
                          color={behavioral.fomoScore > 70 ? 'error' : behavioral.fomoScore > 40 ? 'warning' : 'success'}
                        />
                        <Typography variant="body2" fontWeight="bold">
                          {behavioral.fomoScore || 0}/100
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                        Weekend entertainment spending indicator
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Your Financial Future */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <TimelineIcon color="success" />
                    <Typography variant="subtitle1" fontWeight="bold">
                      Your Financial Future
                    </Typography>
                  </Box>

                  {/* 6-Month Trajectory Sparkline */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">6-Month Savings Trajectory</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography 
                        variant="h6" 
                        color={predictive.savingsTrajectory6m > 0 ? 'success.main' : 'error.main'}
                      >
                        {formatCurrencyValue(predictive.savingsTrajectory6m, { showSign: true })}
                      </Typography>
                      <Box sx={{ flex: 1, height: 30 }}>
                        <SparkLineChart
                          data={Array.from({ length: 6 }, (_, i) => 
                            (predictive.monthlySavings || 0) * (i + 1)
                          )}
                          height={30}
                          curve="natural"
                          area
                          colors={[predictive.savingsTrajectory6m > 0 ? '#4caf50' : '#f44336']}
                          margin={{ top: 2, bottom: 2, left: 2, right: 2 }}
                        />
                      </Box>
                    </Box>
                  </Box>

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">End of Month</Typography>
                      <Typography variant="h6" color="primary.main">
                        {formatCurrencyValue(predictive.forecastEndMonth)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Monthly Savings</Typography>
                      <Typography 
                        variant="h6" 
                        color={predictive.monthlySavings > 0 ? 'success.main' : 'error.main'}
                      >
                        {formatCurrencyValue(predictive.monthlySavings, { showSign: true })}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary">Daily Velocity</Typography>
                      <Typography variant="body2">{formatCurrencyValue(predictive.spendingVelocity)}/day</Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Make It Real */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <MoneyIcon color="warning" />
                    <Typography variant="subtitle1" fontWeight="bold">
                      Make It Real
                    </Typography>
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">Your Time = Money</Typography>
                    <Typography variant="h6">{formatCurrencyValue(psychological.hourlyWage || 0)}/hour</Typography>
                    <Typography variant="caption">
                      Avg purchase = {typeof psychological.avgTransactionInHours === 'number' 
                        ? psychological.avgTransactionInHours.toFixed(1) 
                        : psychological.avgTransactionInHours} hours of work
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">Biggest Purchase This Month</Typography>
                    <Typography variant="body2">
                      {typeof psychological.biggestPurchaseHours === 'number' 
                        ? Math.round(psychological.biggestPurchaseHours) 
                        : psychological.biggestPurchaseHours} hours of work
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default AnalysisPage;
