import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  CategoryBreakdownItem,
  CategoryDetails,
  CategoryType,
  DrillLevel,
  OverviewDataItem,
  BreakdownTransaction,
} from '../types';
import { isPendingTransaction } from '../utils';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';

export type BreakdownView = 'overview' | 'category' | 'vendor' | 'timeline';

interface UseBreakdownDrilldownOptions {
  startDate: Date;
  endDate: Date;
  categoryType: CategoryType;
  categoryBreakdown: CategoryBreakdownItem[];
  transactions: BreakdownTransaction[];
}

interface CategoryDetailsRequest {
  parentId?: number;
  subcategoryId?: number;
  categoryName?: string;
}

const useBreakdownDrilldown = ({
  startDate,
  endDate,
  categoryType,
  categoryBreakdown,
  transactions,
}: UseBreakdownDrilldownOptions) => {
  const [view, setView] = useState<BreakdownView>('overview');
  const [drillStack, setDrillStack] = useState<DrillLevel[]>([]);
  const [categoryDetails, setCategoryDetails] = useState<CategoryDetails | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeout = useRef<number>();
  const { locale } = useLocaleSettings();

  const startZoomAnimation = useCallback(() => {
    setIsZooming(true);
    if (zoomTimeout.current) {
      window.clearTimeout(zoomTimeout.current);
    }
    zoomTimeout.current = window.setTimeout(() => setIsZooming(false), 300);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomTimeout.current) {
        window.clearTimeout(zoomTimeout.current);
      }
    };
  }, []);

  const currentLevel = useMemo(() => (drillStack.length > 0 ? drillStack[drillStack.length - 1] : null), [drillStack]);

  const currentData = useMemo<OverviewDataItem[]>(() => {
    if (!currentLevel) {
      return categoryBreakdown.map(item => ({
        id: item.parentId,
        name: item.category,
        color: item.color,
        icon: item.icon,
        description: item.description,
        value: Math.abs(item.total),
        count: item.count,
        previousValue: item.previousTotal ? Math.abs(item.previousTotal) : undefined,
        history: item.history,
        subcategories: item.subcategories,
      }));
    }

    if (currentLevel.type === 'parent') {
      const parentCategory = categoryBreakdown.find(cat => cat.parentId === currentLevel.parentId);
      if (!parentCategory) {
        return [];
      }

      return parentCategory.subcategories.map(sub => ({
        id: sub.id,
        name: sub.name,
        color: sub.color,
        icon: sub.icon,
        description: sub.description,
        value: Math.abs(sub.total),
        count: sub.count,
      }));
    }

    return [];
  }, [categoryBreakdown, currentLevel]);

  const getCategoryTransactionCounts = useCallback(
    (categoryId: number, isSubcategory = false) => {
      const categoryTransactions = transactions.filter(tx => {
        if (isSubcategory) {
          return (tx.subcategory_id ?? tx.subcategoryId) === categoryId;
        }
        return (tx.parent_id ?? tx.parentId) === categoryId;
      });

      const pendingCount = categoryTransactions.filter(tx => isPendingTransaction(tx)).length;
      const processedCount = categoryTransactions.length - pendingCount;

      return { processedCount, pendingCount, total: categoryTransactions.length };
    },
    [transactions]
  );

  const loadCategoryDetails = useCallback(
    async ({ parentId, subcategoryId, categoryName }: CategoryDetailsRequest) => {
      startZoomAnimation();
      try {
        const params = new URLSearchParams({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          type: categoryType,
        });
        if (locale) {
          params.append('locale', locale);
        }

        if (subcategoryId) {
          params.append('subcategoryId', subcategoryId.toString());
        } else if (parentId) {
          params.append('parentId', parentId.toString());
        } else if (categoryName) {
          params.append('category', categoryName);
        }

        const response = await apiClient.get(`/api/analytics/category-details?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        setCategoryDetails(response.data as CategoryDetails);
        setDetailsModalOpen(true);
      } catch (error) {
        console.error('Error fetching category details:', error);
        alert('Failed to load category details. Check console for details.');
      }
    },
    [categoryType, endDate, locale, startDate, startZoomAnimation]
  );

  const handleDrillDown = useCallback(
    (parentId: number, parentName: string) => {
      startZoomAnimation();
      setDrillStack(prev => [...prev, { type: 'parent', parentId, parentName }]);
    },
    [startZoomAnimation]
  );

  const handleSubcategoryClick = useCallback(
    (subcategoryId: number, subcategoryName: string) => {
      startZoomAnimation();
      setDrillStack(prev => {
        const current = prev[prev.length - 1];
        return [
          ...prev,
          {
            type: 'subcategory',
            parentId: current?.parentId,
            parentName: current?.parentName,
            subcategoryId,
            subcategoryName,
          },
        ];
      });
      loadCategoryDetails({ subcategoryId, categoryName: subcategoryName });
    },
    [loadCategoryDetails, startZoomAnimation]
  );

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index === -1) {
      setDrillStack([]);
      setDetailsModalOpen(false);
      return;
    }

    setDrillStack(prev => {
      if (index < prev.length - 1) {
        return prev.slice(0, index + 1);
      }
      return prev;
    });
  }, []);

  const handleBackToParent = useCallback(() => {
    setDrillStack(prev => {
      if (prev.length === 0) {
        return prev;
      }
      return prev.slice(0, -1);
    });
    setDetailsModalOpen(false);
  }, []);

  const closeDetailsModal = useCallback(() => {
    setDetailsModalOpen(false);
    setCategoryDetails(null);
  }, []);

  const resetDrilldown = useCallback(() => {
    setDrillStack([]);
  }, []);

  return {
    view,
    setView,
    drillStack,
    currentLevel,
    currentData,
    isZooming,
    handleDrillDown,
    handleSubcategoryClick,
    handleBreadcrumbClick,
    handleBackToParent,
    getCategoryTransactionCounts,
    categoryDetails,
    detailsModalOpen,
    openCategoryDetails: loadCategoryDetails,
    closeDetailsModal,
    resetDrilldown,
  };
};

export default useBreakdownDrilldown;
