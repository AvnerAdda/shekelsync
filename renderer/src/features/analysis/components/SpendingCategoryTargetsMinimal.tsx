import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Slider,
  Tooltip,
  CircularProgress,
  Alert,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { useSpendingCategories } from '@renderer/features/budgets/hooks/useSpendingCategories';
import type { SpendingCategory, CategoryWithSpending } from '@renderer/types/spending-categories';
import { useTranslation } from 'react-i18next';
import CategoryIcon from '../../breakdown/components/CategoryIcon';
import {
  DEFAULT_TARGETS,
  TARGET_KEYS,
  calculateTargetTotal,
  canSaveTargetChanges,
  haveTargetsChanged,
  normalizeTargets,
} from './spendingCategoryTargetsHelpers';

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
  const [savingTargets, setSavingTargets] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedCategoryForMenu, setSelectedCategoryForMenu] = useState<CategoryWithSpending | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch breakdown on mount
  useEffect(() => {
    fetchBreakdown();
  }, [fetchBreakdown]);

  const savedTargets = normalizeTargets(breakdown?.targets);
  const savedTargetsSignature = TARGET_KEYS.map((key) => savedTargets[key]).join('|');

  useEffect(() => {
    setLocalTargets(savedTargets);
  }, [savedTargetsSignature]);

  const totalIncome = breakdown?.total_income || 0;
  const totalPercentage = calculateTargetTotal(localTargets);
  const isValidTotal = Math.abs(totalPercentage - 100) < 0.01;
  const hasUnsavedChanges = haveTargetsChanged(localTargets, savedTargets);
  const canSaveTargets = canSaveTargetChanges(localTargets, savedTargets, savingTargets);

  const getCategoryName = (category: CategoryWithSpending) => {
    const language = (i18n.language || 'en').toLowerCase();
    const locale = language.split('-')[0] || 'en';
    if (locale === 'he') {
      return category.category_name;
    }
    if (locale === 'fr') {
      return category.category_name_fr || category.category_name_en || category.category_name;
    }
    return category.category_name_en || category.category_name_fr || category.category_name;
  };

  const renderCategoryTooltip = (category: CategoryWithSpending, color: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <CategoryIcon iconName={category.icon} color={color} size={18} />
      <Typography variant="caption" sx={{ color: 'inherit' }}>
        {getCategoryName(category)}
      </Typography>
    </Box>
  );

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
    setLocalTargets((prev) => ({ ...prev, [key]: newValue as number }));
    setSaveError(null);
  };

  const handleResetTargets = () => {
    setLocalTargets(savedTargets);
    setSaveError(null);
  };

  const handleSaveTargets = async () => {
    if (!isValidTotal || !hasUnsavedChanges) {
      return;
    }

    setSavingTargets(true);
    setSaveError(null);
    try {
      await updateTargets(localTargets);
    } catch (err) {
      console.error('Failed to update targets:', err);
      setSaveError(err instanceof Error ? err.message : t('saveError', { defaultValue: 'Failed to save allocation targets.' }));
    } finally {
      setSavingTargets(false);
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2, flexWrap: 'wrap' }}>
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="text"
            onClick={handleResetTargets}
            disabled={!hasUnsavedChanges || savingTargets}
          >
            {t('actions.reset', { defaultValue: 'Reset' })}
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={handleSaveTargets}
            disabled={!canSaveTargets}
          >
            {savingTargets ? <CircularProgress size={18} color="inherit" /> : t('actions.save', { defaultValue: 'Save' })}
          </Button>
        </Box>
      </Box>

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError}
        </Alert>
      )}

      <Alert severity={!isValidTotal ? 'warning' : hasUnsavedChanges ? 'info' : 'success'} sx={{ mb: 2 }}>
        {!isValidTotal
          ? t('summary.invalid', {
              total: totalPercentage.toFixed(0),
              defaultValue: `Total: ${totalPercentage.toFixed(0)}%. Adjust to 100% to enable Save.`,
            })
          : hasUnsavedChanges
            ? t('summary.validDirty', {
                total: totalPercentage.toFixed(0),
                defaultValue: `Total: ${totalPercentage.toFixed(0)}%. Save to apply changes.`,
              })
            : t('summary.validClean', {
                total: totalPercentage.toFixed(0),
                defaultValue: `Total: ${totalPercentage.toFixed(0)}%`,
              })}
      </Alert>

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
                    aria-label={label}
                    min={0}
                    max={100}
                    step={1}
                    disabled={savingTargets}
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
