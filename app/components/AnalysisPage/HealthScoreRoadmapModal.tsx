import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  LinearProgress,
  Chip,
  Card,
  CardContent,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Alert,
  Slider,
  Tab,
  Tabs,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Stack
} from '@mui/material';
import {
  Close as CloseIcon,
  TrendingUp as TrendingUpIcon,
  CheckCircle as CheckCircleIcon,
  EmojiEvents as TrophyIcon,
  Timeline as TimelineIcon,
  Speed as SpeedIcon,
  Star as StarIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayIcon
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';

interface HealthScoreRoadmapModalProps {
  open: boolean;
  onClose: () => void;
  currentScore: number;
}

interface ImprovementAction {
  id: string;
  category: string;
  title: string;
  description: string;
  current_value: number;
  target_value: number;
  impact: number;
  difficulty: 'easy' | 'medium' | 'hard';
  timeframe: string;
  action_items: string[];
  cumulative_score?: number;
}

interface Phase {
  name: string;
  actions: ImprovementAction[];
  total_impact: number;
}

interface RoadmapData {
  current_score: number;
  target_score: number;
  gap: number;
  improvement_actions: ImprovementAction[];
  roadmap: {
    status: string;
    message: string;
    recommended_actions: ImprovementAction[];
    phases: {
      phase_1: Phase;
      phase_2: Phase;
      phase_3: Phase;
    };
    estimated_final_score: number;
  };
  estimated_timeframe: string;
  summary: {
    total_actions: number;
    high_impact_actions: number;
    total_potential_points: number;
    achievability: string;
  };
}

const HealthScoreRoadmapModal: React.FC<HealthScoreRoadmapModalProps> = ({
  open,
  onClose,
  currentScore: propCurrentScore
}) => {
  const [roadmapData, setRoadmapData] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetScore, setTargetScore] = useState(85);
  const [currentTab, setCurrentTab] = useState(0);
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      fetchRoadmap(targetScore);
    }
  }, [open, targetScore]);

  const fetchRoadmap = async (target: number) => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(
        `/api/analytics/health-score-roadmap?targetScore=${target}&months=6`
      );

      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch roadmap');
      }

      const data = response.data as any;
      setRoadmapData(data ?? null);
    } catch (err) {
      console.error('Error fetching roadmap:', err);
      setError(err instanceof Error ? err.message : 'Failed to load roadmap');
    } finally {
      setLoading(false);
    }
  };

  const handleTargetScoreChange = (event: Event, newValue: number | number[]) => {
    setTargetScore(newValue as number);
  };

  const toggleAction = (actionId: string) => {
    const newSelected = new Set(selectedActions);
    if (newSelected.has(actionId)) {
      newSelected.delete(actionId);
    } else {
      newSelected.add(actionId);
    }
    setSelectedActions(newSelected);
  };

  const calculateSimulatedScore = () => {
    if (!roadmapData) return propCurrentScore;
    
    const selectedImpact = roadmapData.improvement_actions
      .filter(action => selectedActions.has(action.id))
      .reduce((sum, action) => sum + action.impact, 0);
    
    return Math.min(100, roadmapData.current_score + selectedImpact);
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return 'success';
      case 'medium': return 'warning';
      case 'hard': return 'error';
      default: return 'default';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'health_component': return '🎯';
      case 'spending_optimization': return '💰';
      case 'recurring_optimization': return '🔄';
      case 'savings': return '🏦';
      case 'habits': return '📊';
      default: return '✅';
    }
  };

  const getAchievabilityColor = (achievability: string) => {
    switch (achievability) {
      case 'highly_achievable': return 'success';
      case 'achievable': return 'info';
      case 'challenging': return 'warning';
      case 'very_challenging': return 'error';
      default: return 'default';
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogContent>
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="h6" gutterBottom>
              Generating Your Personalized Roadmap...
            </Typography>
            <LinearProgress sx={{ mt: 2 }} />
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !roadmapData) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogContent>
          <Alert severity="error">{error || 'Failed to load roadmap'}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
    );
  }

  const simulatedScore = calculateSimulatedScore();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TrophyIcon color="primary" />
            <Typography variant="h6">Health Score Improvement Roadmap</Typography>
          </Box>
          <Button onClick={onClose} color="inherit">
            <CloseIcon />
          </Button>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Score Overview */}
        <Card sx={{ mb: 3, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
          <CardContent>
            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Typography variant="caption">Current Score</Typography>
                <Typography variant="h3">{roadmapData.current_score}</Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={roadmapData.current_score} 
                  sx={{ mt: 1, height: 8, borderRadius: 1 }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption">Target Score</Typography>
                <Typography variant="h3">{roadmapData.target_score}</Typography>
                <Box sx={{ mt: 1 }}>
                  <Slider
                    value={targetScore}
                    onChange={handleTargetScoreChange}
                    min={roadmapData.current_score + 1}
                    max={100}
                    marks
                    valueLabelDisplay="auto"
                    sx={{ color: 'white' }}
                  />
                </Box>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption">Gap to Close</Typography>
                <Typography variant="h3">+{roadmapData.gap}</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Estimated: {roadmapData.estimated_timeframe}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="caption">
                  Total Actions
                </Typography>
                <Typography variant="h4">
                  {roadmapData.summary.total_actions}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="caption">
                  High Impact
                </Typography>
                <Typography variant="h4" color="error.main">
                  {roadmapData.summary.high_impact_actions}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="caption">
                  Potential Points
                </Typography>
                <Typography variant="h4" color="success.main">
                  +{roadmapData.summary.total_potential_points}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="caption">
                  Achievability
                </Typography>
                <Chip
                  label={roadmapData.summary.achievability.replace(/_/g, ' ')}
                  color={getAchievabilityColor(roadmapData.summary.achievability)}
                  size="small"
                  sx={{ mt: 1 }}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Roadmap Status */}
        <Alert 
          severity={roadmapData.roadmap.status === 'achievable' ? 'success' : 'info'}
          sx={{ mb: 3 }}
        >
          {roadmapData.roadmap.message}
        </Alert>

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={currentTab} onChange={(e, v) => setCurrentTab(v)}>
            <Tab label="Recommended Path" icon={<TimelineIcon />} />
            <Tab label="All Actions" icon={<TrendingUpIcon />} />
            <Tab label="Score Simulator" icon={<SpeedIcon />} />
          </Tabs>
        </Box>

        {/* Tab 1: Recommended Path (Phased) */}
        {currentTab === 0 && (
          <Box>
            {Object.entries(roadmapData.roadmap.phases).map(([key, phase]) => (
              <Accordion key={key} defaultExpanded={key === 'phase_1'}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                    <Typography variant="h6">{phase.name}</Typography>
                    <Chip 
                      label={`+${phase.total_impact} points`} 
                      color="primary" 
                      size="small"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {phase.actions.length} actions
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    {phase.actions.map((action) => (
                      <Card key={action.id} variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body1">
                                {getCategoryIcon(action.category)}
                              </Typography>
                              <Typography variant="subtitle1" fontWeight="bold">
                                {action.title}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Chip 
                                label={`+${action.impact}`} 
                                color="success" 
                                size="small"
                                icon={<StarIcon />}
                              />
                              <Chip 
                                label={action.difficulty} 
                                color={getDifficultyColor(action.difficulty)}
                                size="small"
                              />
                            </Box>
                          </Box>
                          <Typography variant="body2" color="text.secondary" paragraph>
                            {action.description}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            ⏱️ {action.timeframe}
                          </Typography>
                          
                          {action.action_items && action.action_items.length > 0 && (
                            <List dense>
                              {action.action_items.map((item, idx) => (
                                <ListItem key={idx}>
                                  <ListItemIcon sx={{ minWidth: 30 }}>
                                    <CheckCircleIcon fontSize="small" color="primary" />
                                  </ListItemIcon>
                                  <ListItemText primary={item} />
                                </ListItem>
                              ))}
                            </List>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        )}

        {/* Tab 2: All Actions (Sorted by Impact) */}
        {currentTab === 1 && (
          <Stack spacing={2}>
            {roadmapData.improvement_actions.map((action) => (
              <Card key={action.id} variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'between', alignItems: 'start', mb: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        {getCategoryIcon(action.category)} {action.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {action.description}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, ml: 2 }}>
                      <Chip 
                        label={`+${action.impact} points`} 
                        color="success" 
                        size="small"
                      />
                      <Chip 
                        label={action.difficulty} 
                        color={getDifficultyColor(action.difficulty)}
                        size="small"
                      />
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        {/* Tab 3: Score Simulator */}
        {currentTab === 2 && (
          <Box>
            <Alert severity="info" sx={{ mb: 3 }}>
              Select actions below to see how they would impact your score
            </Alert>

            <Card sx={{ mb: 3, bgcolor: 'success.light' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Simulated Score
                </Typography>
                <Typography variant="h2" color="success.dark">
                  {simulatedScore}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={simulatedScore} 
                  sx={{ mt: 2, height: 10, borderRadius: 1 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  +{simulatedScore - roadmapData.current_score} points from {selectedActions.size} selected actions
                </Typography>
              </CardContent>
            </Card>

            <Stack spacing={1}>
              {roadmapData.improvement_actions.map((action) => (
                <Card 
                  key={action.id} 
                  variant="outlined"
                  sx={{ 
                    cursor: 'pointer',
                    bgcolor: selectedActions.has(action.id) ? 'action.selected' : 'background.paper',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                  onClick={() => toggleAction(action.id)}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <CheckCircleIcon 
                          color={selectedActions.has(action.id) ? 'primary' : 'disabled'}
                        />
                        <Box>
                          <Typography variant="body1" fontWeight={selectedActions.has(action.id) ? 'bold' : 'normal'}>
                            {action.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {action.timeframe} · {action.difficulty}
                          </Typography>
                        </Box>
                      </Box>
                      <Chip 
                        label={`+${action.impact}`} 
                        color={selectedActions.has(action.id) ? 'primary' : 'default'}
                        size="small"
                      />
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
        <Button 
          variant="contained" 
          startIcon={<PlayIcon />}
          onClick={onClose}
        >
          Start Improving
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default HealthScoreRoadmapModal;
