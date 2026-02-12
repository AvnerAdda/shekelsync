import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Typography,
  Alert,
  CircularProgress,
  Box,
  InputAdornment,
  IconButton,
  Chip,
  LinearProgress,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Close as CloseIcon,
  Autorenew as SubscriptionIcon,
  TrendingUp as TrendIcon,
  Schedule as ScheduleIcon,
  Percent as PercentIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type {
  Subscription,
  SubscriptionFrequency,
  SubscriptionStatus,
  AddSubscriptionRequest,
  UpdateSubscriptionRequest,
} from '@renderer/types/subscriptions';
import { FREQUENCY_LABELS, STATUS_LABELS, STATUS_COLORS } from '@renderer/types/subscriptions';

interface SubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  subscription?: Subscription | null;
  onSave: (data: AddSubscriptionRequest | UpdateSubscriptionRequest) => Promise<void>;
  isEditing: boolean;
}

const FREQUENCIES: SubscriptionFrequency[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'bimonthly',
  'quarterly',
  'yearly',
];

const STATUSES: SubscriptionStatus[] = [
  'active',
  'paused',
  'cancelled',
  'keep',
  'review',
];

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  open,
  onClose,
  subscription,
  onSave,
  isEditing,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions' });

  const [formData, setFormData] = useState<{
    display_name: string;
    user_frequency: SubscriptionFrequency | '';
    user_amount: string;
    billing_day: string;
    status: SubscriptionStatus;
    notes: string;
  }>({
    display_name: '',
    user_frequency: '',
    user_amount: '',
    billing_day: '',
    status: 'active',
    notes: '',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (subscription) {
      setFormData({
        display_name: subscription.display_name || '',
        user_frequency: subscription.user_frequency || subscription.detected_frequency || '',
        user_amount: subscription.user_amount?.toString() || subscription.detected_amount?.toString() || '',
        billing_day: subscription.billing_day?.toString() || '',
        status: subscription.status || 'active',
        notes: subscription.notes || '',
      });
    } else {
      setFormData({
        display_name: '',
        user_frequency: 'monthly',
        user_amount: '',
        billing_day: '',
        status: 'active',
        notes: '',
      });
    }
    setError(null);
  }, [subscription, open]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.display_name.trim()) {
      setError(t('modal.errors.nameRequired'));
      return;
    }

    if (!formData.user_amount || parseFloat(formData.user_amount) <= 0) {
      setError(t('modal.errors.amountRequired'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const data: AddSubscriptionRequest | UpdateSubscriptionRequest = {
        display_name: formData.display_name.trim(),
        user_frequency: formData.user_frequency as SubscriptionFrequency || undefined,
        user_amount: parseFloat(formData.user_amount),
        billing_day: formData.billing_day ? parseInt(formData.billing_day, 10) : undefined,
        status: formData.status,
        notes: formData.notes.trim() || undefined,
      };

      await onSave(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modal.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const consistencyScore = subscription?.consistency_score ?? 0;
  const consistencyColor = consistencyScore >= 0.8
    ? theme.palette.success.main
    : consistencyScore >= 0.5
      ? theme.palette.warning.main
      : theme.palette.error.main;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 4,
            bgcolor: alpha(theme.palette.background.paper, 0.95),
            backdropFilter: 'blur(20px)',
            backgroundImage: 'none',
            boxShadow: `0 24px 48px -12px ${alpha(theme.palette.common.black, 0.25)}`,
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            overflow: 'hidden',
          },
        },
      }}
    >
      {/* Header with gradient */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        }}
      >
        <DialogTitle sx={{ pb: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={2} alignItems="center">
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}`,
                }}
              >
                <SubscriptionIcon sx={{ color: '#fff', fontSize: 20 }} />
              </Box>
              <Box>
                <Typography variant="h6" component="span" fontWeight={700}>
                  {isEditing ? t('modal.titleEdit') : t('modal.titleAdd')}
                </Typography>
                {isEditing && subscription?.category_name && (
                  <Typography variant="caption" color="text.secondary">
                    {subscription.category_name}
                  </Typography>
                )}
              </Box>
            </Stack>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
      </Box>

      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={3}>
          {error && (
            <Alert
              severity="error"
              sx={{ borderRadius: 2 }}
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}

          {/* Name */}
          <TextField
            label={t('modal.fields.name')}
            value={formData.display_name}
            onChange={(e) => handleChange('display_name', e.target.value)}
            fullWidth
            required
            disabled={isEditing && subscription?.is_manual !== 1}
            helperText={isEditing && subscription?.is_manual !== 1 ? t('modal.hints.nameReadonly') : undefined}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
              },
            }}
          />

          {/* Amount and Frequency */}
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('modal.fields.amount')}
              value={formData.user_amount}
              onChange={(e) => handleChange('user_amount', e.target.value)}
              type="number"
              fullWidth
              required
              InputProps={{
                startAdornment: <InputAdornment position="start">₪</InputAdornment>,
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />

            <FormControl fullWidth>
              <InputLabel>{t('modal.fields.frequency')}</InputLabel>
              <Select
                value={formData.user_frequency}
                onChange={(e) => handleChange('user_frequency', e.target.value)}
                label={t('modal.fields.frequency')}
                sx={{ borderRadius: 2 }}
              >
                {FREQUENCIES.map((freq) => (
                  <MenuItem key={freq} value={freq}>
                    {t(`frequency.${freq}`, { defaultValue: FREQUENCY_LABELS[freq] })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          {/* Billing Day and Status */}
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('modal.fields.billingDay')}
              value={formData.billing_day}
              onChange={(e) => handleChange('billing_day', e.target.value)}
              type="number"
              fullWidth
              inputProps={{ min: 1, max: 31 }}
              helperText={t('modal.hints.billingDay')}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />

            <FormControl fullWidth>
              <InputLabel>{t('modal.fields.status')}</InputLabel>
              <Select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                label={t('modal.fields.status')}
                sx={{ borderRadius: 2 }}
                renderValue={(value) => (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: STATUS_COLORS[value as SubscriptionStatus] || theme.palette.grey[500],
                      }}
                    />
                    <span>{t(`status.${value}`, { defaultValue: STATUS_LABELS[value as SubscriptionStatus] })}</span>
                  </Stack>
                )}
              >
                {STATUSES.map((status) => (
                  <MenuItem key={status} value={status}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: STATUS_COLORS[status] || theme.palette.grey[500],
                        }}
                      />
                      <span>{t(`status.${status}`, { defaultValue: STATUS_LABELS[status] })}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          {/* Notes */}
          <TextField
            label={t('modal.fields.notes')}
            value={formData.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            fullWidth
            multiline
            rows={2}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
              },
            }}
          />

          {/* Detected info for editing */}
          {isEditing && subscription && (
            <Box
              sx={{
                p: 2.5,
                borderRadius: 3,
                background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.08)} 0%, ${alpha(theme.palette.info.main, 0.02)} 100%)`,
                border: `1px solid ${alpha(theme.palette.info.main, 0.15)}`,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                <TrendIcon sx={{ fontSize: 16, color: theme.palette.info.main }} />
                <Typography variant="caption" fontWeight={600} color="info.main">
                  {t('modal.detectedInfo')}
                </Typography>
              </Stack>

              <Stack direction="row" spacing={3}>
                <Box flex={1}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {t('modal.fields.detectedAmount')}
                  </Typography>
                  <Typography variant="body1" fontWeight={700}>
                    {subscription.detected_amount
                      ? formatCurrency(subscription.detected_amount, { maximumFractionDigits: 2 })
                      : '-'}
                  </Typography>
                </Box>

                <Box flex={1}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {t('modal.fields.detectedFrequency')}
                  </Typography>
                  <Chip
                    icon={<ScheduleIcon sx={{ fontSize: 14 }} />}
                    label={subscription.detected_frequency
                      ? t(`frequency.${subscription.detected_frequency}`, { defaultValue: FREQUENCY_LABELS[subscription.detected_frequency] })
                      : '-'}
                    size="small"
                    sx={{
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      color: theme.palette.primary.main,
                      fontWeight: 600,
                    }}
                  />
                </Box>

                <Box flex={1}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {t('modal.fields.consistency')}
                  </Typography>
                  <Stack spacing={0.5}>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <PercentIcon sx={{ fontSize: 14, color: consistencyColor }} />
                      <Typography variant="body1" fontWeight={700} color={consistencyColor}>
                        {subscription.consistency_score != null
                          ? `${Math.round(subscription.consistency_score * 100)}%`
                          : '-'}
                      </Typography>
                    </Stack>
                    {subscription.consistency_score != null && (
                      <LinearProgress
                        variant="determinate"
                        value={subscription.consistency_score * 100}
                        sx={{
                          height: 4,
                          borderRadius: 2,
                          bgcolor: alpha(consistencyColor, 0.1),
                          '& .MuiLinearProgress-bar': {
                            bgcolor: consistencyColor,
                            borderRadius: 2,
                          },
                        }}
                      />
                    )}
                  </Stack>
                </Box>
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2,
          borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          bgcolor: alpha(theme.palette.background.default, 0.5),
        }}
      >
        <Button
          onClick={onClose}
          disabled={saving}
          sx={{ borderRadius: 2 }}
        >
          {t('modal.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{
            borderRadius: 2,
            px: 3,
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
            boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}`,
            '&:hover': {
              background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})`,
            },
          }}
        >
          {saving ? t('modal.saving') : t('modal.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SubscriptionModal;
