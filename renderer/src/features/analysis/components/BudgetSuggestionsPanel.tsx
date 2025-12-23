import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  LinearProgress,
  Alert,
  CircularProgress,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  CheckCircle as CheckIcon,
  AutoAwesome as AutoIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useBudgetIntelligence } from '@renderer/features/budgets/hooks/useBudgetIntelligence';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { BudgetSuggestion } from '@renderer/types/budget-intelligence';
import { useTranslation } from 'react-i18next';

interface BudgetSuggestionsPanelProps {
  months?: number;
}

const BudgetSuggestionsPanel: React.FC<BudgetSuggestionsPanelProps> = ({ months = 6 }) => {
  const { suggestions, loading, error, generateSuggestions, activateSuggestion } = useBudgetIntelligence();
  const { formatCurrency } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.budgetSuggestions' });
  const [selectedSuggestion, setSelectedSuggestion] = useState<BudgetSuggestion | null>(null);
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateSuggestions(months);
    } finally {
      setGenerating(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedSuggestion) return;

    try {
      await activateSuggestion(selectedSuggestion.id);
      setActivateDialogOpen(false);
      setSelectedSuggestion(null);
    } catch (err) {
      console.error('Failed to activate suggestion:', err);
    }
  };

  const openActivateDialog = (suggestion: BudgetSuggestion) => {
    setSelectedSuggestion(suggestion);
    setActivateDialogOpen(true);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'success';
    if (confidence >= 0.6) return 'warning';
    return 'error';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return t('confidence.high');
    if (confidence >= 0.6) return t('confidence.medium');
    return t('confidence.low');
  };

  const getCategoryLabel = (suggestion: BudgetSuggestion) => {
    const locale = i18n.language?.split('-')[0] || 'he';
    if (locale === 'fr') {
      return suggestion.category_name_fr || suggestion.category_name_en || suggestion.category_name;
    }
    if (locale === 'en') {
      return suggestion.category_name_en || suggestion.category_name_fr || suggestion.category_name;
    }
    return suggestion.category_name;
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight="bold" gutterBottom>
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={generating ? <CircularProgress size={16} /> : <AutoIcon />}
          onClick={handleGenerate}
          disabled={generating || loading}
        >
          {generating ? t('actions.generating') : t('actions.generate')}
        </Button>
      </Box>

      {/* Error State */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Loading State */}
      {loading && !suggestions.length && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Empty State */}
      {!loading && !suggestions.length && !error && (
        <Alert severity="info" icon={<InfoIcon />}>
          {t('empty')}
        </Alert>
      )}

      {/* Suggestions Grid */}
      {suggestions.length > 0 && (
        <Grid container spacing={2}>
          {suggestions.map((suggestion) => (
            <Grid item xs={12} md={6} key={suggestion.id}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  borderColor: suggestion.is_active ? 'primary.main' : 'divider',
                  borderWidth: suggestion.is_active ? 2 : 1,
                  position: 'relative',
                  transition: 'all 0.2s',
                  '&:hover': {
                    boxShadow: 2,
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                {suggestion.is_active && (
                  <Chip
                    label={t('labels.active')}
                    color="primary"
                    size="small"
                    icon={<CheckIcon />}
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                    }}
                  />
                )}

                <CardContent>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    {getCategoryLabel(suggestion)}
                  </Typography>

                  {/* Suggested Limit */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('labels.suggestedBudget')}
                    </Typography>
                    <Typography variant="h5" color="primary.main" fontWeight="bold">
                      {formatCurrency(suggestion.suggested_limit, { maximumFractionDigits: 0 })}
                    </Typography>
                  </Box>

                  {/* Confidence Score */}
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('labels.confidence')}
                      </Typography>
                      <Typography variant="caption" fontWeight="bold">
                        {Math.round(suggestion.confidence_score * 100)}%
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={suggestion.confidence_score * 100}
                      color={getConfidenceColor(suggestion.confidence_score)}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', mt: 0.5 }}>
                      {getConfidenceLabel(suggestion.confidence_score)}
                    </Typography>
                  </Box>

                  {/* Stats */}
                  <Grid container spacing={1} sx={{ mb: 2 }}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('labels.basedOn')}
                      </Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {t('labels.months', { count: suggestion.based_on_months })}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('labels.variability')}
                      </Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {suggestion.variability_coefficient ? (suggestion.variability_coefficient * 100).toFixed(0) : 0}%
                      </Typography>
                    </Grid>
                  </Grid>

                  {/* Historical Note */}
                  {suggestion.calculation_metadata && (
                    <Tooltip
                      title={
                        typeof suggestion.calculation_metadata === 'string'
                          ? suggestion.calculation_metadata
                          : t('labels.calculationSummary', {
                              mean: suggestion.calculation_metadata.mean?.toFixed(2) || 'N/A',
                              median: suggestion.calculation_metadata.median?.toFixed(2) || 'N/A',
                              stdDev: suggestion.calculation_metadata.std_dev?.toFixed(2) || 'N/A',
                              cv: suggestion.calculation_metadata.coefficient_of_variation?.toFixed(2) || 'N/A',
                            })
                      }
                      placement="top"
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
                        <InfoIcon sx={{ fontSize: '0.9rem', color: 'text.secondary' }} />
                        <Typography variant="caption" color="text.secondary">
                          {t('labels.viewDetails')}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )}

                  {/* Action Button */}
                  {!suggestion.is_active && (
                    <Button
                      variant="outlined"
                      fullWidth
                      startIcon={<TrendingUpIcon />}
                      onClick={() => openActivateDialog(suggestion)}
                    >
                      {t('actions.activate')}
                    </Button>
                  )}

                  {suggestion.is_active && (
                    <Alert severity="success" icon={<CheckIcon />} sx={{ mt: 1 }}>
                      {t('labels.activeHint')}
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Activation Dialog */}
      <Dialog open={activateDialogOpen} onClose={() => setActivateDialogOpen(false)}>
        <DialogTitle>{t('dialog.title')}</DialogTitle>
        <DialogContent>
          {selectedSuggestion && (
            <Box>
              <Typography variant="body1" gutterBottom>
                {t('dialog.confirmation', { category: getCategoryLabel(selectedSuggestion) })}
              </Typography>
              <Box sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('dialog.monthlyBudget')}
                </Typography>
                <Typography variant="h6" color="primary.main" fontWeight="bold">
                  {formatCurrency(selectedSuggestion.suggested_limit, { maximumFractionDigits: 0 })}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {t('dialog.confidence', {
                    value: Math.round(selectedSuggestion.confidence_score * 100),
                    months: selectedSuggestion.based_on_months,
                  })}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActivateDialogOpen(false)}>
            {t('dialog.cancel')}
          </Button>
          <Button variant="contained" onClick={handleActivate}>
            {t('dialog.activate')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BudgetSuggestionsPanel;
