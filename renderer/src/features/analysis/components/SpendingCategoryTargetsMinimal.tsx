import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Slider,
  Tooltip,
  CircularProgress,
  Alert,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { useSpendingCategories } from '@renderer/features/budgets/hooks/useSpendingCategories';
import type { SpendingCategory, CategoryWithSpending } from '@renderer/types/spending-categories';
import { useTranslation } from 'react-i18next';
import CategoryIcon from '../../breakdown/components/CategoryIcon';

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

const TARGET_KEYS: SpendingCategory[] = ['essential', 'growth', 'stability', 'reward'];

const SpendingCategoryTargetsMinimal: React.FC = () => {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.targets' });
  const {
    breakdown,
    loading,
    error,
    fetchBreakdown,
    updateMapping,
    updateTargets,
    getCategoriesForAllocation,
  } = useSpendingCategories({ currentMonthOnly: true });

  const [localTargets, setLocalTargets] = useState<Record<SpendingCategory, number>>(DEFAULT_TARGETS);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedCategoryForMenu, setSelectedCategoryForMenu] = useState<CategoryWithSpending | null>(null);

  // Fetch breakdown on mount
  useEffect(() => {
    fetchBreakdown();
  }, [fetchBreakdown]);

  useEffect(() => {
    if (breakdown?.targets) {
      setLocalTargets(breakdown.targets);
    }
  }, [breakdown]);

  const totalIncome = breakdown?.total_income || 0;

  const getCategoryName = (category: CategoryWithSpending) => {
    const language = i18n.language || 'en';
    const isHebrew = language.startsWith('he');
    if (isHebrew) {
      return category.category_name;
    }
    return category.category_name_en || category.category_name;
  };

  const renderCategoryTooltip = (category: CategoryWithSpending, color: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <CategoryIcon iconName={category.icon} color={color} size={18} />
      <Typography variant="caption" sx={{ color: 'inherit' }}>
        {getCategoryName(category)}
      </Typography>
    </Box>
  );

  const rebalanceTargets = (targets: Record<SpendingCategory, number>, changedKey: SpendingCategory) => {
    const normalized = { ...targets };
    const total = TARGET_KEYS.reduce((sum, key) => sum + (normalized[key] || 0), 0);
    const diff = 100 - total;

    if (Math.abs(diff) < 0.01) {
      return normalized;
    }

    const otherKeys = TARGET_KEYS.filter((key) => key !== changedKey);
    const otherSum = otherKeys.reduce((sum, key) => sum + (normalized[key] || 0), 0);

    if (otherSum <= 0) {
      if (diff > 0) {
        const per = diff / otherKeys.length;
        otherKeys.forEach((key) => {
          normalized[key] = Math.min(100, Math.max(0, per));
        });
      } else {
        normalized[changedKey] = Math.min(100, Math.max(0, (normalized[changedKey] || 0) + diff));
      }
      return normalized;
    }

    otherKeys.forEach((key) => {
      const share = (normalized[key] || 0) / otherSum;
      normalized[key] = Math.min(100, Math.max(0, (normalized[key] || 0) + diff * share));
    });

    const finalTotal = TARGET_KEYS.reduce((sum, key) => sum + (normalized[key] || 0), 0);
    const roundingDiff = 100 - finalTotal;
    if (Math.abs(roundingDiff) > 0.01) {
      normalized[changedKey] = Math.min(100, Math.max(0, (normalized[changedKey] || 0) + roundingDiff));
    }

    return normalized;
  };

  const handleCategoryClick = (event: React.MouseEvent<HTMLElement>, category: CategoryWithSpending) => {
    setAnchorEl(event.currentTarget);
    setSelectedCategoryForMenu(category);
  };

  const handleCloseMenu = () => {
    setAnchorEl(null);
    setSelectedCategoryForMenu(null);
  };

  const handleCategoryAllocationChange = async (categoryId: number, newAllocation: SpendingCategory) => {
    try {
      await updateMapping(categoryId, { spendingCategory: newAllocation });
      await fetchBreakdown();
    } catch (err) {
      console.error('Failed to update category allocation:', err);
    }
  };

  const handleChangeAllocation = async (newAllocation: SpendingCategory) => {
    if (selectedCategoryForMenu) {
      await handleCategoryAllocationChange(selectedCategoryForMenu.category_definition_id, newAllocation);
    }
    handleCloseMenu();
  };

  const handleSliderChange = (key: SpendingCategory, newValue: number | number[]) => {
    setLocalTargets(prev => ({ ...prev, [key]: newValue as number }));
  };

  const handleSliderCommit = async (key: SpendingCategory, newValue: number | number[]) => {
    const updatedTargets = { ...localTargets, [key]: newValue as number };
    const balancedTargets = rebalanceTargets(updatedTargets, key);
    setLocalTargets(balancedTargets);
    try {
      await updateTargets(balancedTargets);
    } catch (err) {
      console.error('Failed to update targets:', err);
      // Revert on error
      if (breakdown?.targets) {
        setLocalTargets(breakdown.targets);
      }
    }
  };

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
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" fontWeight="bold">
          {t('title')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {totalIncome > 0
            ? t('subtitle.withIncome', { amount: totalIncome.toFixed(0) })
            : t('subtitle.noIncome')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {TARGET_KEYS.map((key) => {
          const target = localTargets[key] || 0;
          const categories = getCategoriesForAllocation(key);
          const label = t(`categories.${key}`, { defaultValue: CATEGORY_LABELS[key] });
          const color = CATEGORY_COLORS[key];

          return (
            <Paper
              key={key}
              elevation={0}
              sx={{
                p: 2,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Typography variant="body2" fontWeight="bold" sx={{ color, minWidth: 80 }}>
                  {label}
                </Typography>
                <Box sx={{ flex: 1, mx: 2 }}>
                  <Slider
                    value={target}
                    onChange={(_, val) => handleSliderChange(key, val)}
                    onChangeCommitted={(_, val) => handleSliderCommit(key, val)}
                    min={0}
                    max={100}
                    step={5}
                    sx={{
                      color,
                      height: 6,
                      '& .MuiSlider-thumb': {
                        width: 16,
                        height: 16,
                      },
                    }}
                  />
                </Box>
                <Typography variant="body2" fontWeight="bold" sx={{ minWidth: 40, textAlign: 'right' }}>
                  {target}%
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1, minHeight: 40, alignItems: 'center' }}>
                {categories.length > 0 ? (
                  categories.map((category) => (
                    <Tooltip key={category.category_definition_id} title={renderCategoryTooltip(category, color)} arrow>
                      <Box
                        onClick={(e) => handleCategoryClick(e, category)}
                        sx={{
                          cursor: 'pointer',
                          p: 1,
                          borderRadius: '50%',
                          bgcolor: `${color}15`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: `${color}25`,
                            transform: 'scale(1.1)',
                          },
                        }}
                      >
                        <CategoryIcon
                          iconName={category.icon}
                          color={color}
                          size={20}
                        />
                      </Box>
                    </Tooltip>
                  ))
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    {t('selected.empty')}
                  </Typography>
                )}
              </Box>
            </Paper>
          );
        })}

        {/* Unallocated Section */}
        {(() => {
          const unallocatedCategories = getCategoriesForAllocation('unallocated');
          if (unallocatedCategories.length === 0) return null;
          const color = CATEGORY_COLORS.unallocated;

          return (
            <Paper
              elevation={0}
              sx={{
                p: 2,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Typography variant="body2" fontWeight="bold" sx={{ color, mb: 1 }}>
                {t('categories.unallocated', { defaultValue: CATEGORY_LABELS.unallocated })}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1 }}>
                {unallocatedCategories.map((category) => (
                  <Tooltip key={category.category_definition_id} title={renderCategoryTooltip(category, color)} arrow>
                    <Box
                      onClick={(e) => handleCategoryClick(e, category)}
                      sx={{
                        cursor: 'pointer',
                        p: 1,
                        borderRadius: '50%',
                        bgcolor: `${color}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                        '&:hover': {
                          bgcolor: `${color}25`,
                          transform: 'scale(1.1)',
                        },
                      }}
                    >
                      <CategoryIcon
                        iconName={category.icon}
                        color={color}
                        size={20}
                      />
                    </Box>
                  </Tooltip>
                ))}
              </Box>
            </Paper>
          );
        })()}
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
      >
        {TARGET_KEYS.map((key) => (
          <MenuItem key={key} onClick={() => handleChangeAllocation(key)}>
            <ListItemIcon>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  bgcolor: CATEGORY_COLORS[key],
                }}
              />
            </ListItemIcon>
            <ListItemText>
              {t(`categories.${key}`, { defaultValue: CATEGORY_LABELS[key] })}
            </ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};

export default SpendingCategoryTargetsMinimal;
