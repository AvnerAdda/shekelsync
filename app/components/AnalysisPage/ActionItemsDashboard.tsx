import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  LinearProgress,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Checkbox,
  Alert,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Tooltip,
  CircularProgress
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as UncheckedIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  TrendingUp as TrendingUpIcon,
  EmojiEvents as TrophyIcon,
  PlayArrow as StartIcon,
  Pause as PauseIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Savings as SavingsIcon
} from '@mui/icons-material';

interface ActionItem {
  id: number;
  action_type: string;
  title: string;
  description: string;
  potential_savings: number;
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  category_name: string;
  target_amount: number;
  current_progress: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  created_at: string;
  completed_at?: string;
  progress_percentage: number;
  progress_history?: any[];
}

interface ActionItemsSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  total_potential_savings: number;
  total_achieved_savings: number;
  avg_progress: number;
}

const ActionItemsDashboard: React.FC = () => {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [summary, setSummary] = useState<ActionItemsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState(0);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    title: '',
    description: '',
    action_type: 'spending_optimization',
    potential_savings: 0,
    category_name: '',
    priority: 'medium'
  });

  useEffect(() => {
    fetchActionItems();
  }, []);

  const fetchActionItems = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/analytics/action-items');
      
      if (!response.ok) {
        throw new Error('Failed to fetch action items');
      }

      const data = await response.json();
      setItems(data.items || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Error fetching action items:', err);
      setError(err instanceof Error ? err.message : 'Failed to load action items');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (item: ActionItem) => {
    const newStatus = item.status === 'completed' ? 'in_progress' : 'completed';
    const newProgress = newStatus === 'completed' ? 100 : item.current_progress;

    try {
      const response = await fetch(`/api/analytics/action-items?id=${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          current_progress: newProgress
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update action item');
      }

      await fetchActionItems();
    } catch (err) {
      console.error('Error updating action item:', err);
      alert('Failed to update action item');
    }
  };

  const handleUpdateProgress = async (item: ActionItem, progress: number) => {
    try {
      const response = await fetch(`/api/analytics/action-items?id=${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_progress: progress,
          status: progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'pending'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update progress');
      }

      await fetchActionItems();
    } catch (err) {
      console.error('Error updating progress:', err);
      alert('Failed to update progress');
    }
  };

  const handleDeleteItem = async (id: number) => {
    if (!confirm('Are you sure you want to delete this action item?')) {
      return;
    }

    try {
      const response = await fetch(`/api/analytics/action-items?id=${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete action item');
      }

      await fetchActionItems();
    } catch (err) {
      console.error('Error deleting action item:', err);
      alert('Failed to delete action item');
    }
  };

  const handleAddItem = async () => {
    if (!newItem.title) {
      alert('Please enter a title');
      return;
    }

    try {
      const response = await fetch('/api/analytics/action-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem)
      });

      if (!response.ok) {
        throw new Error('Failed to create action item');
      }

      setAddDialogOpen(false);
      setNewItem({
        title: '',
        description: '',
        action_type: 'spending_optimization',
        potential_savings: 0,
        category_name: '',
        priority: 'medium'
      });
      await fetchActionItems();
    } catch (err) {
      console.error('Error creating action item:', err);
      alert('Failed to create action item');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'error';
      case 'high': return 'warning';
      case 'medium': return 'info';
      case 'low': return 'default';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircleIcon color="success" />;
      case 'in_progress': return <StartIcon color="primary" />;
      case 'pending': return <UncheckedIcon color="action" />;
      default: return <PauseIcon color="disabled" />;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const filterItemsByTab = () => {
    switch (currentTab) {
      case 0: // Active
        return items.filter(i => i.status === 'pending' || i.status === 'in_progress');
      case 1: // Completed
        return items.filter(i => i.status === 'completed');
      case 2: // All
        return items;
      default:
        return items;
    }
  };

  const filteredItems = filterItemsByTab();

  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>
          Loading action items...
        </Typography>
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

  return (
    <Box sx={{ width: '100%', mt: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TrophyIcon color="primary" />
            Action Items Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track your financial improvement actions and measure progress
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddDialogOpen(true)}
        >
          Add Action
        </Button>
      </Box>

      {/* Summary Cards */}
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="caption">
                  Total Actions
                </Typography>
                <Typography variant="h4">
                  {summary.total}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {summary.in_progress} in progress
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="caption">
                  Completed
                </Typography>
                <Typography variant="h4" color="success.main">
                  {summary.completed}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0}% completion
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={6} md={3}>
            <Card sx={{ bgcolor: 'success.light' }}>
              <CardContent>
                <Typography color="success.dark" variant="caption" fontWeight="bold">
                  Savings Achieved
                </Typography>
                <Typography variant="h4" color="success.dark">
                  {formatCurrency(summary.total_achieved_savings)}
                </Typography>
                <Typography variant="caption" color="success.dark">
                  per month
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="caption">
                  Potential Savings
                </Typography>
                <Typography variant="h4" color="primary.main">
                  {formatCurrency(summary.total_potential_savings)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  if all completed
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Progress Bar */}
      {summary && summary.total > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle1">Overall Progress</Typography>
              <Typography variant="body2" color="text.secondary">
                {Math.round(summary.avg_progress)}%
              </Typography>
            </Box>
            <LinearProgress 
              variant="determinate" 
              value={summary.avg_progress} 
              sx={{ height: 10, borderRadius: 1 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Average completion across all actions
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={currentTab} onChange={(e, v) => setCurrentTab(v)}>
          <Tab label={`Active (${(summary?.pending || 0) + (summary?.in_progress || 0)})`} />
          <Tab label={`Completed (${summary?.completed || 0})`} />
          <Tab label={`All (${summary?.total || 0})`} />
        </Tabs>
      </Box>

      {/* Action Items List */}
      {filteredItems.length === 0 ? (
        <Alert severity="info">
          {currentTab === 0 && 'No active action items. Click "Add Action" to get started!'}
          {currentTab === 1 && 'No completed actions yet. Mark actions as complete to see them here.'}
          {currentTab === 2 && 'No action items yet. Add some from the Health Score Roadmap!'}
        </Alert>
      ) : (
        <List>
          {filteredItems.map((item) => (
            <Card key={item.id} sx={{ mb: 2 }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'start', gap: 2 }}>
                  <Checkbox
                    checked={item.status === 'completed'}
                    onChange={() => handleToggleStatus(item)}
                    icon={getStatusIcon(item.status)}
                    checkedIcon={<CheckCircleIcon color="success" />}
                  />
                  
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
                      <Box>
                        <Typography 
                          variant="h6" 
                          sx={{ 
                            textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                            color: item.status === 'completed' ? 'text.secondary' : 'text.primary'
                          }}
                        >
                          {item.title}
                        </Typography>
                        {item.description && (
                          <Typography variant="body2" color="text.secondary">
                            {item.description}
                          </Typography>
                        )}
                      </Box>
                      
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Chip 
                          label={item.priority} 
                          color={getPriorityColor(item.priority)}
                          size="small"
                        />
                        {item.potential_savings > 0 && (
                          <Chip
                            icon={<SavingsIcon />}
                            label={formatCurrency(item.potential_savings)}
                            color="success"
                            size="small"
                          />
                        )}
                        <IconButton size="small" onClick={() => handleDeleteItem(item.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>

                    {item.category_name && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        Category: {item.category_name}
                      </Typography>
                    )}

                    {/* Progress Bar */}
                    {item.status !== 'completed' && (
                      <Box sx={{ mt: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            Progress
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {Math.round(item.progress_percentage)}%
                          </Typography>
                        </Box>
                        <LinearProgress 
                          variant="determinate" 
                          value={item.progress_percentage} 
                          sx={{ height: 6, borderRadius: 1 }}
                        />
                        
                        {/* Progress Slider */}
                        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
                          <Button
                            size="small"
                            onClick={() => handleUpdateProgress(item, Math.max(0, item.progress_percentage - 10))}
                          >
                            -10%
                          </Button>
                          <Button
                            size="small"
                            onClick={() => handleUpdateProgress(item, Math.min(100, item.progress_percentage + 10))}
                          >
                            +10%
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleUpdateProgress(item, 100)}
                          >
                            Complete
                          </Button>
                        </Box>
                      </Box>
                    )}

                    {item.completed_at && (
                      <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 1 }}>
                        ✅ Completed on {new Date(item.completed_at).toLocaleDateString()}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </List>
      )}

      {/* Add Action Dialog */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Action Item</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              fullWidth
              value={newItem.title}
              onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
              required
            />
            
            <TextField
              label="Description"
              fullWidth
              multiline
              rows={3}
              value={newItem.description}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            />

            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                value={newItem.priority}
                label="Priority"
                onChange={(e) => setNewItem({ ...newItem, priority: e.target.value })}
              >
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="critical">Critical</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Potential Monthly Savings (₪)"
              type="number"
              fullWidth
              value={newItem.potential_savings}
              onChange={(e) => setNewItem({ ...newItem, potential_savings: parseFloat(e.target.value) || 0 })}
            />

            <TextField
              label="Category (optional)"
              fullWidth
              value={newItem.category_name}
              onChange={(e) => setNewItem({ ...newItem, category_name: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAddItem} variant="contained">Add Action</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ActionItemsDashboard;
