import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Paper,
  LinearProgress,
  Select,
  MenuItem,
  FormControl,
  Tooltip,
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useSpendingCategories } from '@renderer/features/budgets/hooks/useSpendingCategories';
import type { SpendingCategory } from '@renderer/types/spending-categories';
import { ALLOCATION_DESCRIPTIONS } from '@renderer/types/spending-categories';
import AllocationSettingsModal from './AllocationSettingsModal';
import { useTranslation } from 'react-i18next';

const DEFAULT_TARGETS: Record<SpendingCategory, number> = {
  essential: 50,
  growth: 20,
  stability: 15,
  reward: 15,
};

const CATEGORY_COLORS: Record<string, string> = {
  essential: '#2196F3',
  growth: '#4CAF50',
  stability: '#FF9800',
  reward: '#E91E63',
  unallocated: '#9E9E9E',
};

const CATEGORY_LABELS: Record<string, string> = {
  essential: 'Essential',
  growth: 'Growth',
  stability: 'Stability',
  reward: 'Reward',
  unallocated: 'Unallocated',
};

const SpendingCategoryTargetsMinimal: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.targets' });
  const {
    breakdown,
    selectedAllocation,
    setSelectedAllocation,
    loading,
    error,
    fetchBreakdown,
    updateMapping,
    updateTargets,
    bulkAssign,
    getCategoriesForAllocation,
  } = useSpendingCategories({ currentMonthOnly: true });

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Fetch breakdown on mount
  useEffect(() => {
    fetchBreakdown();
  }, [fetchBreakdown]);

  const targets = breakdown?.targets || DEFAULT_TARGETS;
  const totalIncome = breakdown?.total_income || 0;

  // Get actual percentages for each allocation type
  const getActualPercentage = (allocationType: SpendingCategory | 'unallocated'): number => {
    if (allocationType === 'unallocated') {
      const unallocatedCategories = getCategoriesForAllocation('unallocated');
      const unallocatedTotal = unallocatedCategories.reduce((sum, c) => sum + c.total_amount, 0);
      return totalIncome > 0 ? (unallocatedTotal / totalIncome) * 100 : 0;
    }

    const item = breakdown?.breakdown.find(b => b.spending_category === allocationType);
    return item?.actual_percentage || 0;
  };

  // Handle allocation type click
  const handleAllocationClick = (allocationType: SpendingCategory | 'unallocated') => {
    setSelectedAllocation(allocationType === selectedAllocation ? null : allocationType);
  };

  // Handle category allocation change
  const handleCategoryAllocationChange = async (categoryId: number, newAllocation: SpendingCategory) => {
    try {
      await updateMapping(categoryId, { spendingCategory: newAllocation });
      await fetchBreakdown();
    } catch (err) {
      console.error('Failed to update category allocation:', err);
    }
  };

  // Get selected categories
  const selectedCategories = selectedAllocation
    ? getCategoriesForAllocation(selectedAllocation)
    : [];

  if (loading && !breakdown) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight="bold">
            {t('title')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {totalIncome > 0
              ? t('subtitle.withIncome', { amount: totalIncome.toFixed(0) })
              : t('subtitle.noIncome')}
          </Typography>
        </Box>
        <IconButton size="small" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Main Content - Side by Side */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        {/* Left Panel - Allocation Types */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Allocation Bars */}
          {(['essential', 'growth', 'stability', 'reward'] as SpendingCategory[]).map((key) => {
            const target = targets[key] || 0;
            const actual = getActualPercentage(key);
            const isSelected = selectedAllocation === key;
            const isOver = actual > target;
            const label = t(`categories.${key}`, { defaultValue: CATEGORY_LABELS[key] });
            const description = t(`descriptions.${key}`, { defaultValue: ALLOCATION_DESCRIPTIONS[key] });

            return (
              <Paper
                key={key}
                elevation={isSelected ? 3 : 0}
                sx={{
                  p: 1.5,
                  mb: 1,
                  cursor: 'pointer',
                  bgcolor: isSelected ? `${CATEGORY_COLORS[key]}10` : 'background.default',
                  border: isSelected ? `2px solid ${CATEGORY_COLORS[key]}` : '1px solid transparent',
                  borderRadius: 1,
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: `${CATEGORY_COLORS[key]}08`,
                  },
                }}
                onClick={() => handleAllocationClick(key)}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="caption" fontWeight="bold" sx={{ color: CATEGORY_COLORS[key] }}>
                    {label}
                  </Typography>
                  <Typography variant="caption" fontWeight="bold">
                    {actual.toFixed(1)}% / {target}%
                  </Typography>
                </Box>

                <Tooltip title={description} placement="top">
                  <Box>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min((actual / Math.max(target, 1)) * 100, 100)}
                      sx={{
                        height: 8,
                        borderRadius: 1,
                        bgcolor: `${CATEGORY_COLORS[key]}20`,
                        '& .MuiLinearProgress-bar': {
                          bgcolor: isOver ? '#f44336' : CATEGORY_COLORS[key],
                        },
                      }}
                    />
                  </Box>
                </Tooltip>

                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                  {description}
                </Typography>
              </Paper>
            );
          })}

          {/* Unallocated Section */}
          {(() => {
            const unallocatedCategories = getCategoriesForAllocation('unallocated');
            if (unallocatedCategories.length === 0) return null;

            const actual = getActualPercentage('unallocated');
            const isSelected = selectedAllocation === 'unallocated';
            const label = t('categories.unallocated', { defaultValue: CATEGORY_LABELS.unallocated });

            return (
              <Paper
                elevation={isSelected ? 3 : 0}
                sx={{
                  p: 1.5,
                  cursor: 'pointer',
                  bgcolor: isSelected ? `${CATEGORY_COLORS.unallocated}10` : 'background.default',
                  border: isSelected ? `2px solid ${CATEGORY_COLORS.unallocated}` : '1px solid transparent',
                  borderRadius: 1,
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: `${CATEGORY_COLORS.unallocated}08`,
                  },
                }}
                onClick={() => handleAllocationClick('unallocated')}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="caption" fontWeight="bold" sx={{ color: CATEGORY_COLORS.unallocated }}>
                    {label}
                  </Typography>
                  <Chip
                    label={t('unallocated.count', { count: unallocatedCategories.length })}
                    size="small"
                    sx={{ height: 18, fontSize: '0.65rem' }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {t('unallocated.needsAssignment', { percentage: actual.toFixed(1) })}
                </Typography>
              </Paper>
            );
          })()}
        </Box>

        {/* Right Panel - Categories in Selected Allocation */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {selectedAllocation ? (
            <Paper sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, height: '100%' }}>
              <Typography variant="caption" fontWeight="bold" sx={{ color: CATEGORY_COLORS[selectedAllocation], mb: 1, display: 'block' }}>
                {t('selected.title', {
                  category: t(`categories.${selectedAllocation}`, { defaultValue: CATEGORY_LABELS[selectedAllocation] }),
                })}
              </Typography>

              {selectedCategories.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {t('selected.empty')}
                </Typography>
              ) : (
                <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
                  {selectedCategories.map((category) => (
                    <Box
                      key={category.category_definition_id}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        py: 0.75,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 'none' },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
                        <Typography variant="caption" noWrap title={category.category_name}>
                          {category.category_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {category.total_amount > 0
                            ? `${category.total_amount.toFixed(0)} (${category.percentage_of_income.toFixed(1)}%)`
                            : t('selected.noSpending')}
                        </Typography>
                      </Box>

                      {/* Allocation Type Dropdown */}
                      <FormControl size="small" sx={{ minWidth: 80 }}>
                        <Select
                          value={category.spending_category || ''}
                          onChange={(e) => handleCategoryAllocationChange(
                            category.category_definition_id,
                            e.target.value as SpendingCategory
                          )}
                          sx={{ fontSize: '0.75rem', height: 28 }}
                        >
                          {(['essential', 'growth', 'stability', 'reward'] as SpendingCategory[]).map((key) => (
                            <MenuItem key={key} value={key} sx={{ fontSize: '0.75rem' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Box
                                  sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    bgcolor: CATEGORY_COLORS[key],
                                  }}
                                />
                                {t(`categories.${key}`, { defaultValue: CATEGORY_LABELS[key] })}
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          ) : (
            <Paper sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="caption" color="text.secondary" textAlign="center">
                {t('empty.selectPrompt')}
              </Typography>
            </Paper>
          )}
        </Box>
      </Box>

      {/* Settings Modal */}
      <AllocationSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        targets={targets as Record<SpendingCategory, number>}
        unallocatedCategories={getCategoriesForAllocation('unallocated')}
        onUpdateTargets={updateTargets}
        onBulkAssign={bulkAssign}
      />
    </Box>
  );
};

export default SpendingCategoryTargetsMinimal;
