import React, { useState, useEffect, useCallback } from 'react';
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
  Tooltip,
  Skeleton,
  Fab,
  Collapse,
  useTheme,
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
  Savings as SavingsIcon,
  Diversity3 as DiversityIcon,
  ShoppingCart as ImpulseIcon,
  Schedule as RunwayIcon,
  HelpOutline as HelpIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Assignment as ActionIcon,
  Repeat as RecurringIcon,
  Lightbulb as OpportunityIcon,
  Analytics as InsightsIcon,
  Speed as DashboardIcon,
  PriorityHigh as PriorityIcon,
} from '@mui/icons-material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import LockedPagePlaceholder from './EmptyState/LockedPagePlaceholder';
import ActionabilitySetupModal from './AnalysisPage/ActionabilitySetupModal';
import RecurringTransactionManager from './AnalysisPage/RecurringTransactionManager';
import CategoryOpportunitiesPanel from './AnalysisPage/CategoryOpportunitiesPanel';
import HealthScoreRoadmapModal from './AnalysisPage/HealthScoreRoadmapModal';
import ActionItemsDashboard from './AnalysisPage/ActionItemsDashboard';
import AccountsModal from './AccountsModal';
import AccountPairingModal from './AccountPairingModal';
import CategoryHierarchyModal from './CategoryHierarchyModal';
import { apiClient } from '@/lib/api-client';

interface DataQualityWarning {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  message: string;
  count?: number;
  percentage?: number;
  actionLabel: string;
  actionTarget: string;
}

interface DataQuality {
  hasIssues: boolean;
  warnings: DataQualityWarning[];
}

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
  dataQuality?: DataQuality;
}

const AnalysisPage: React.FC = () => {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [intelligence, setIntelligence] = useState<PersonalIntelligence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<{[key: string]: boolean}>({
    actions: true,
    recurring: false,
    opportunities: false,
    insights: false
  });
  const { formatCurrency } = useFinancePrivacy();
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const accessStatus = getPageAccessStatus('analysis');
  const isLocked = accessStatus.isLocked;

  const fetchIntelligence = useCallback(async () => {
    if (isLocked) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get('/api/analytics/personal-intelligence?months=3');

      if (!response.ok) {
        throw new Error('Failed to fetch intelligence data');
      }

      const data = response.data as any;
      setIntelligence(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching personal intelligence:', err);
    } finally {
      setLoading(false);
    }
  }, [isLocked]);

  useEffect(() => {
    if (isLocked) {
      return;
    }
    fetchIntelligence();
  }, [fetchIntelligence, isLocked]);

  if (isLocked) {
    return (
      <LockedPagePlaceholder
        page="analysis"
        accessStatus={accessStatus}
        onboardingStatus={onboardingStatus}
      />
    );
  }

  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return '#4caf50';
    if (score >= 60) return '#ff9800';
    return '#f44336';
  };

  const getHealthMetricIcon = (key: string) => {
    switch (key.toLowerCase()) {
      case 'savingsscore': return <SavingsIcon />;
      case 'diversityscore': return <DiversityIcon />;
      case 'impulsescore': return <ImpulseIcon />;
      case 'runwayscore': return <RunwayIcon />;
      default: return <MoneyIcon />;
    }
  };

  const getHealthMetricName = (key: string) => {
    switch (key.toLowerCase()) {
      case 'savingsscore': return 'Savings';
      case 'diversityscore': return 'Diversity';
      case 'impulsescore': return 'Impulse Control';
      case 'runwayscore': return 'Runway';
      default: return key.replace('Score', '').replace(/([A-Z])/g, ' $1').trim();
    }
  };

  const getHealthMetricTooltip = (key: string) => {
    switch (key.toLowerCase()) {
      case 'savingsscore': return 'Measures your savings rate as a percentage of income. Higher scores indicate better financial discipline and future security.';
      case 'diversityscore': return 'Evaluates how well-balanced your spending is across different categories. A higher score suggests better financial diversification.';
      case 'impulsescore': return 'Assesses your ability to control spontaneous purchases. Higher scores indicate better spending discipline and financial planning.';
      case 'runwayscore': return 'Calculates how long your current savings would sustain your lifestyle. Higher scores mean better financial resilience.';
      default: return 'A key indicator of your financial health and stability';
    }
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

  const handleWarningAction = (actionTarget: string) => {
    switch (actionTarget) {
      case 'accounts_modal':
        setAccountsModalOpen(true);
        break;
      case 'pairing_modal':
        setPairingModalOpen(true);
        break;
      case 'category_modal':
        setCategoryModalOpen(true);
        break;
      default:
        console.warn('Unknown action target:', actionTarget);
    }
  };

  const dismissWarning = (warningType: string) => {
    setDismissedWarnings(prev => new Set(prev).add(warningType));
  };

  const getSeverityColor = (severity: 'critical' | 'high' | 'medium') => {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'info';
      default:
        return 'info';
    }
  };

  // Skeleton Loading Component
  const SkeletonLoader = () => (
    <Box sx={{ width: '100%', p: 3 }}>
      {/* Header Skeleton */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Skeleton variant="text" width={300} height={48} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Skeleton variant="rectangular" width={80} height={36} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" width={90} height={36} sx={{ borderRadius: 1 }} />
        </Box>
      </Box>

      {/* Health Score Skeleton */}
      <Paper sx={{ p: 3, mb: 2, borderRadius: 2 }}>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={4}>
            <Box textAlign="center">
              <Skeleton variant="circular" width={120} height={120} sx={{ mx: 'auto', mb: 1 }} />
              <Skeleton variant="rectangular" width={120} height={36} sx={{ borderRadius: 2, mx: 'auto', mt: 2 }} />
            </Box>
          </Grid>
          <Grid item xs={12} md={8}>
            <Grid container spacing={2}>
              {[1, 2, 3, 4].map((i) => (
                <Grid item xs={6} sm={3} key={i}>
                  <Card variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                    <Skeleton variant="circular" width={60} height={60} sx={{ mx: 'auto', mb: 1 }} />
                    <Skeleton variant="text" width={80} height={20} sx={{ mx: 'auto' }} />
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* Critical Action Skeleton */}
      <Skeleton variant="rectangular" width="100%" height={80} sx={{ borderRadius: 1, mb: 2 }} />

      {/* Accordions Skeleton */}
      {[1, 2, 3, 4].map((i) => (
        <Paper key={i} variant="outlined" sx={{ mb: 1 }}>
          <Box sx={{ p: 2 }}>
            <Skeleton variant="text" width={200} height={32} />
          </Box>
        </Paper>
      ))}
    </Box>
  );

  if (loading && !intelligence) {
    return <SkeletonLoader />;
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
    healthBreakdown,
    dataQuality
  } = intelligence;

  // Filter out dismissed warnings
  const activeWarnings = dataQuality?.warnings.filter(w => !dismissedWarnings.has(w.type)) || [];

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
            startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={fetchIntelligence}
            disabled={loading}
            size="small"
            sx={{
              minWidth: 100,
              textTransform: 'none'
            }}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
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

      <AccountsModal
        isOpen={accountsModalOpen}
        onClose={() => {
          setAccountsModalOpen(false);
          fetchIntelligence();
        }}
      />

      <AccountPairingModal
        isOpen={pairingModalOpen}
        onClose={() => {
          setPairingModalOpen(false);
          fetchIntelligence();
        }}
      />

      <CategoryHierarchyModal
        open={categoryModalOpen}
        onClose={() => {
          setCategoryModalOpen(false);
          fetchIntelligence();
        }}
      />

      {/* Data Quality Warnings */}
      {activeWarnings.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {activeWarnings.map((warning) => (
            <Collapse in={!dismissedWarnings.has(warning.type)} key={warning.type}>
              <Alert
                severity={getSeverityColor(warning.severity) as any}
                onClose={() => dismissWarning(warning.type)}
                sx={{
                  mb: 1.5,
                  borderRadius: 2,
                  '& .MuiAlert-message': {
                    width: '100%'
                  }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                      {warning.title}
                    </Typography>
                    <Typography variant="body2">
                      {warning.message}
                    </Typography>
                    {warning.count !== undefined && (
                      <Chip
                        label={`${warning.count} item${warning.count > 1 ? 's' : ''}`}
                        size="small"
                        sx={{ mt: 1 }}
                        color={getSeverityColor(warning.severity) as any}
                      />
                    )}
                  </Box>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleWarningAction(warning.actionTarget)}
                    sx={{
                      ml: 3,
                      minWidth: 140,
                      fontWeight: 600,
                      textTransform: 'none',
                      flexShrink: 0
                    }}
                  >
                    {warning.actionLabel}
                  </Button>
                </Box>
              </Alert>
            </Collapse>
          ))}
        </Box>
      )}

      {/* Enhanced Health Score Overview */}
      <Paper sx={{
        p: 3,
        mb: 2,
        background: `linear-gradient(135deg, ${getHealthScoreColor(overallHealthScore)}15 0%, ${getHealthScoreColor(overallHealthScore)}05 100%)`,
        borderRadius: 2,
        border: `1px solid ${getHealthScoreColor(overallHealthScore)}30`
      }}>
        <Grid container spacing={3} alignItems="center">
          {/* Overall Health Score */}
          <Grid item xs={12} md={4}>
            <Box textAlign="center">
              <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                <CircularProgress
                  variant="determinate"
                  value={overallHealthScore}
                  size={120}
                  thickness={6}
                  sx={{
                    color: getHealthScoreColor(overallHealthScore),
                    '& .MuiCircularProgress-circle': {
                      strokeLinecap: 'round',
                    },
                  }}
                />
                <Box
                  sx={{
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                  }}
                >
                  <Typography variant="h3" fontWeight="bold" color={getHealthScoreColor(overallHealthScore)}>
                    {overallHealthScore}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.5rem' }}>
                    Health Score
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="medium"
                  startIcon={<TrendIcon />}
                  onClick={() => setRoadmapModalOpen(true)}
                  sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    px: 3
                  }}
                >
                  Improve Score
                </Button>
              </Box>
            </Box>
          </Grid>

          {/* Health Breakdown Metrics */}
          <Grid item xs={12} md={8}>
            <Grid container spacing={2}>
              {Object.entries(healthBreakdown).slice(0, 4).map(([key, value]) => {
                const score = value as number;
                const color = getHealthScoreColor(score);

                return (
                  <Grid item xs={6} sm={3} key={key}>
                    <Tooltip
                      title={getHealthMetricTooltip(key)}
                      placement="top"
                      arrow
                    >
                      <Card
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          textAlign: 'center',
                          cursor: 'help',
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            transform: 'translateY(-2px)',
                            boxShadow: 2,
                            borderColor: color + '80'
                          },
                          borderColor: color + '40'
                        }}
                      >
                        <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                          <CircularProgress
                            variant="determinate"
                            value={score}
                            size={60}
                            thickness={5}
                            sx={{
                              color: color,
                              '& .MuiCircularProgress-circle': {
                                strokeLinecap: 'round',
                              },
                            }}
                          />
                          <Box
                            sx={{
                              top: 0,
                              left: 0,
                              bottom: 0,
                              right: 0,
                              position: 'absolute',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Typography variant="h6" fontWeight="bold" color={color}>
                              {score}
                            </Typography>
                          </Box>
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 0.5 }}>
                          <Box sx={{ color: color, display: 'flex', fontSize: '0.9rem' }}>
                            {getHealthMetricIcon(key)}
                          </Box>
                          <HelpIcon sx={{ fontSize: '0.7rem', color: 'text.disabled' }} />
                        </Box>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            fontSize: '0.7rem',
                            fontWeight: 500,
                            lineHeight: 1.2
                          }}
                        >
                          {getHealthMetricName(key)}
                        </Typography>
                      </Card>
                    </Tooltip>
                  </Grid>
                );
              })}
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* Enhanced Critical Actions */}
      {recommendations.length > 0 && (
        <Card
          sx={(theme) => ({
            mb: 3,
            background: theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(255, 152, 0, 0.15) 0%, rgba(255, 152, 0, 0.05) 100%)'
              : 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)',
            border: `2px solid ${theme.palette.warning.main}`,
            borderRadius: 2,
            position: 'relative',
            overflow: 'visible'
          })}
        >
          <Box
            sx={{
              position: 'absolute',
              top: -8,
              left: 20,
              bgcolor: 'warning.main',
              color: 'warning.contrastText',
              px: 2,
              py: 0.5,
              borderRadius: 1,
              fontSize: '0.75rem',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}
          >
            <WarningIcon sx={{ fontSize: '1rem' }} />
            PRIORITY ACTION
          </Box>
          <CardContent sx={{ pt: 3 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={8}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <PriorityIcon color="warning" />
                  <Typography variant="h6" fontWeight="bold" color="primary">
                    {recommendations[0].title}
                  </Typography>
                </Box>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  {recommendations[0].message}
                </Typography>
                {recommendations[0].potentialSavings && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <MoneyIcon color="success" />
                    <Typography variant="body2" fontWeight="bold" color="success.main">
                      Potential savings: {formatCurrencyValue(recommendations[0].potentialSavings)}/month
                    </Typography>
                  </Box>
                )}
              </Grid>
              <Grid item xs={12} md={4}>
                <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                  <Button
                    variant="contained"
                    color="warning"
                    size="large"
                    startIcon={<CheckIcon />}
                    sx={{
                      borderRadius: 2,
                      textTransform: 'none',
                      fontWeight: 600,
                      px: 3,
                      py: 1.5
                    }}
                  >
                    Take Action
                  </Button>
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Enhanced Action Sections with Multi-Expand */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DashboardIcon color="primary" sx={{ fontSize: 28 }} />
            <Box>
              <Typography variant="h5" fontWeight="bold" color="primary.main">
                Financial Analysis Dashboard
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Comprehensive insights and actionable recommendations
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Expand all sections for full view">
              <Button
                size="small"
                variant="outlined"
                onClick={() => setExpandedSections({
                  actions: true,
                  recurring: true,
                  opportunities: true,
                  insights: true
                })}
                sx={{ textTransform: 'none' }}
                startIcon={<ExpandMoreIcon />}
              >
                Expand All
              </Button>
            </Tooltip>
            <Tooltip title="Collapse all sections to summary view">
              <Button
                size="small"
                variant="outlined"
                onClick={() => setExpandedSections({
                  actions: true,
                  recurring: false,
                  opportunities: false,
                  insights: false
                })}
                sx={{ textTransform: 'none' }}
                startIcon={<ExpandMoreIcon sx={{ transform: 'rotate(180deg)' }} />}
              >
                Collapse All
              </Button>
            </Tooltip>
          </Box>
        </Box>
      </Paper>

      <Accordion
        expanded={expandedSections.actions}
        onChange={() => setExpandedSections(prev => ({ ...prev, actions: !prev.actions }))}
        sx={{
          mb: 2,
          borderRadius: 2,
          '&:before': { display: 'none' },
          boxShadow: expandedSections.actions ? 2 : 1,
          transition: 'all 0.2s ease-in-out'
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{
            borderRadius: 2,
            bgcolor: expandedSections.actions ? 'primary.main' : 'background.paper',
            color: expandedSections.actions ? 'primary.contrastText' : 'text.primary',
            '&:hover': {
              bgcolor: expandedSections.actions ? 'primary.dark' : (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50')
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ActionIcon sx={{ fontSize: 20 }} />
            <Typography variant="h6" fontWeight="bold">Your Action Items</Typography>
            <Chip
              label="Priority"
              size="small"
              color={expandedSections.actions ? 'secondary' : 'primary'}
              variant={expandedSections.actions ? 'filled' : 'outlined'}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <ActionItemsDashboard />
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.recurring}
        onChange={() => setExpandedSections(prev => ({ ...prev, recurring: !prev.recurring }))}
        sx={{
          mb: 2,
          borderRadius: 2,
          '&:before': { display: 'none' },
          boxShadow: expandedSections.recurring ? 2 : 1,
          transition: 'all 0.2s ease-in-out'
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{
            borderRadius: 2,
            bgcolor: expandedSections.recurring ? 'info.main' : 'background.paper',
            color: expandedSections.recurring ? 'info.contrastText' : 'text.primary',
            '&:hover': {
              bgcolor: expandedSections.recurring ? 'info.dark' : (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50')
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <RecurringIcon sx={{ fontSize: 20 }} />
            <Typography variant="h6" fontWeight="bold">Recurring Charges</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <RecurringTransactionManager months={3} />
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.opportunities}
        onChange={() => setExpandedSections(prev => ({ ...prev, opportunities: !prev.opportunities }))}
        sx={{
          mb: 2,
          borderRadius: 2,
          '&:before': { display: 'none' },
          boxShadow: expandedSections.opportunities ? 2 : 1,
          transition: 'all 0.2s ease-in-out'
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{
            borderRadius: 2,
            bgcolor: expandedSections.opportunities ? 'success.main' : 'background.paper',
            color: expandedSections.opportunities ? 'success.contrastText' : 'text.primary',
            '&:hover': {
              bgcolor: expandedSections.opportunities ? 'success.dark' : (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50')
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <OpportunityIcon sx={{ fontSize: 20 }} />
            <Typography variant="h6" fontWeight="bold">Spending Opportunities</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <CategoryOpportunitiesPanel />
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.insights}
        onChange={() => setExpandedSections(prev => ({ ...prev, insights: !prev.insights }))}
        sx={{
          mb: 2,
          borderRadius: 2,
          '&:before': { display: 'none' },
          boxShadow: expandedSections.insights ? 2 : 1,
          transition: 'all 0.2s ease-in-out'
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{
            borderRadius: 2,
            bgcolor: expandedSections.insights ? 'secondary.main' : 'background.paper',
            color: expandedSections.insights ? 'secondary.contrastText' : 'text.primary',
            '&:hover': {
              bgcolor: expandedSections.insights ? 'secondary.dark' : (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50')
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InsightsIcon sx={{ fontSize: 20 }} />
            <Typography variant="h6" fontWeight="bold">Financial Insights</Typography>
          </Box>
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
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          Spending by Hour of Day
                        </Typography>
                        {temporal.preciseTimePercentage !== undefined && temporal.preciseTimePercentage < 50 && (
                          <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.7rem' }}>
                            ⚠ Only {temporal.preciseTimePercentage}% of transactions have precise times
                          </Typography>
                        )}
                      </Box>
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
                          color: 'success.light',
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

      {/* Floating Action Button for Quick Refresh */}
      <Fab
        color="primary"
        aria-label="refresh"
        onClick={fetchIntelligence}
        disabled={loading}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1000
        }}
      >
        {loading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
      </Fab>
    </Box>
  );
};

export default AnalysisPage;
