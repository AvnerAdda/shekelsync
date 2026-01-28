import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Savings as SavingsIcon,
  CheckCircle as CheckIcon,
  Edit as EditIcon,
  Add as AddIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface SavingsGoal {
  id: number;
  name: string;
  description?: string;
  target_amount: number;
  current_amount: number;
  currency: string;
  target_date?: string;
  start_date: string;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  progress_percent: number;
  days_remaining?: number;
  icon?: string;
  color?: string;
  is_recurring: boolean;
  recurring_amount?: number;
}

interface SavingsGoalCardProps {
  goal: SavingsGoal;
  onEdit?: (goal: SavingsGoal) => void;
  onAddContribution?: (goal: SavingsGoal) => void;
}

const SavingsGoalCard: React.FC<SavingsGoalCardProps> = ({
  goal,
  onEdit,
  onAddContribution,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: goal.currency || 'ILS',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = () => {
    switch (goal.status) {
      case 'completed':
        return theme.palette.success.main;
      case 'paused':
        return theme.palette.warning.main;
      case 'cancelled':
        return theme.palette.error.main;
      default:
        return goal.color || theme.palette.primary.main;
    }
  };

  const isCompleted = goal.status === 'completed';
  const progress = Math.min(goal.progress_percent || 0, 100);

  return (
    <Card
      sx={{
        borderRadius: 3,
        border: `1px solid ${alpha(getStatusColor(), 0.2)}`,
        backgroundColor: alpha(theme.palette.background.paper, 0.8),
        transition: 'all 0.2s ease',
        '&:hover': {
          boxShadow: `0 4px 20px ${alpha(getStatusColor(), 0.15)}`,
          transform: 'translateY(-2px)',
        },
      }}
    >
      <CardContent sx={{ p: 2.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                p: 1,
                borderRadius: 2,
                backgroundColor: alpha(getStatusColor(), 0.1),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isCompleted ? (
                <CheckIcon sx={{ color: getStatusColor() }} />
              ) : (
                <SavingsIcon sx={{ color: getStatusColor() }} />
              )}
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                {goal.name}
              </Typography>
              {goal.description && (
                <Typography variant="caption" color="text.secondary">
                  {goal.description}
                </Typography>
              )}
            </Box>
          </Box>
          
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {!isCompleted && onAddContribution && (
              <Tooltip title={t('savingsGoals.addContribution', 'Add contribution')}>
                <IconButton
                  size="small"
                  onClick={() => onAddContribution(goal)}
                  aria-label={t('savingsGoals.addContribution', 'Add contribution')}
                  sx={{
                    color: theme.palette.text.secondary,
                    '&:hover': { color: getStatusColor() },
                  }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onEdit && (
              <Tooltip title={t('common.edit', 'Edit')}>
                <IconButton
                  size="small"
                  onClick={() => onEdit(goal)}
                  aria-label={t('common.edit', 'Edit')}
                  sx={{
                    color: theme.palette.text.secondary,
                    '&:hover': { color: theme.palette.primary.main },
                  }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Progress */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" fontWeight={500}>
              {formatCurrency(goal.current_amount)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatCurrency(goal.target_amount)}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 8,
              borderRadius: 4,
              backgroundColor: alpha(getStatusColor(), 0.1),
              '& .MuiLinearProgress-bar': {
                backgroundColor: getStatusColor(),
                borderRadius: 4,
              },
            }}
            aria-label={`${t('savingsGoals.progress', 'Progress')}: ${progress}%`}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {progress.toFixed(0)}% {t('savingsGoals.complete', 'complete')}
            </Typography>
            {goal.days_remaining !== null && goal.days_remaining !== undefined && goal.days_remaining > 0 && (
              <Typography variant="caption" color="text.secondary">
                {Math.ceil(goal.days_remaining)} {t('savingsGoals.daysLeft', 'days left')}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Footer */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {isCompleted && (
            <Chip
              size="small"
              label={t('savingsGoals.completed', 'Completed')}
              color="success"
              sx={{ height: 24 }}
            />
          )}
          {goal.is_recurring && goal.recurring_amount && (
            <Chip
              size="small"
              icon={<TrendingUpIcon sx={{ fontSize: 14 }} />}
              label={`${formatCurrency(goal.recurring_amount)}/${t('common.month', 'mo')}`}
              sx={{
                height: 24,
                backgroundColor: alpha(theme.palette.info.main, 0.1),
                color: theme.palette.info.main,
              }}
            />
          )}
          {goal.target_date && !isCompleted && (
            <Chip
              size="small"
              label={new Date(goal.target_date).toLocaleDateString('he-IL', {
                month: 'short',
                year: 'numeric',
              })}
              sx={{
                height: 24,
                backgroundColor: alpha(theme.palette.text.primary, 0.05),
              }}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default SavingsGoalCard;
