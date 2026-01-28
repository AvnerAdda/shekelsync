import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Grid,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  InputAdornment,
  useTheme,
  Alert,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Add as AddIcon, Savings as SavingsIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import SavingsGoalCard from './SavingsGoalCard';

interface SavingsGoal {
  id: number;
  name: string;
  description?: string;
  target_amount: number;
  current_amount: number;
  currency: string;
  target_date?: string;
  start_date: string;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  progress_percent: number;
  days_remaining?: number;
  icon?: string;
  color?: string;
  is_recurring: boolean;
  recurring_amount?: number;
}

interface SavingsGoalsResponse {
  goals: SavingsGoal[];
  count: number;
  summary: {
    totalTargetAmount: number;
    totalCurrentAmount: number;
    activeGoals: number;
    completedGoals: number;
  };
}

const SavingsGoalsPanel: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('translation');
  
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [summary, setSummary] = useState<SavingsGoalsResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // New goal dialog
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newGoalDescription, setNewGoalDescription] = useState('');
  const [creating, setCreating] = useState(false);
  
  // Contribution dialog
  const [contributionGoal, setContributionGoal] = useState<SavingsGoal | null>(null);
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributionNote, setContributionNote] = useState('');
  const [addingContribution, setAddingContribution] = useState(false);

  const fetchGoals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get<SavingsGoalsResponse>('/api/savings-goals');
      if (response.ok && response.data) {
        setGoals(response.data.goals || []);
        setSummary(response.data.summary || null);
      } else {
        setError('Failed to load savings goals');
      }
    } catch (err) {
      console.error('Error fetching savings goals:', err);
      setError('Failed to load savings goals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const handleCreateGoal = async () => {
    if (!newGoalName.trim() || !newGoalTarget) return;
    
    try {
      setCreating(true);
      const response = await apiClient.post('/api/savings-goals', {
        name: newGoalName.trim(),
        description: newGoalDescription.trim() || undefined,
        target_amount: parseFloat(newGoalTarget),
      });
      
      if (response.ok) {
        setNewGoalOpen(false);
        setNewGoalName('');
        setNewGoalTarget('');
        setNewGoalDescription('');
        fetchGoals();
      }
    } catch (err) {
      console.error('Error creating goal:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleAddContribution = async () => {
    if (!contributionGoal || !contributionAmount) return;
    
    try {
      setAddingContribution(true);
      const response = await apiClient.post(`/api/savings-goals/${contributionGoal.id}/contributions`, {
        amount: parseFloat(contributionAmount),
        note: contributionNote.trim() || undefined,
      });
      
      if (response.ok) {
        setContributionGoal(null);
        setContributionAmount('');
        setContributionNote('');
        fetchGoals();
      }
    } catch (err) {
      console.error('Error adding contribution:', err);
    } finally {
      setAddingContribution(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>
            {t('savingsGoals.title', 'Savings Goals')}
          </Typography>
          {summary && (
            <Typography variant="body2" color="text.secondary">
              {formatCurrency(summary.totalCurrentAmount)} / {formatCurrency(summary.totalTargetAmount)}
              {' '}{t('savingsGoals.saved', 'saved')}
            </Typography>
          )}
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setNewGoalOpen(true)}
          sx={{ borderRadius: 2 }}
        >
          {t('savingsGoals.newGoal', 'New Goal')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Goals Grid */}
      {goals.length > 0 ? (
        <Grid container spacing={2}>
          {goals.map((goal) => (
            <Grid item xs={12} sm={6} md={4} key={goal.id}>
              <SavingsGoalCard
                goal={goal}
                onAddContribution={(g) => setContributionGoal(g)}
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Box
          sx={{
            textAlign: 'center',
            py: 6,
            backgroundColor: alpha(theme.palette.background.paper, 0.5),
            borderRadius: 3,
            border: `1px dashed ${alpha(theme.palette.divider, 0.3)}`,
          }}
        >
          <SavingsIcon sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 2 }} />
          <Typography variant="body1" color="text.secondary" gutterBottom>
            {t('savingsGoals.noGoals', 'No savings goals yet')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('savingsGoals.createFirst', 'Create your first goal to start tracking your savings')}
          </Typography>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setNewGoalOpen(true)}
          >
            {t('savingsGoals.createGoal', 'Create Goal')}
          </Button>
        </Box>
      )}

      {/* New Goal Dialog */}
      <Dialog
        open={newGoalOpen}
        onClose={() => setNewGoalOpen(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="new-goal-dialog-title"
      >
        <DialogTitle id="new-goal-dialog-title">
          {t('savingsGoals.newGoal', 'New Savings Goal')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label={t('savingsGoals.goalName', 'Goal Name')}
              value={newGoalName}
              onChange={(e) => setNewGoalName(e.target.value)}
              fullWidth
              required
              placeholder={t('savingsGoals.goalNamePlaceholder', 'e.g., Emergency Fund')}
            />
            <TextField
              label={t('savingsGoals.targetAmount', 'Target Amount')}
              value={newGoalTarget}
              onChange={(e) => setNewGoalTarget(e.target.value.replace(/[^0-9.]/g, ''))}
              fullWidth
              required
              type="text"
              InputProps={{
                startAdornment: <InputAdornment position="start">₪</InputAdornment>,
              }}
            />
            <TextField
              label={t('savingsGoals.description', 'Description (optional)')}
              value={newGoalDescription}
              onChange={(e) => setNewGoalDescription(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNewGoalOpen(false)} disabled={creating}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleCreateGoal}
            variant="contained"
            disabled={!newGoalName.trim() || !newGoalTarget || creating}
          >
            {creating ? <CircularProgress size={20} /> : t('common.create', 'Create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Contribution Dialog */}
      <Dialog
        open={!!contributionGoal}
        onClose={() => setContributionGoal(null)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="contribution-dialog-title"
      >
        <DialogTitle id="contribution-dialog-title">
          {t('savingsGoals.addContribution', 'Add Contribution')}
          {contributionGoal && (
            <Typography variant="body2" color="text.secondary">
              {contributionGoal.name}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label={t('savingsGoals.amount', 'Amount')}
              value={contributionAmount}
              onChange={(e) => setContributionAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              fullWidth
              required
              type="text"
              autoFocus
              InputProps={{
                startAdornment: <InputAdornment position="start">₪</InputAdornment>,
              }}
            />
            <TextField
              label={t('savingsGoals.note', 'Note (optional)')}
              value={contributionNote}
              onChange={(e) => setContributionNote(e.target.value)}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setContributionGoal(null)} disabled={addingContribution}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleAddContribution}
            variant="contained"
            disabled={!contributionAmount || addingContribution}
          >
            {addingContribution ? <CircularProgress size={20} /> : t('common.add', 'Add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SavingsGoalsPanel;
