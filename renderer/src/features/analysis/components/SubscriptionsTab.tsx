import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  CircularProgress,
  Alert,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSubscriptions } from '@renderer/features/analysis/hooks/useSubscriptions';
import SubscriptionSummaryCards from './SubscriptionSummaryCards';
import SubscriptionList from './SubscriptionList';
import SubscriptionAlerts from './SubscriptionAlerts';
import SubscriptionModal from './SubscriptionModal';
import SubscriptionCreepChart from './SubscriptionCreepChart';
import type {
  Subscription,
  SubscriptionStatus,
  AddSubscriptionRequest,
  UpdateSubscriptionRequest,
} from '@renderer/types/subscriptions';

const SubscriptionsTab: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions' });

  const {
    subscriptions,
    summary,
    creep,
    alerts,
    loading,
    summaryLoading,
    creepLoading,
    alertsLoading,
    detecting,
    error,
    updateSubscription,
    addSubscription,
    deleteSubscription,
    dismissAlert,
    refreshDetection,
    fetchAll,
  } = useSubscriptions();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

  const handleOpenAddModal = () => {
    setEditingSubscription(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (subscription: Subscription) => {
    setEditingSubscription(subscription);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingSubscription(null);
  };

  const handleSaveSubscription = async (data: AddSubscriptionRequest | UpdateSubscriptionRequest) => {
    if (editingSubscription?.id) {
      await updateSubscription(editingSubscription.id, data as UpdateSubscriptionRequest);
    } else {
      await addSubscription(data as AddSubscriptionRequest);
    }
  };

  const handleStatusChange = useCallback(async (id: number, status: SubscriptionStatus) => {
    await updateSubscription(id, { status });
  }, [updateSubscription]);

  const handleDelete = useCallback(async (id: number) => {
    await deleteSubscription(id);
  }, [deleteSubscription]);

  const handleDismissAlert = useCallback(async (alertId: number) => {
    await dismissAlert(alertId);
  }, [dismissAlert]);

  const isRefreshing = loading || detecting;

  return (
    <Box>
      {/* Header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={2}
        mb={3}
      >
        <Box>
          <Typography variant="h6" fontWeight="bold">
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={isRefreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={refreshDetection}
            disabled={isRefreshing}
            size="small"
            sx={{
              borderRadius: 2,
              borderColor: alpha(theme.palette.divider, 0.2),
            }}
          >
            {detecting ? t('actions.detecting') : t('actions.refresh')}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenAddModal}
            size="small"
            sx={{ borderRadius: 2 }}
          >
            {t('actions.add')}
          </Button>
        </Stack>
      </Stack>

      {/* Error alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
          <Button size="small" onClick={fetchAll} sx={{ ml: 2 }}>
            {t('actions.retry')}
          </Button>
        </Alert>
      )}

      {/* Summary cards */}
      <SubscriptionSummaryCards summary={summary} loading={summaryLoading} />

      {/* Alerts panel */}
      <SubscriptionAlerts
        alerts={alerts}
        loading={alertsLoading}
        onDismiss={handleDismissAlert}
      />

      {/* Creep chart - between alerts and list */}
      <Box sx={{ mb: 3 }}>
        <SubscriptionCreepChart creep={creep} loading={creepLoading} />
      </Box>

      {/* Subscription list */}
      <Box
        sx={{
          p: 3,
          borderRadius: 4,
          bgcolor: alpha(theme.palette.background.paper, 0.4),
          backdropFilter: 'blur(20px)',
          border: '1px solid',
          borderColor: alpha(theme.palette.common.white, 0.1),
          boxShadow: `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
          overflow: 'hidden',
        }}
      >
        <Typography variant="subtitle1" fontWeight="bold" mb={2}>
          {t('list.title')}
        </Typography>
        <SubscriptionList
          subscriptions={subscriptions}
          loading={loading}
          onEdit={handleOpenEditModal}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />
      </Box>

      {/* Add/Edit Modal */}
      <SubscriptionModal
        open={modalOpen}
        onClose={handleCloseModal}
        subscription={editingSubscription}
        onSave={handleSaveSubscription}
        isEditing={!!editingSubscription}
      />
    </Box>
  );
};

export default SubscriptionsTab;
