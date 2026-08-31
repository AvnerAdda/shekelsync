import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { statusAfterPrimaryAction } from '../review-helpers';
import {
  FINANCIAL_TRUTH_CHANGED_EVENT,
  financialTruthChangeAffects,
} from '@renderer/features/financial-truth/types';
import type {
  MoneyReviewAction,
  MoneyReviewItem,
  MoneyReviewResponse,
  MoneyReviewStatus,
  MoneyReviewUpdateResponse,
  SnoozePreset,
} from '../types';

export const EMPTY_MONEY_REVIEW_RESPONSE: MoneyReviewResponse = {
  success: true,
  generatedAt: '',
  summary: {
    open: 0,
    snoozed: 0,
    completed: 0,
    estimatedMinutes: 0,
    potentialImpact: 0,
    byGroup: { data: 0, cash: 0, improve: 0 },
  },
  items: [],
};

function replaceItem(
  current: MoneyReviewResponse,
  updatedItem: MoneyReviewItem,
): MoneyReviewResponse {
  const items = current.items.map((item) => item.id === updatedItem.id ? updatedItem : item);
  const openItems = items.filter((item) => ['active', 'accepted'].includes(item.status));
  return {
    ...current,
    items,
    summary: {
      ...current.summary,
      open: openItems.length,
      snoozed: items.filter((item) => item.status === 'snoozed').length,
      completed: items.filter((item) => ['resolved', 'dismissed'].includes(item.status)).length,
      estimatedMinutes: openItems.reduce((sum, item) => sum + (item.group === 'data' ? 1 : 2), 0),
      potentialImpact: openItems.reduce((sum, item) => sum + item.potentialImpact, 0),
      byGroup: openItems.reduce((groups, item) => ({
        ...groups,
        [item.group]: groups[item.group] + 1,
      }), { data: 0, cash: 0, improve: 0 }),
    },
  };
}

interface UseMoneyReviewOptions {
  enabled?: boolean;
  initialResponse?: MoneyReviewResponse | null;
  onExternalAction?: () => void;
  onReviewChanged?: () => void;
}

export function useMoneyReview({
  enabled = true,
  initialResponse = null,
  onExternalAction,
  onReviewChanged,
}: UseMoneyReviewOptions = {}) {
  const navigate = useNavigate();
  const { t } = useTranslation('translation', { keyPrefix: 'moneyReview' });
  const { showNotification } = useNotification();
  const translationRef = useRef(t);
  translationRef.current = t;
  const initialLoadNeededRef = useRef(!initialResponse);
  const initialLoadStartedRef = useRef(false);
  const [response, setResponse] = useState<MoneyReviewResponse>(
    initialResponse || EMPTY_MONEY_REVIEW_RESPONSE,
  );
  const [loading, setLoading] = useState(enabled && !initialResponse);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const loadReview = useCallback(async (background = false) => {
    if (!enabled) return;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<MoneyReviewResponse>('/api/money-review', {
        cacheMode: 'no-store',
      });
      if (!result.ok || !result.data?.success) throw new Error(translationRef.current('errors.load'));
      setResponse(result.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : translationRef.current('errors.load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !initialLoadNeededRef.current || initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void loadReview();
  }, [enabled, loadReview]);

  useEffect(() => {
    if (!enabled) return;
    const handleDataRefresh = () => void loadReview(true);
    const handleTruthChange = (event: Event) => {
      if (financialTruthChangeAffects(event, ['money-review'])) void loadReview(true);
    };
    window.addEventListener('dataRefresh', handleDataRefresh);
    window.addEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, handleTruthChange);
    return () => {
      window.removeEventListener('dataRefresh', handleDataRefresh);
      window.removeEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, handleTruthChange);
    };
  }, [enabled, loadReview]);

  const updateStatus = useCallback(async (
    item: MoneyReviewItem,
    status: MoneyReviewStatus,
    snoozePreset?: SnoozePreset,
  ): Promise<boolean> => {
    setUpdatingId(item.id);
    try {
      const result = await apiClient.put<MoneyReviewUpdateResponse>(
        `/api/money-review/items/${item.id}/status`,
        { status, ...(snoozePreset ? { snoozePreset } : {}) },
      );
      if (!result.ok || !result.data?.success) throw new Error(t('errors.update'));
      setResponse((current) => replaceItem(current, result.data.item));
      const messageKey = status === 'snoozed' && snoozePreset
        ? `messages.snoozed.${snoozePreset}`
        : `messages.${status}`;
      showNotification(t(messageKey), status === 'dismissed' ? 'info' : 'success');
      onReviewChanged?.();
      return true;
    } catch (updateError) {
      showNotification(updateError instanceof Error ? updateError.message : t('errors.update'), 'error');
      return false;
    } finally {
      setUpdatingId(null);
    }
  }, [onReviewChanged, showNotification, t]);

  const performPrimaryAction = useCallback(async (
    item: MoneyReviewItem,
    action: MoneyReviewAction,
  ) => {
    if (item.status === 'active' && !item.actionType.startsWith('quest_')) {
      const updated = await updateStatus(item, statusAfterPrimaryAction(item.status));
      if (!updated) return;
    }

    const params = action.params || {};
    if (action.action !== 'bulk_refresh') onExternalAction?.();
    switch (action.action) {
      case 'bulk_refresh': {
        const result = await apiClient.post<{ success?: boolean; message?: string }>('/api/scrape/bulk', {});
        if (!result.ok || result.data?.success === false) {
          showNotification(result.data?.message || t('errors.sync'), 'error');
          return;
        }
        showNotification(result.data?.message || t('messages.syncStarted'), 'success');
        window.dispatchEvent(new Event('dataRefresh'));
        return;
      }
      case 'view_category':
      case 'edit_budget':
        navigate(`/analysis?tab=budget&categoryDefinitionId=${encodeURIComponent(String(params.category_definition_id || params.categoryDefinitionId || ''))}&budgetAction=details`);
        return;
      case 'view_budgets':
        navigate('/analysis?tab=budget');
        return;
      case 'view_analytics':
        navigate('/analysis?tab=spending');
        return;
      case 'view_transaction':
        window.dispatchEvent(new CustomEvent('openTransactionDetail', {
          detail: { identifier: params.id, vendor: params.vendor },
        }));
        return;
      case 'categorize_transaction':
        window.dispatchEvent(new CustomEvent('openCategoriesModal', {
          detail: {
            tab: 'categorize',
            transaction: { identifier: params.id, vendor: params.vendor },
          },
        }));
        return;
      case 'view_uncategorized':
        window.dispatchEvent(new CustomEvent('openCategoriesModal', { detail: { tab: 'categorize' } }));
        return;
      case 'view_vendor':
        window.dispatchEvent(new CustomEvent('openTransactionSearch', { detail: { vendor: params.vendor } }));
        return;
      case 'create_rule':
        window.dispatchEvent(new CustomEvent('openCategoriesModal', {
          detail: { tab: 'create_rules', vendor: params.vendor },
        }));
        return;
      case 'view_subscriptions':
        navigate('/analysis?tab=subscriptions');
        return;
      case 'open_optimizer':
        window.dispatchEvent(new CustomEvent('openOptimizerDrawer'));
        return;
      case 'view_quests':
        navigate('/analysis?tab=actions');
        return;
      case 'accept_quest': {
        setUpdatingId(item.id);
        try {
          const result = await apiClient.post<{ success?: boolean }>(
            `/api/analytics/quests/${encodeURIComponent(String(params.quest_id || item.id))}/accept`,
            {},
          );
          if (!result.ok || result.data?.success === false) throw new Error(t('errors.update'));
          showNotification(t('messages.questAccepted', { defaultValue: 'Challenge accepted' }), 'success');
          await loadReview(true);
          onReviewChanged?.();
        } catch (questError) {
          showNotification(questError instanceof Error ? questError.message : t('errors.update'), 'error');
        } finally {
          setUpdatingId(null);
        }
        return;
      }
      case 'decline_quest': {
        setUpdatingId(item.id);
        try {
          const result = await apiClient.post<{ success?: boolean }>(
            `/api/analytics/quests/${encodeURIComponent(String(params.quest_id || item.id))}/decline`,
            {},
          );
          if (!result.ok || result.data?.success === false) throw new Error(t('errors.update'));
          showNotification(t('messages.questDeclined', { defaultValue: 'Challenge removed' }), 'info');
          await loadReview(true);
          onReviewChanged?.();
        } catch (questError) {
          showNotification(questError instanceof Error ? questError.message : t('errors.update'), 'error');
        } finally {
          setUpdatingId(null);
        }
        return;
      }
      default:
        if (typeof params.path === 'string') navigate(params.path);
    }
  }, [loadReview, navigate, onExternalAction, onReviewChanged, showNotification, t, updateStatus]);

  return {
    response,
    loading,
    refreshing,
    error,
    updatingId,
    loadReview,
    updateStatus,
    performPrimaryAction,
  };
}
