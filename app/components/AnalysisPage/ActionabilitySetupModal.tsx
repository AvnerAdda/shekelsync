import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  Select,
  MenuItem,
  Typography,
  Box,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  InputAdornment,
  useTheme,
} from '@mui/material';
import {
  Close as CloseIcon,
  Settings as SettingsIcon,
  Info as InfoIcon,
  RestartAlt as ResetIcon,
  Search as SearchIcon,
  TrendingDown as LowIcon,
  TrendingFlat as MediumIcon,
  TrendingUp as HighIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../../contexts/FinancePrivacyContext';
import { apiClient } from '@/lib/api-client';

interface Category {
  category_definition_id: number;
  subcategory: string;
  subcategory_en: string;
  parent_category: string;
  parent_category_en: string;
  transaction_count: number;
  total_amount: number;
  monthly_average: number;
  actionability_level: 'low' | 'medium' | 'high';
  is_default: boolean;
  user_notes?: string;
}

interface ActionabilitySetupModalProps {
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}

type SortField = 'amount' | 'category' | 'level';
type SortDirection = 'asc' | 'desc';

const ActionabilitySetupModal: React.FC<ActionabilitySetupModalProps> = ({ open, onClose, onSave }) => {
  const theme = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('amount');
  const sortDirection: SortDirection = 'desc';
  const [searchQuery, setSearchQuery] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const { formatCurrency } = useFinancePrivacy();

  useEffect(() => {
    if (open) {
      fetchCategories();
    }
  }, [open]);

  const fetchCategories = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get('/api/analytics/category-spending-summary?months=3');
      if (!response.ok) throw new Error(response.statusText || 'Failed to fetch categories');

      const data = response.data as any;
      setCategories(Array.isArray(data?.categories) ? data.categories : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching categories:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActionabilityChange = (categoryId: number, newLevel: 'low' | 'medium' | 'high') => {
    setCategories(prev =>
      prev.map(cat =>
        cat.category_definition_id === categoryId
          ? { ...cat, actionability_level: newLevel, is_default: false }
          : cat
      )
    );
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const settings = categories.map(cat => ({
        category_definition_id: cat.category_definition_id,
        parent_category: cat.parent_category,
        subcategory: cat.subcategory,
        actionability_level: cat.actionability_level,
        monthly_average: cat.monthly_average,
        transaction_count: cat.transaction_count,
        user_notes: cat.user_notes
      }));

      const response = await apiClient.post('/api/analytics/actionability-settings', { settings });

      if (!response.ok) throw new Error(response.statusText || 'Failed to save settings');

      setHasChanges(false);
      if (onSave) onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      console.error('Error saving settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all categories to default actionability levels?')) return;

    try {
      const response = await apiClient.delete('/api/analytics/actionability-settings');

      if (!response.ok) throw new Error(response.statusText || 'Failed to reset');

      await fetchCategories();
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    }
  };

  const sortedAndFilteredCategories = useMemo(() => {
    let filtered = [...categories];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        cat =>
          cat.subcategory?.toLowerCase().includes(query) ||
          cat.parent_category?.toLowerCase().includes(query) ||
          cat.subcategory_en?.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'amount':
          comparison = (a.monthly_average || 0) - (b.monthly_average || 0);
          break;
        case 'category':
          comparison = (a.subcategory || '').localeCompare(b.subcategory || '');
          break;
        case 'level': {
          const levelOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
          comparison = (levelOrder[a.actionability_level] || 0) - (levelOrder[b.actionability_level] || 0);
          break;
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [categories, sortField, sortDirection, searchQuery]);

  const groupedByLevel = useMemo(() => {
    return {
      low: sortedAndFilteredCategories.filter(c => c.actionability_level === 'low'),
      medium: sortedAndFilteredCategories.filter(c => c.actionability_level === 'medium'),
      high: sortedAndFilteredCategories.filter(c => c.actionability_level === 'high')
    };
  }, [sortedAndFilteredCategories]);

  const getActionabilityIcon = (level: string) => {
    switch (level) {
      case 'low': return <LowIcon fontSize="small" />;
      case 'medium': return <MediumIcon fontSize="small" />;
      case 'high': return <HighIcon fontSize="small" />;
      default: return null;
    }
  };

  const renderCategoryRow = (cat: Category) => (
    <TableRow key={cat.category_definition_id} hover>
      <TableCell>
        <Box>
          <Typography variant="body2" fontWeight="medium">
            {cat.subcategory}
          </Typography>
          {cat.parent_category && cat.parent_category !== cat.subcategory && (
            <Typography variant="caption" color="text.secondary">
              {cat.parent_category}
            </Typography>
          )}
        </Box>
      </TableCell>
      <TableCell align="right">
        <Typography variant="body2" fontWeight="medium">
          {formatCurrency(cat.monthly_average, { maximumFractionDigits: 0 })}/mo
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {cat.transaction_count} transactions
        </Typography>
      </TableCell>
      <TableCell>
        <FormControl size="small" fullWidth>
          <Select
            value={cat.actionability_level}
            onChange={(e) => handleActionabilityChange(cat.category_definition_id, e.target.value as any)}
            startAdornment={getActionabilityIcon(cat.actionability_level)}
          >
            <MenuItem value="low">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LowIcon fontSize="small" color="error" />
                <Typography>Low (Fixed)</Typography>
              </Box>
            </MenuItem>
            <MenuItem value="medium">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <MediumIcon fontSize="small" color="warning" />
                <Typography>Medium (Optimize)</Typography>
              </Box>
            </MenuItem>
            <MenuItem value="high">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <HighIcon fontSize="small" color="success" />
                <Typography>High (Flexible)</Typography>
              </Box>
            </MenuItem>
          </Select>
        </FormControl>
      </TableCell>
    </TableRow>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SettingsIcon />
            <Typography variant="h6">Actionability Settings</Typography>
            <Tooltip title="Define which expenses you can realistically adjust to improve your financial health">
              <InfoIcon fontSize="small" color="action" />
            </Tooltip>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Set actionability levels for each category to identify improvement opportunities
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Controls */}
        <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
            sx={{ flex: 1, minWidth: 200 }}
          />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              displayEmpty
            >
              <MenuItem value="amount">Sort by Amount</MenuItem>
              <MenuItem value="category">Sort by Category</MenuItem>
              <MenuItem value="level">Sort by Level</MenuItem>
            </Select>
          </FormControl>

          <Button
            size="small"
            startIcon={<ResetIcon />}
            onClick={handleReset}
            variant="outlined"
          >
            Reset to Defaults
          </Button>
        </Box>

        {/* Summary */}
        <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            icon={<LowIcon />}
            label={`Low: ${groupedByLevel.low.length}`}
            color="error"
            variant="outlined"
            size="small"
          />
          <Chip
            icon={<MediumIcon />}
            label={`Medium: ${groupedByLevel.medium.length}`}
            color="warning"
            variant="outlined"
            size="small"
          />
          <Chip
            icon={<HighIcon />}
            label={`High: ${groupedByLevel.high.length}`}
            color="success"
            variant="outlined"
            size="small"
          />
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Category</strong></TableCell>
                  <TableCell align="right"><strong>Monthly Avg</strong></TableCell>
                  <TableCell><strong>Actionability Level</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedAndFilteredCategories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      <Typography variant="body2" color="text.secondary" py={3}>
                        No categories found
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedAndFilteredCategories.map(renderCategoryRow)
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Legend */}
        <Box sx={{ mt: 2, p: 2, bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            <strong>Actionability Levels:</strong>
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              <strong style={{ color: theme.palette.error.main }}>🔴 Low:</strong> Fixed costs (Insurance, Rent, Mortgage) - Limited optimization potential
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <strong style={{ color: theme.palette.warning.main }}>🟡 Medium:</strong> Can optimize (Phone, Internet, Utilities) - Negotiate or reduce
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <strong style={{ color: theme.palette.success.main }}>🟢 High:</strong> Flexible spending (Food, Entertainment) - Easiest to reduce
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ActionabilitySetupModal;
