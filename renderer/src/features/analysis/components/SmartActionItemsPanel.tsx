import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Button,
  IconButton,
  Alert,
  CircularProgress,
  Stack,
  Collapse,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import type { ChipProps } from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Cancel as CancelIcon,
  Snooze as SnoozeIcon,
  TrendingUp as TrendingUpIcon,
  Money as MoneyIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useSmartActions } from '@renderer/features/analysis/hooks/useSmartActions';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { SmartAction } from '@renderer/types/smart-actions';
import { useTranslation } from 'react-i18next';

const SmartActionItemsPanel: React.FC = () => {
  const { actions, summary, loading, generating, error, generateActions, resolveAction, dismissAction, snoozeAction } = useSmartActions();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.smartActions' });
  const [expandedAction, setExpandedAction] = useState<number | null>(null);
  const [actionDialog, setActionDialog] = useState<{ open: boolean; action: SmartAction | null; type: 'resolve' | 'dismiss' | 'snooze' | null }>({
    open: false,
    action: null,
    type: null,
  });
  const [userNote, setUserNote] = useState('');

  const getSeverityColor = (severity: SmartAction['severity']): ChipProps['color'] => {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'info';
      case 'low':
        return 'success';
      default:
        return 'default';
    }
  };

  const getSeverityIcon = (severity: SmartAction['severity']): React.ReactElement | undefined => {
    switch (severity) {
      case 'critical':
      case 'high':
        return <WarningIcon />;
      case 'medium':
        return <TrendingUpIcon />;
      case 'low':
        return <CheckIcon />;
      default:
        return undefined;
    }
  };

  const getActionTypeLabel = (type: SmartAction['action_type']) => {
    switch (type) {
      case 'anomaly':
        return t('types.anomaly');
      case 'budget_overrun':
        return t('types.budget_overrun');
      case 'optimization':
        return t('types.optimization');
      case 'fixed_variation':
        return t('types.fixed_variation');
      case 'unusual_purchase':
        return t('types.unusual_purchase');
      case 'seasonal_alert':
        return t('types.seasonal_alert');
      case 'fixed_recurring_change':
        return t('types.fixed_recurring_change', 'Payment Change');
      case 'fixed_recurring_missing':
        return t('types.fixed_recurring_missing', 'Missing Payment');
      case 'fixed_recurring_duplicate':
        return t('types.fixed_recurring_duplicate', 'Duplicate Payment');
      case 'optimization_reallocate':
        return t('types.optimization_reallocate', 'Savings Opportunity');
      case 'optimization_add_budget':
        return t('types.optimization_add_budget', 'Budget Suggestion');
      case 'optimization_low_confidence':
        return t('types.optimization_low_confidence', 'Irregular Pattern');
      default:
        return type;
    }
  };

  const handleGenerate = async () => {
    try {
      await generateActions(1, true); // force to refresh/replace stale monthly actions
    } catch (err) {
      console.error('Failed to generate actions:', err);
    }
  };

  const handleActionClick = (action: SmartAction, type: 'resolve' | 'dismiss' | 'snooze') => {
    setActionDialog({ open: true, action, type });
    setUserNote('');
  };

  const handleConfirmAction = async () => {
    if (!actionDialog.action || !actionDialog.type) return;

    try {
      switch (actionDialog.type) {
        case 'resolve':
          await resolveAction(actionDialog.action.id, userNote || undefined);
          break;
        case 'dismiss':
          await dismissAction(actionDialog.action.id, userNote || undefined);
          break;
        case 'snooze':
          await snoozeAction(actionDialog.action.id, userNote || undefined);
          break;
      }
      setActionDialog({ open: false, action: null, type: null });
      setUserNote('');
    } catch (err) {
      console.error('Failed to update action:', err);
    }
  };

  if (loading && actions.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight="bold">
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={generating ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={handleGenerate}
          disabled={generating}
          size="small"
        >
          {generating ? t('actions.generating') : t('actions.generate')}
        </Button>
      </Box>

      {/* Summary */}
      {summary && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                {t('summary.totalActions')}
              </Typography>
              <Typography variant="h4" fontWeight="bold">
                {summary.total}
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                {t('summary.criticalHigh')}
              </Typography>
              <Typography variant="h4" fontWeight="bold" color="error.main">
                {summary.by_severity.critical + summary.by_severity.high}
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                {t('summary.potentialImpact')}
              </Typography>
              <Typography variant="h4" fontWeight="bold" color={summary.total_potential_impact < 0 ? 'error.main' : 'success.main'}>
                {formatCurrency(Math.abs(summary.total_potential_impact), { absolute: true, maximumFractionDigits: 0 })}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Actions List */}
      {actions.length === 0 ? (
        <Alert severity="success">
          <Typography variant="body1" fontWeight="bold">
            {t('empty.title')}
          </Typography>
          <Typography variant="body2">
            {t('empty.description')}
          </Typography>
        </Alert>
      ) : (
        <Stack spacing={2}>
          {actions.map((action) => (
            <Card
              key={action.id}
              sx={{
                border: 2,
                borderColor: action.severity === 'critical' || action.severity === 'high' ? 'warning.main' : 'divider',
              }}
            >
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Chip
                        icon={getSeverityIcon(action.severity)}
                        label={t(`severities.${action.severity}`, { defaultValue: action.severity }).toUpperCase()}
                        color={getSeverityColor(action.severity)}
                        size="small"
                      />
                      <Chip label={getActionTypeLabel(action.action_type)} size="small" variant="outlined" />
                      {action.category_name && (
                        <Chip label={action.category_name} size="small" variant="outlined" color="primary" />
                      )}
                    </Box>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                      {action.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {action.description}
                    </Typography>
                    {action.potential_impact !== undefined && action.potential_impact !== 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <MoneyIcon fontSize="small" color={action.potential_impact < 0 ? 'error' : 'success'} />
                        <Typography variant="body2" color={action.potential_impact < 0 ? 'error.main' : 'success.main'} fontWeight="bold">
                          {action.potential_impact < 0 ? t('labels.costIncrease') : t('labels.potentialSavings')}{' '}
                          {formatCurrency(Math.abs(action.potential_impact), { absolute: true, maximumFractionDigits: 0 })}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title={t('tooltips.resolve')}>
                      <IconButton size="small" color="success" onClick={() => handleActionClick(action, 'resolve')}>
                        <CheckIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('tooltips.dismiss')}>
                      <IconButton size="small" color="error" onClick={() => handleActionClick(action, 'dismiss')}>
                        <CancelIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('tooltips.snooze', { days: 7 })}>
                      <IconButton size="small" onClick={() => handleActionClick(action, 'snooze')}>
                        <SnoozeIcon />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}>
                      {expandedAction === action.id ? <CollapseIcon /> : <ExpandIcon />}
                    </IconButton>
                  </Box>
                </Box>

                {/* Expanded Details */}
                <Collapse in={expandedAction === action.id}>
                  <Box sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      {t('details.title')}
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t('details.detected')}
                        </Typography>
                        <Typography variant="body2">
                          {new Date(action.detected_at).toLocaleDateString()}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t('details.confidence')}
                        </Typography>
                        <Typography variant="body2">
                          {Math.round(action.detection_confidence * 100)}%
                        </Typography>
                      </Box>
                      {action.metadata && Object.keys(action.metadata).length > 0 && (
                        <Box sx={{ gridColumn: '1 / -1' }}>
                          <Typography variant="caption" color="text.secondary">
                            {t('details.additionalInfo')}
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            {Object.entries(action.metadata).slice(0, 5).map(([key, value]) => (
                              <Typography key={key} variant="caption" display="block">
                                <strong>{key.replace(/_/g, ' ')}:</strong> {typeof value === 'number' ? value.toFixed(2) : String(value)}
                              </Typography>
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </Box>
                </Collapse>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Action Dialog */}
      <Dialog open={actionDialog.open} onClose={() => setActionDialog({ open: false, action: null, type: null })} maxWidth="sm" fullWidth>
        <DialogTitle>
          {actionDialog.type === 'resolve' && t('dialog.resolve.title')}
          {actionDialog.type === 'dismiss' && t('dialog.dismiss.title')}
          {actionDialog.type === 'snooze' && t('dialog.snooze.title')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            {actionDialog.action?.title}
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={3}
            label={t('dialog.noteLabel')}
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            sx={{ mt: 2 }}
            placeholder={t('dialog.notePlaceholder')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActionDialog({ open: false, action: null, type: null })}>{t('dialog.cancel')}</Button>
          <Button onClick={handleConfirmAction} variant="contained" color="primary">
            {t('dialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SmartActionItemsPanel;
