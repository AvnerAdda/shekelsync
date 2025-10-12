import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  LinearProgress,
  IconButton,
  Alert,
  useTheme,
  Card,
  CardContent,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

interface Budget {
  id: number;
  category: string;
  period_type: 'weekly' | 'monthly' | 'yearly';
  budget_limit: number;
  is_active: boolean;
}

interface BudgetUsage extends Budget {
  spent: number;
  remaining: number;
  percentage: number;
  status: 'good' | 'warning' | 'exceeded';
}

const BudgetsPage: React.FC = () => {
  const [budgets, setBudgets] = useState<BudgetUsage[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [formData, setFormData] = useState({
    category: '',
    period_type: 'monthly' as 'weekly' | 'monthly' | 'yearly',
    budget_limit: '',
  });
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();

  useEffect(() => {
    fetchBudgets();
    fetchCategories();
  }, []);

  const fetchBudgets = async () => {
    try {
      const response = await fetch('/api/budgets/usage');
      if (!response.ok) {
        throw new Error('Failed to fetch budgets');
      }
      const data = await response.json();
      setBudgets(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching budgets:', error);
      setBudgets([]);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/analytics/dashboard?months=1');
      if (!response.ok) {
        throw new Error('Failed to fetch categories');
      }
      const data = await response.json();
      if (data.breakdowns && Array.isArray(data.breakdowns.byCategory)) {
        const uniqueCategories = data.breakdowns.byCategory
          .map((item: any) => item.category)
          .filter((cat: string) => cat !== 'Bank' && cat !== 'Income');
        setCategories(uniqueCategories);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      setCategories([]);
    }
  };

  const handleOpenDialog = (budget?: Budget) => {
    if (budget) {
      setEditingBudget(budget);
      setFormData({
        category: budget.category,
        period_type: budget.period_type,
        budget_limit: budget.budget_limit.toString(),
      });
    } else {
      setEditingBudget(null);
      setFormData({
        category: '',
        period_type: 'monthly',
        budget_limit: '',
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingBudget(null);
  };

  const handleSaveBudget = async () => {
    try {
      const payload = {
        category: formData.category,
        period_type: formData.period_type,
        budget_limit: parseFloat(formData.budget_limit),
      };

      if (editingBudget) {
        await fetch('/api/budgets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingBudget.id,
            budget_limit: payload.budget_limit,
          }),
        });
      } else {
        await fetch('/api/budgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      fetchBudgets();
      handleCloseDialog();
    } catch (error) {
      console.error('Error saving budget:', error);
    }
  };

  const handleDeleteBudget = async (id: number) => {
    if (!confirm('Are you sure you want to delete this budget?')) return;

    try {
      await fetch(`/api/budgets?id=${id}`, {
        method: 'DELETE',
      });
      fetchBudgets();
    } catch (error) {
      console.error('Error deleting budget:', error);
    }
  };

  const formatCurrencyValue = (amount: number) =>
    formatCurrency(amount, { absolute: true, maximumFractionDigits: 0 });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'good':
        return theme.palette.success.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'exceeded':
        return theme.palette.error.main;
      default:
        return theme.palette.grey[500];
    }
  };

  const getPeriodLabel = (period: string) => {
    return period.charAt(0).toUpperCase() + period.slice(1);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Budget Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Create Budget
        </Button>
      </Box>

      {budgets.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary">
            No budgets created yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Create your first budget to start tracking your spending
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {budgets.map((budget) => (
            <Grid item xs={12} md={6} lg={4} key={budget.id}>
              <Card
                sx={{
                  border: `2px solid ${getStatusColor(budget.status)}`,
                  position: 'relative',
                }}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Box>
                      <Typography variant="h6" fontWeight="bold">
                        {budget.category}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {getPeriodLabel(budget.period_type)} Budget
                      </Typography>
                    </Box>
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => handleOpenDialog(budget)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteBudget(budget.id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">
                        Spent: {formatCurrencyValue(budget.spent)}
                      </Typography>
                      <Typography variant="body2">
                        Limit: {formatCurrencyValue(budget.budget_limit)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(budget.percentage, 100)}
                      sx={{
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: theme.palette.grey[200],
                        '& .MuiLinearProgress-bar': {
                          backgroundColor: getStatusColor(budget.status),
                        },
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}
                    >
                      {budget.percentage.toFixed(1)}% used
                    </Typography>
                  </Box>

                  {budget.status === 'exceeded' && (
                    <Alert severity="error" icon={<WarningIcon />} sx={{ mb: 1 }}>
                      Budget exceeded by {formatCurrencyValue(Math.abs(budget.remaining))}
                    </Alert>
                  )}

                  {budget.status === 'warning' && (
                    <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 1 }}>
                      {formatCurrencyValue(budget.remaining)} remaining
                    </Alert>
                  )}

                  {budget.status === 'good' && (
                    <Alert severity="success" icon={<CheckIcon />} sx={{ mb: 1 }}>
                      {formatCurrencyValue(budget.remaining)} remaining
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingBudget ? 'Edit Budget' : 'Create New Budget'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            <FormControl fullWidth disabled={!!editingBudget}>
              <InputLabel>Category</InputLabel>
              <Select
                value={formData.category}
                label="Category"
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
              >
                {categories.map((cat) => (
                  <MenuItem key={cat} value={cat}>
                    {cat}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth disabled={!!editingBudget}>
              <InputLabel>Period</InputLabel>
              <Select
                value={formData.period_type}
                label="Period"
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    period_type: e.target.value as 'weekly' | 'monthly' | 'yearly',
                  })
                }
              >
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
                <MenuItem value="yearly">Yearly</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Budget Limit (₪)"
              type="number"
              fullWidth
              value={formData.budget_limit}
              onChange={(e) =>
                setFormData({ ...formData, budget_limit: e.target.value })
              }
              inputProps={{ min: 0, step: 100 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            onClick={handleSaveBudget}
            variant="contained"
            disabled={!formData.category || !formData.budget_limit}
          >
            {editingBudget ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BudgetsPage;
