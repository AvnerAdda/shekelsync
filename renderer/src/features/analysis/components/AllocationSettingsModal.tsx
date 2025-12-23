import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Slider,
  Button,
  Alert,
  Checkbox,
  FormControlLabel,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  CircularProgress,
} from '@mui/material';
import type { SpendingCategory, CategoryWithSpending } from '@renderer/types/spending-categories';

interface AllocationSettingsModalProps {
  open: boolean;
  onClose: () => void;
  targets: Record<SpendingCategory, number>;
  unallocatedCategories: CategoryWithSpending[];
  onUpdateTargets: (targets: Record<SpendingCategory, number>) => Promise<void>;
  onBulkAssign: (categoryIds: number[], allocation: SpendingCategory | null) => Promise<void>;
}

const CATEGORY_COLORS: Record<string, string> = {
  essential: '#2196F3',
  growth: '#4CAF50',
  stability: '#FF9800',
  reward: '#E91E63',
};

const CATEGORY_LABELS: Record<string, string> = {
  essential: 'Essential',
  growth: 'Growth',
  stability: 'Stability',
  reward: 'Reward',
};

const AllocationSettingsModal: React.FC<AllocationSettingsModalProps> = ({
  open,
  onClose,
  targets,
  unallocatedCategories,
  onUpdateTargets,
  onBulkAssign,
}: AllocationSettingsModalProps) => {
  const [editedTargets, setEditedTargets] = useState<Record<SpendingCategory, number>>(targets);
  const [selectedUnallocated, setSelectedUnallocated] = useState<number[]>([]);
  const [assignTo, setAssignTo] = useState<SpendingCategory | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditedTargets(targets);
  }, [targets]);

  const totalPercentage = (Object.values(editedTargets) as number[]).reduce((sum, val) => sum + val, 0);
  const isValid = Math.abs(totalPercentage - 100) < 0.01;

  const handleSliderChange = (category: SpendingCategory, value: number | number[]) => {
    const newValue = Array.isArray(value) ? value[0] : value;
    setEditedTargets((prev: Record<SpendingCategory, number>) => ({ ...prev, [category]: newValue }));
    setError(null);
  };

  const handleToggleCategory = (categoryId: number) => {
    setSelectedUnallocated((prev: number[]) =>
      prev.includes(categoryId)
        ? prev.filter((id: number) => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleSelectAll = () => {
    if (selectedUnallocated.length === unallocatedCategories.length) {
      setSelectedUnallocated([]);
    } else {
      setSelectedUnallocated(unallocatedCategories.map((c: CategoryWithSpending) => c.category_definition_id));
    }
  };

  const handleBulkAssign = async () => {
    if (selectedUnallocated.length === 0 || !assignTo) {
      setError('Select categories and an allocation type');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onBulkAssign(selectedUnallocated, assignTo as SpendingCategory);
      setSelectedUnallocated([]);
      setAssignTo('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign categories');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTargets = async () => {
    if (!isValid) {
      setError('Total must equal 100%');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onUpdateTargets(editedTargets);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save targets');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedTargets(targets);
    setSelectedUnallocated([]);
    setAssignTo('');
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="md" fullWidth>
      <DialogTitle>Allocation Settings</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* Target Percentages Section */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
          Target Allocation Percentages
        </Typography>

        <Alert severity={isValid ? 'success' : 'warning'} sx={{ mb: 2 }}>
          Total: {totalPercentage}% {!isValid && '(must equal 100%)'}
        </Alert>

        <Box sx={{ px: 2 }}>
          {(Object.keys(editedTargets) as SpendingCategory[]).map((key) => (
            <Box key={key} sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" fontWeight="bold" sx={{ color: CATEGORY_COLORS[key] }}>
                  {CATEGORY_LABELS[key]}
                </Typography>
                <Typography variant="body2" fontWeight="bold">
                  {editedTargets[key]}%
                </Typography>
              </Box>
              <Slider
                value={editedTargets[key]}
                onChange={(_, val) => handleSliderChange(key, val)}
                min={0}
                max={100}
                step={5}
                sx={{ color: CATEGORY_COLORS[key] }}
              />
            </Box>
          ))}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Bulk Assignment Section */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
          Assign Unallocated Categories
        </Typography>

        {unallocatedCategories.length === 0 ? (
          <Alert severity="info">
            All categories are assigned to allocation types
          </Alert>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedUnallocated.length === unallocatedCategories.length}
                    indeterminate={selectedUnallocated.length > 0 && selectedUnallocated.length < unallocatedCategories.length}
                    onChange={handleSelectAll}
                  />
                }
                label="Select All"
              />
              <Chip
                label={`${selectedUnallocated.length} selected`}
                size="small"
                color={selectedUnallocated.length > 0 ? 'primary' : 'default'}
              />
            </Box>

            <List dense sx={{ maxHeight: 200, overflow: 'auto', bgcolor: 'background.default', borderRadius: 1 }}>
              {unallocatedCategories.map((category) => (
                <ListItem
                  key={category.category_definition_id}
                  button
                  onClick={() => handleToggleCategory(category.category_definition_id)}
                  dense
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Checkbox
                      edge="start"
                      checked={selectedUnallocated.includes(category.category_definition_id)}
                      tabIndex={-1}
                      disableRipple
                      size="small"
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={category.category_name}
                    secondary={category.total_amount > 0 ? `${category.total_amount.toFixed(0)} (${category.percentage_of_income.toFixed(1)}%)` : 'No spending'}
                  />
                </ListItem>
              ))}
            </List>

            <Box sx={{ display: 'flex', gap: 2, mt: 2, alignItems: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Assign to</InputLabel>
                <Select
                  value={assignTo}
                  label="Assign to"
                  onChange={(e) => setAssignTo(e.target.value as SpendingCategory | '')}
                >
                  {(Object.keys(CATEGORY_LABELS) as SpendingCategory[]).map((key) => (
                    <MenuItem key={key} value={key}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            bgcolor: CATEGORY_COLORS[key],
                          }}
                        />
                        {CATEGORY_LABELS[key]}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                onClick={handleBulkAssign}
                disabled={selectedUnallocated.length === 0 || !assignTo || saving}
                size="small"
              >
                Assign Selected
              </Button>
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSaveTargets}
          disabled={!isValid || saving}
        >
          {saving ? <CircularProgress size={20} /> : 'Save Targets'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AllocationSettingsModal;
