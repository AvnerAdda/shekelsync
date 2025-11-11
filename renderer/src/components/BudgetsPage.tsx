import React, { useState, useEffect, useCallback } from 'react';
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
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import LockedPagePlaceholder from './EmptyState/LockedPagePlaceholder';
import { apiClient } from '@/lib/api-client';

interface BudgetBase {
  id: number;
  category_definition_id: number;
  category_name: string;
  category_name_en?: string | null;
  parent_category_name: string | null;
  parent_category_name_en?: string | null;
  period_type: 'weekly' | 'monthly' | 'yearly';
  budget_limit: number;
  is_active: boolean;
}

interface BudgetUsage extends BudgetBase {
  spent: number;
  remaining: number;
  percentage: number;
  status: 'good' | 'warning' | 'exceeded';
}

interface CategoryOption {
  id: number;
  name: string;
  parentName: string | null;
  label: string;
}

interface CategoryHierarchyNode {
  id: number;
  name: string;
  name_en?: string | null;
  parent_id?: number | null;
  is_active: boolean;
  category_type: string;
}

interface CategoryHierarchyResponse {
  categories?: CategoryHierarchyNode[];
}

const BudgetsPage: React.FC = () => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const accessStatus = getPageAccessStatus('budgets');
  const isLocked = accessStatus.isLocked;

  const [budgets, setBudgets] = useState<BudgetUsage[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetBase | null>(null);
  const [formData, setFormData] = useState({
    category_definition_id: '',
    period_type: 'monthly' as 'weekly' | 'monthly' | 'yearly',
    budget_limit: '',
  });

  const fetchBudgets = useCallback(async () => {
    if (isLocked) {
      return;
    }
    try {
      const response = await apiClient.get('/api/budgets/usage');
      if (!response.ok) {
        throw new Error('Failed to fetch budgets');
      }
      const data = response.data as BudgetUsage[] | undefined;
      setBudgets(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching budgets:', error);
      setBudgets([]);
    }
  }, [isLocked]);

  const fetchCategories = useCallback(async () => {
    if (isLocked) {
      return;
    }
    try {
      const response = await apiClient.get('/api/categories/hierarchy?type=expense');
      if (!response.ok) {
        throw new Error('Failed to fetch categories');
      }
      const data = response.data as CategoryHierarchyResponse;

      if (Array.isArray(data.categories)) {
        const map = new Map<number, CategoryHierarchyNode>();
        data.categories.forEach((cat) => map.set(cat.id, cat));

        const options: CategoryOption[] = data.categories
          .filter((cat) => cat.is_active && cat.category_type === 'expense')
          .map((cat) => {
            const parent = cat.parent_id ? map.get(cat.parent_id) : null;
            const displayName = cat.name_en ? `${cat.name} (${cat.name_en})` : cat.name;
            const label = parent ? `${parent.name} › ${displayName}` : displayName;
            return {
              id: cat.id,
              name: cat.name,
              parentName: parent ? parent.name : null,
              label,
            };
          })
          .sort((a, b) => a.label.localeCompare(b.label));

        setCategories(options);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      setCategories([]);
    }
  }, [isLocked]);

  useEffect(() => {
    if (isLocked) {
      return;
    }
    fetchBudgets();
    fetchCategories();

    // Listen for data refresh events (from scraping, manual transactions, etc.)
    const handleDataRefresh = () => {
      fetchBudgets();
    };
    globalThis.addEventListener('dataRefresh', handleDataRefresh);

    return () => {
      globalThis.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, [fetchBudgets, fetchCategories, isLocked]);

  const handleOpenDialog = (budget?: BudgetBase) => {
    if (budget) {
      setEditingBudget(budget);
      setFormData({
        category_definition_id: budget.category_definition_id.toString(),
        period_type: budget.period_type,
        budget_limit: budget.budget_limit.toString(),
      });
    } else {
      setEditingBudget(null);
      setFormData({
        category_definition_id: '',
        period_type: 'monthly',
        budget_limit: '',
      });
    }
    setDialogOpen(true);
  };

  if (isLocked) {
    return (
      <LockedPagePlaceholder
        page="budgets"
        onboardingStatus={onboardingStatus}
      />
    );
  }

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingBudget(null);
  };

  const handleSaveBudget = async () => {
    try {
      const payload = {
        category_definition_id: parseInt(formData.category_definition_id, 10),
        period_type: formData.period_type,
        budget_limit: parseFloat(formData.budget_limit),
      };

      if (Number.isNaN(payload.category_definition_id)) {
        throw new Error('Invalid category selected');
      }

      if (Number.isNaN(payload.budget_limit) || payload.budget_limit <= 0) {
        throw new Error('Budget limit must be greater than zero');
      }

      if (editingBudget) {
        await apiClient.put('/api/budgets', {
          id: editingBudget.id,
          budget_limit: payload.budget_limit,
        });
      } else {
        await apiClient.post('/api/budgets', payload);
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
      await apiClient.delete(`/api/budgets?id=${id}`);
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
                        {budget.category_name}
                        {budget.category_name_en ? ` (${budget.category_name_en})` : ''}
                      </Typography>
                      {budget.parent_category_name && (
                        <Typography variant="caption" color="text.secondary">
                          {budget.parent_category_name}
                          {budget.parent_category_name_en ? ` (${budget.parent_category_name_en})` : ''}
                        </Typography>
                      )}
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
                value={formData.category_definition_id}
                label="Category"
                onChange={(e) =>
                  setFormData({ ...formData, category_definition_id: e.target.value })
                }
              >
                <MenuItem value="">
                  <em>Select category</em>
                </MenuItem>
                {categories.map((cat) => (
                  <MenuItem key={cat.id} value={cat.id.toString()}>
                    {cat.label}
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
            disabled={!formData.category_definition_id || !formData.budget_limit}
          >
            {editingBudget ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BudgetsPage;
