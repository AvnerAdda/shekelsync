import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Tabs,
  Tab,
  TextField,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Card,
  CardContent,
  Grid,
  Alert,
  CircularProgress,
  Divider,
  Collapse,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Tooltip,
  Paper,
  Menu,
  ListItemIcon,
  LinearProgress,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Category as CategoryIcon,
  TrendingUp as InvestmentIcon,
  MonetizationOn as IncomeIcon,
  ShoppingCart as ExpenseIcon,
  PlayArrow as PlayArrowIcon,
  ToggleOn as ToggleOnIcon,
  ToggleOff as ToggleOffIcon,
  Visibility as VisibilityIcon,
  AutoAwesome as AutoAwesomeIcon,
  Restaurant as RestaurantIcon,
  DirectionsCar as DirectionsCarIcon,
  LocalGroceryStore as LocalGroceryStoreIcon,
  Home as HomeIcon,
  Flight as FlightIcon,
  LocalHospital as LocalHospitalIcon,
  School as SchoolIcon,
  FitnessCenter as FitnessCenterIcon,
  Smartphone as SmartphoneIcon,
  Checkroom as CheckroomIcon,
  Pets as PetsIcon,
  SportsEsports as SportsEsportsIcon,
  Theaters as TheatersIcon,
  LocalBar as LocalBarIcon,
  LocalCafe as LocalCafeIcon,
  AccountBalance as AccountBalanceIcon,
  CreditCard as CreditCardIcon,
  Savings as SavingsIcon,
  Work as WorkIcon,
  AttachMoney as AttachMoneyIcon,
  TrendingDown as TrendingDownIcon,
  LocalTaxi as LocalTaxiIcon,
  Train as TrainIcon,
  LocalGasStation as LocalGasStationIcon,
  ElectricBolt as ElectricBoltIcon,
  Water as WaterIcon,
  Wifi as WifiIcon,
  Phone as PhoneIcon,
  LiveTv as LiveTvIcon,
  MedicalServices as MedicalServicesIcon,
  Cake as CakeIcon,
  CardGiftcard as CardGiftcardIcon,
  ChildCare as ChildCareIcon,
  MenuBook as MenuBookIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Sort as SortIcon,
  SwapVert as SwapVertIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import ModalHeader from './ModalHeader';
import { apiClient } from '@/lib/api-client';
import CategoryIconComponent from '@renderer/features/breakdown/components/CategoryIcon';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '../components/LicenseReadOnlyAlert';
import TransactionDetailModal, { TransactionForModal } from './TransactionDetailModal';
import {
  buildCategoryHierarchyTransactionKey,
  formatCategoryHierarchyCurrency,
  formatCategoryHierarchyDate,
  resolveLocalizedCategoryName,
  type LocalizedCategoryInfo,
} from './category-hierarchy-helpers';

interface CategoryDefinition {
  id: number;
  name: string;
  name_en?: string;
  name_fr?: string;
  name_he?: string;
  parent_id: number | null;
  category_type: 'expense' | 'investment' | 'income';
  icon?: string;
  color?: string;
  description?: string;
  tags?: string[];
  display_order: number;
  is_active: boolean;
  children?: CategoryDefinition[];
  transaction_count?: number;
  total_amount?: number;
}

interface PatternRule {
  id: number;
  name_pattern: string;
  target_category: string;
  parent_category?: string;
  subcategory?: string;
  category_definition_id?: number;
  category_type?: 'expense' | 'investment' | 'income';
  category_name?: string;
  category_name_en?: string;
  category_name_fr?: string;
  category_name_he?: string;
  is_active: boolean;
  priority: number;
}

interface TransactionMatch {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  accountNumber?: string;
  memo?: string | null;
  tags?: string[];
  category_name?: string | null;
  parent_name?: string | null;
  category_definition_id?: number | null;
  category_type?: string | null;
}

interface PatternPreview {
  pattern: string;
  totalCount: number;
  matchedTransactions: TransactionMatch[];
}

interface UncategorizedTransaction {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  accountNumber?: string;
  categoryDefinitionId?: number | null;
  categoryType?: 'expense' | 'investment' | 'income' | null;
  categoryName?: string | null;
  categoryNameEn?: string | null;
  categoryNameFr?: string | null;
  categoryColor?: string | null;
  categoryIcon?: string | null;
}

interface UncategorizedSummary {
  totalCount: number;
  totalAmount: number;
  recentTransactions: UncategorizedTransaction[];
}

type CategoryType = 'expense' | 'investment' | 'income';

interface TransactionAssignment {
  type: CategoryType;
  categoryPath: number[]; // Array of category IDs from root to leaf (e.g., [1, 5, 12])
}

interface CategoryHierarchyModalProps {
  open: boolean;
  onClose: () => void;
  onCategoriesUpdated?: () => void;
  initialTab?: number;
}

// Icon rendering is now handled by the CategoryIcon component which supports all Material-UI icons dynamically

const CategoryHierarchyModal: React.FC<CategoryHierarchyModalProps> = ({
  open,
  onClose,
  onCategoriesUpdated = () => {},
  initialTab,
}) => {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'categoryHierarchy' });
  const theme = useTheme();
  const locale = useMemo(() => (i18n.language?.split('-')[0] || 'he') as 'he' | 'en' | 'fr', [i18n.language]);
  const [activeTab, setActiveTab] = useState(0);
  useEffect(() => {
    if (open && initialTab !== undefined) setActiveTab(initialTab);
  }, [open, initialTab]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState(false);

  // Category Hierarchy State
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [uncategorized, setUncategorized] = useState<UncategorizedSummary | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    expense: true,
    investment: false,
    income: false,
  });
  const [editingCategory, setEditingCategory] = useState<CategoryDefinition | null>(null);
  const [newCategory, setNewCategory] = useState<Partial<CategoryDefinition>>({
    name: '',
    parent_id: null,
    category_type: 'expense',
    description: '',
  });

  // Pattern Rules State
  const [rules, setRules] = useState<PatternRule[]>([]);
  const [newRule, setNewRule] = useState<Partial<PatternRule>>({
    name_pattern: '',
    category_type: 'expense',
  });
  const [newRuleType, setNewRuleType] = useState<CategoryType>('expense');
  const [newRuleParentId, setNewRuleParentId] = useState<number | null>(null);
  const [newRuleCategoryId, setNewRuleCategoryId] = useState<number | null>(null);
  const [isApplyingRules, setIsApplyingRules] = useState(false);
  const [ruleSearchQuery, setRuleSearchQuery] = useState<string>('');

  // Transaction Preview State
  const [ruleTransactionCounts, setRuleTransactionCounts] = useState<Map<number, number>>(new Map());
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);
  const [rulePreviewData, setRulePreviewData] = useState<Map<number, PatternPreview>>(new Map());
  const [newRulePreview, setNewRulePreview] = useState<PatternPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, TransactionAssignment>>({});
  const [savingAssignments, setSavingAssignments] = useState<Record<string, boolean>>({});
  const [creatingRules, setCreatingRules] = useState<Record<string, boolean>>({});

  // Inline Transaction Viewer State (within tree)
  const [expandedCategoryTransactions, setExpandedCategoryTransactions] = useState<number | null>(null);
  const [categoryTransactionsMap, setCategoryTransactionsMap] = useState<Map<number, TransactionMatch[]>>(new Map());
  const [loadingCategoryTransactions, setLoadingCategoryTransactions] = useState<number | null>(null);
  const [expandedTransactionNames, setExpandedTransactionNames] = useState<Set<string>>(new Set());
  const [transactionToMove, setTransactionToMove] = useState<TransactionMatch | null>(null);
  const [transactionMoveMenuAnchor, setTransactionMoveMenuAnchor] = useState<HTMLElement | null>(null);
  const [movingFromCategory, setMovingFromCategory] = useState<CategoryDefinition | null>(null);

  const queueDataRefresh = useCallback(() => {
    setPendingRefresh(true);
  }, []);

  const handleRefreshNow = useCallback(() => {
    onCategoriesUpdated();
    setPendingRefresh(false);
  }, [onCategoriesUpdated]);

  // Re-categorize by Rule Dialog State
  const [recategorizeDialogOpen, setRecategorizeDialogOpen] = useState(false);
  const [recategorizeTransaction, setRecategorizeTransaction] = useState<TransactionMatch | null>(null);
  const [recategorizeTargetCategoryId, setRecategorizeTargetCategoryId] = useState<number | null>(null);
  const [recategorizeCategoryType, setRecategorizeCategoryType] = useState<CategoryType>('expense');
  const [isCreatingRecategorizeRule, setIsCreatingRecategorizeRule] = useState(false);

  // License Read-Only Alert State
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>(undefined);

  // Transaction Detail Modal State
  const [transactionDetailModalOpen, setTransactionDetailModalOpen] = useState(false);
  const [selectedTransactionForDetail, setSelectedTransactionForDetail] = useState<TransactionForModal | null>(null);

  // Memoized grouped transactions by category ID -> grouped by name
  const groupedTransactionsCache = useMemo(() => {
    const cache = new Map<number, [string, TransactionMatch[]][]>();
    categoryTransactionsMap.forEach((transactions, categoryId) => {
      const grouped = new Map<string, TransactionMatch[]>();
      transactions.forEach(txn => {
        const name = txn.name || 'Unknown';
        if (!grouped.has(name)) {
          grouped.set(name, []);
        }
        grouped.get(name)!.push(txn);
      });
      // Sort by count (descending)
      cache.set(categoryId, Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length));
    });
    return cache;
  }, [categoryTransactionsMap]);

  // Sorting State for Uncategorized Transactions
  const [sortBy, setSortBy] = useState<'name' | 'amount' | 'date'>('date');

  // Category Search State
  const [categorySearchQuery, setCategorySearchQuery] = useState<string>('');
  const [transactionSearchCategoryIds, setTransactionSearchCategoryIds] = useState<Set<number>>(new Set());
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [parentCategoryForCreation, setParentCategoryForCreation] = useState<CategoryDefinition | null>(null);

  const getLocalizedCategoryName = useCallback(
    (category?: LocalizedCategoryInfo | null) =>
      resolveLocalizedCategoryName(category, locale),
    [locale],
  );

  const formatCurrency = formatCategoryHierarchyCurrency;
  const formatDate = (value: string) =>
    formatCategoryHierarchyDate(value, t('helpers.unknownDate'));

  const getCategoryIcon = (category: CategoryDefinition) => {
    return (
      <Box sx={{ mr: 1, display: 'inline-flex', alignItems: 'center' }}>
        <CategoryIconComponent
          iconName={category.icon}
          color={category.color || undefined}
          size={20}
        />
      </Box>
    );
  };

  const categoryLookup = useMemo(() => {
    const map = new Map<number, CategoryDefinition>();
    const traverse = (nodes: CategoryDefinition[]) => {
      nodes.forEach(node => {
        map.set(node.id, node);
        if (node.children && node.children.length > 0) {
          traverse(node.children);
        }
      });
    };

    traverse(categories);
    return map;
  }, [categories]);

  const categoryRootsByType = useMemo(() => {
    const result: Record<CategoryType, CategoryDefinition[]> = {
      expense: [],
      investment: [],
      income: [],
    };

    // Add the root categories themselves (הוצאות, השקעות, הכנסות)
    // These will be shown in the first dropdown
    categories.forEach((root: CategoryDefinition) => {
      result[root.category_type as CategoryType].push(root);
    });

    return result;
  }, [categories]);

  const getTransactionKey = (txn: UncategorizedTransaction) =>
    buildCategoryHierarchyTransactionKey(txn);

  // Helper function to auto-detect type from category path
  const getTypeFromCategoryPath = useCallback((path: number[]): CategoryType => {
    if (path.length === 0) return 'expense'; // default
    const rootCategoryId = path[0];
    const rootCategory = categoryLookup.get(rootCategoryId);
    return (rootCategory?.category_type as CategoryType) || 'expense';
  }, [categoryLookup]);

  const buildCategoryTree = useCallback((flatCategories: CategoryDefinition[] = []): CategoryDefinition[] => {
    const categoryMap = new Map<number, CategoryDefinition>();
    const rootCategories: CategoryDefinition[] = [];

    // First pass: create map of all categories
    flatCategories.forEach(cat => {
      categoryMap.set(cat.id, { ...cat, children: [] });
    });

    // Second pass: build tree structure
    flatCategories.forEach(cat => {
      const categoryNode = categoryMap.get(cat.id)!;
      if (cat.parent_id === null) {
        rootCategories.push(categoryNode);
      } else {
        const parent = categoryMap.get(cat.parent_id);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(categoryNode);
        }
      }
    });

    // Sort by display_order
    const sortByOrder = (cats: CategoryDefinition[]) => {
      cats.sort((a, b) => a.display_order - b.display_order);
      cats.forEach(cat => {
        if (cat.children && cat.children.length > 0) {
          sortByOrder(cat.children);
        }
      });
    };
    sortByOrder(rootCategories);

    return rootCategories;
  }, []);

  const fetchAllTransactionCounts = useCallback(async (rulesToFetch: PatternRule[] | any) => {
    if (!Array.isArray(rulesToFetch) || rulesToFetch.length === 0) {
      setRuleTransactionCounts(new Map());
      return;
    }
    try {
      const counts = new Map<number, number>();

      await Promise.all(
        rulesToFetch.map(async (rule) => {
          try {
            const response = await apiClient.get(
              `/api/categorization_rules/preview?ruleId=${rule.id}&limit=0`
            );
            if (response.ok) {
              const data = response.data as any;
              counts.set(rule.id, data.totalCount);
            }
          } catch (err) {
            console.error(`Error fetching count for rule ${rule.id}:`, err);
          }
        })
      );

      setRuleTransactionCounts(counts);
    } catch (error) {
      console.error('Error fetching transaction counts:', error);
    }
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/categorization_rules');
      if (!response.ok) throw new Error(t('errors.loadRules'));

      const rulesData = response.data as any;
      setRules(rulesData);

      // Fetch transaction counts for all rules
      await fetchAllTransactionCounts(rulesData);
    } catch (error) {
      console.error('Error fetching rules:', error);
      setError(t('errors.loadRules'));
    }
  }, [fetchAllTransactionCounts, t]);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/categories/hierarchy');
      if (!response.ok) throw new Error(t('errors.loadCategories'));

      const payload = response.data as any;
      const categoryList = Array.isArray(payload) ? payload : payload?.categories;
      const normalizedCategories = (categoryList || []).map((cat: any) => ({
        ...cat,
        // Backend (SQLite) may return 0/1; Switch expects a boolean
        is_active: cat.is_active === undefined ? true : Boolean(cat.is_active),
      }));
      setCategories(buildCategoryTree(normalizedCategories));

      if (!Array.isArray(payload) && payload?.uncategorized) {
        setUncategorized({
          totalCount: payload.uncategorized.totalCount ?? 0,
          totalAmount: payload.uncategorized.totalAmount ?? 0,
          recentTransactions: payload.uncategorized.recentTransactions ?? [],
        });
      } else {
        setUncategorized(null);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      setError(t('errors.loadCategories'));
    } finally {
      setLoading(false);
    }
  }, [buildCategoryTree, t]);

  // Helper function to build category path from a category ID
  const buildCategoryPath = useCallback((categoryId: number | null | undefined): number[] => {
    if (!categoryId) return [];

    const path: number[] = [];
    let currentId: number | null = categoryId;

    // Traverse up the hierarchy to build the full path
    while (currentId !== null) {
      const category = categoryLookup.get(currentId);
      if (!category) break;

      path.unshift(currentId); // Add to beginning of array
      currentId = category.parent_id;
    }

    return path;
  }, [categoryLookup]);

  useEffect(() => {
    if (open) {
      fetchCategories();
      fetchRules();
    }
  }, [fetchCategories, fetchRules, open]);

  useEffect(() => {
    const trimmedQuery = categorySearchQuery.trim();
    if (!open || activeTab !== 1 || trimmedQuery.length < 2) {
      setTransactionSearchCategoryIds(new Set());
      return;
    }

    setTransactionSearchCategoryIds(new Set());

    let isActive = true;
    const timeoutId = setTimeout(async () => {
      try {
        const response = await apiClient.get(`/api/transactions/search?query=${encodeURIComponent(trimmedQuery)}&limit=200`);
        if (!response.ok) {
          throw new Error(response.statusText || 'Search failed');
        }

        const payload = response.data as any;
        const transactions = Array.isArray(payload?.transactions) ? payload.transactions : [];
        const nextIds = new Set<number>();

        transactions.forEach((txn: any) => {
          if (txn?.category_definition_id) {
            const categoryId = Number.parseInt(txn.category_definition_id, 10);
            if (!Number.isNaN(categoryId)) {
              nextIds.add(categoryId);
            }
          }
        });

        if (isActive) {
          setTransactionSearchCategoryIds(nextIds);
        }
      } catch (error) {
        console.error('Error searching transactions for category filter:', error);
        if (isActive) {
          setTransactionSearchCategoryIds(new Set());
        }
      }
    }, 350);

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [activeTab, categorySearchQuery, open]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleDataRefresh = () => setPendingRefresh(false);
    window.addEventListener('dataRefresh', handleDataRefresh);

    return () => window.removeEventListener('dataRefresh', handleDataRefresh);
  }, []);

  useEffect(() => {
    const hasUncategorized = uncategorized?.recentTransactions && uncategorized.recentTransactions.length > 0;

    if (!hasUncategorized) {
      setAssignmentDrafts({});
      setSavingAssignments({});
      return;
    }

    setAssignmentDrafts((prev: Record<string, TransactionAssignment>) => {
      const next: Record<string, TransactionAssignment> = {};

      // Process uncategorized transactions
      uncategorized!.recentTransactions.forEach((txn: UncategorizedTransaction) => {
        const key = getTransactionKey(txn);
        if (prev[key]) {
          // Keep existing user selections
          next[key] = prev[key];
        } else {
          // Auto-populate from existing transaction data
          let type: CategoryType;
          let categoryPath: number[] = [];

          // 1. Try to use existing category_type from transaction
          if (txn.categoryType && ['expense', 'investment', 'income'].includes(txn.categoryType)) {
            type = txn.categoryType as CategoryType;
          } else {
            // 2. Fallback: Infer from price
            type = txn.price >= 0 ? 'income' : 'expense';
          }

          // 3. Build category path if transaction has a category assigned
          if (txn.categoryDefinitionId) {
            categoryPath = buildCategoryPath(txn.categoryDefinitionId);
          }

          next[key] = {
            type,
            categoryPath,
          };
        }
      });

      return next;
    });
  }, [uncategorized, categories, buildCategoryPath]);
  
  const handleCategoryPathChange = (key: string, depth: number, categoryId: number | null) => {
    setAssignmentDrafts((prev: Record<string, TransactionAssignment>) => {
      const draft = prev[key] || { type: 'expense', categoryPath: [] };
      const newPath = [...draft.categoryPath];

      if (categoryId === null) {
        // Clear from this depth onwards
        newPath.splice(depth);
      } else {
        // Set this level and clear all deeper levels
        newPath.splice(depth, newPath.length - depth, categoryId);
      }

      // Auto-detect type from the category path
      const newType = getTypeFromCategoryPath(newPath);

      return {
        ...prev,
        [key]: {
          ...draft,
          type: newType,
          categoryPath: newPath,
        },
      };
    });
  };

  const handleSaveAssignment = async (txn: UncategorizedTransaction) => {
    const key = getTransactionKey(txn);
    const draft = assignmentDrafts[key];

    if (!draft || draft.categoryPath.length === 0) {
      setError(t('errors.selectCategory'));
      return;
    }

    // Get the final (leaf) category from the path
    const selectedCategoryId = draft.categoryPath[draft.categoryPath.length - 1];
    const categoryDefinition = categoryLookup.get(selectedCategoryId);

    if (!categoryDefinition) {
      setError(t('errors.categoryUnavailable'));
      return;
    }

  setSavingAssignments((prev: Record<string, boolean>) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const response = await apiClient.put(`/api/transactions/${encodeURIComponent(`${txn.identifier}|${txn.vendor}`)}`, {
        category_definition_id: selectedCategoryId,
        category_type: draft.type,
        category: categoryDefinition.name,
        auto_categorized: false,
        confidence_score: 1.0,
      });

      if (!response.ok) {
        const errorPayload = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorPayload);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorPayload?.error || t('errors.categorizeTransaction'));
      }

      setSuccess(t('notifications.assignmentSaved'));
      setTimeout(() => setSuccess(null), 3000);

      // Dispatch category assignment event for investment notification service
      if (draft.type === 'investment') {
        const categoryAssignedEvent = new CustomEvent('categoryAssigned', {
          detail: {
            transactionId: txn.identifier,
            transactionVendor: txn.vendor,
            transactionDescription: txn.name,
            categoryName: getLocalizedCategoryName(categoryDefinition) || categoryDefinition.name,
            categoryType: draft.type
          }
        });
        window.dispatchEvent(categoryAssignedEvent);
      }

      await fetchCategories();
      queueDataRefresh();
    } catch (assignmentError) {
      console.error('Error categorizing transaction:', assignmentError);
      setError(assignmentError instanceof Error && assignmentError.message
        ? assignmentError.message
        : t('errors.categorizeTransaction'));
    } finally{
      setSavingAssignments((prev: Record<string, boolean>) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };


  const handleAutoAssignSimilar = async (txn: UncategorizedTransaction) => {
    const key = getTransactionKey(txn);
    const draft = assignmentDrafts[key];

    if (!draft || draft.categoryPath.length === 0) {
      setError(t('errors.autoAssignCategoryRequired'));
      return;
    }

    const selectedCategoryId = draft.categoryPath[draft.categoryPath.length - 1];

    setCreatingRules((prev: Record<string, boolean>) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const response = await apiClient.post('/api/categorization_rules/auto-create', {
        transactionName: txn.name,
        categoryDefinitionId: selectedCategoryId,
        categoryType: draft.type,
      });

      if (!response.ok) {
        const result = response.data as any;
        throw new Error(result.error || t('errors.createRule'));
      }

      const result = response.data as any;

      // Check if rule already existed (success response with alreadyExists flag)
      if (result.alreadyExists) {
        setSuccess(t('notifications.ruleExists'));
        setTimeout(() => setSuccess(null), 5000);

        // Apply existing rule to transactions
        await handleApplyRules();
        await fetchCategories();
        await fetchRules();
        queueDataRefresh();
        return;
      }

      // New rule was created
      setSuccess(t('notifications.ruleCreatedForName', { name: txn.name }));
      setTimeout(() => setSuccess(null), 5000);

      // Apply the newly created rule to existing transactions
      await handleApplyRules();

      await fetchCategories();
      await fetchRules();
      queueDataRefresh();
    } catch (ruleError) {
      console.error('Error creating auto-assignment rule:', ruleError);
      setError(ruleError instanceof Error && ruleError.message ? ruleError.message : t('errors.createRule'));
    } finally {
      setCreatingRules((prev: Record<string, boolean>) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // Helper function to render cascading category selectors
  const renderCategorySelectors = (
    transactionKey: string,
    draft: TransactionAssignment | undefined,
    rootCategories: CategoryDefinition[]
  ) => {
    const path = draft?.categoryPath || [];
    const selectors: React.ReactElement[] = [];

    // Determine maximum depth to render (current path length + 1 for next level)
    const maxDepth = path.length + 1;

    for (let depth = 0; depth < Math.max(maxDepth, 1); depth++) {
      // Get options for this depth level
      let options: CategoryDefinition[] = [];

      if (depth === 0) {
        // Root level - show root categories
        options = rootCategories;
      } else {
        // Child level - get children of parent at depth-1
        const parentId = path[depth - 1];
        if (parentId) {
          const parent = categoryLookup.get(parentId);
          options = parent?.children || [];
        }
      }

      // Only render if there are options OR if this is a level in the current path
      if (options.length === 0 && depth >= path.length) {
        break;
      }

      const currentValue = path[depth] ?? '';
      const currentCategory = currentValue ? categoryLookup.get(currentValue) : undefined;

      // Determine label based on depth
      const getLabel = (d: number) => {
        if (d === 0) return t('labels.categoryType');
        if (d === 1) return t('labels.category');
        if (d === 2) return t('labels.subcategory');
        return t('labels.subcategoryLevel', { level: d });
      };

      const label = getLabel(depth);

      selectors.push(
        <Grid key={`cat-${depth}`} size={{ xs: 12, md: 3 }}>
          <FormControl
            fullWidth
            size="small"
            sx={{
              '& .MuiOutlinedInput-root': {
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: currentCategory?.color || 'primary.main',
                  borderWidth: 2,
                },
              },
            }}
          >
            <InputLabel>{label}</InputLabel>
            <Select
              value={currentValue}
              label={label}
              onChange={(event: any) => {
                const value = event.target.value;
                handleCategoryPathChange(transactionKey, depth, value === '' ? null : Number(value));
              }}
              renderValue={(selected) => {
                const cat = categoryLookup.get(selected as number);
                if (!cat) return t('labels.select');
                const displayName = getLocalizedCategoryName(cat);
                return (
                  <Box display="flex" alignItems="center" gap={1}>
                    {getCategoryIcon(cat)}
                    <span>{displayName || cat.name}</span>
                  </Box>
                );
              }}
            >
              <MenuItem value="">
                <em>{t('labels.select')}</em>
              </MenuItem>
              {options.map((cat: CategoryDefinition) => (
                <MenuItem key={cat.id} value={cat.id}>
                  <Box display="flex" alignItems="center" gap={1}>
                    {getCategoryIcon(cat)}
                    <span>{getLocalizedCategoryName(cat) || cat.name}</span>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      );
    }

    return selectors;
  };

  const fetchRulePreview = async (ruleId: number) => {
    try {
      setLoadingPreview(true);
      const response = await apiClient.get(
        `/api/categorization_rules/preview?ruleId=${ruleId}&limit=20`
      );

      if (!response.ok) throw new Error('Failed to fetch preview');

      const data: PatternPreview = response.data as any;
      setRulePreviewData(new Map(rulePreviewData.set(ruleId, data)));
    } catch (error) {
      console.error('Error fetching rule preview:', error);
    } finally {
      setLoadingPreview(false);
    }
  };

  const fetchNewRulePreview = async (pattern: string) => {
    if (!pattern || pattern.trim().length < 2) {
      setNewRulePreview(null);
      return;
    }

    try {
      setLoadingPreview(true);
      const response = await apiClient.get(
        `/api/categorization_rules/preview?pattern=${encodeURIComponent(pattern)}&limit=10`
      );

      if (!response.ok) throw new Error('Failed to fetch preview');

      const data: PatternPreview = response.data as any;
      setNewRulePreview(data);
    } catch (error) {
      console.error('Error fetching new rule preview:', error);
      setNewRulePreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  // Debounce new rule preview
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (newRule.name_pattern) {
        fetchNewRulePreview(newRule.name_pattern);
      } else {
        setNewRulePreview(null);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [newRule.name_pattern]);

  const handleCreateCategory = async () => {
    if (!newCategory.name?.trim()) {
      setError(t('errors.categoryNameRequired'));
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.post('/api/categories/hierarchy', {
        payload: newCategory,
      });

      if (!response.ok) {
        const errorData = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData.error || t('errors.createCategory'));
      }

      setSuccess(t('notifications.categoryCreated'));
      setNewCategory({
        name: '',
        parent_id: null,
        category_type: 'expense',
        description: '',
      });
      await fetchCategories();
      queueDataRefresh();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error creating category:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.createCategory'));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCategory = async (category: CategoryDefinition) => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.put('/api/categories/hierarchy', {
        payload: category,
      });

      if (!response.ok) {
        const errorData = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData.error || t('errors.updateCategory'));
      }

      setSuccess(t('notifications.categoryUpdated'));
      setEditingCategory(null);
      await fetchCategories();
      queueDataRefresh();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error updating category:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.updateCategory'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCategory = async (categoryId: number) => {
    if (!confirm(t('confirm.deleteCategory'))) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.delete(`/api/categories/hierarchy?id=${categoryId}`, {
      });

      if (!response.ok) {
        const errorData = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData.error || t('errors.deleteCategory'));
      }

      setSuccess(t('notifications.categoryDeleted'));
      await fetchCategories();
      queueDataRefresh();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error deleting category:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.deleteCategory'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRule = async () => {
    if (!newRule.name_pattern?.trim() || !newRuleParentId) {
      setError(t('errors.patternAndCategoryRequired'));
      return;
    }

    const parentDefinition = categoryLookup.get(newRuleParentId);
    if (!parentDefinition) {
      setError(t('errors.categoryUnavailable'));
      return;
    }

    const selectedCategoryId = newRuleCategoryId ?? newRuleParentId;

    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.post('/api/categorization_rules', {
        payload: {
          name_pattern: newRule.name_pattern,
          category_definition_id: selectedCategoryId,
          category_type: newRuleType,
          is_active: true,
        },
      });

      if (!response.ok) {
        const errorData = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData.error || t('errors.createRule'));
      }

      setSuccess(t('notifications.ruleCreated'));
      setNewRule({ name_pattern: '', category_type: 'expense' });
      setNewRuleType('expense');
      setNewRuleParentId(null);
      setNewRuleCategoryId(null);
      await fetchRules();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error creating rule:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.createRule'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRule = async (ruleId: number, currentStatus: boolean) => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.put('/api/categorization_rules', {
        id: ruleId,
        payload: {
          is_active: !currentStatus,
        },
      });

      if (!response.ok) {
        const errorData = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData.error || t('errors.toggleRule'));
      }

      setSuccess(t('notifications.ruleStatusUpdated', {
        status: !currentStatus ? 'activated' : 'deactivated',
      }));
      await fetchRules();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error toggling rule:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.toggleRule'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    if (!confirm(t('confirm.deleteRule'))) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.delete(`/api/categorization_rules?id=${ruleId}`, {
      });

      if (!response.ok) {
        const errorData = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData.error || t('errors.deleteRule'));
      }

      setSuccess(t('notifications.ruleDeleted'));
      await fetchRules();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error deleting rule:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.deleteRule'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRuleExpansion = async (ruleId: number) => {
    if (expandedRuleId === ruleId) {
      setExpandedRuleId(null);
    } else {
      setExpandedRuleId(ruleId);
      // Fetch preview data if not already loaded
      if (!rulePreviewData.has(ruleId)) {
        await fetchRulePreview(ruleId);
      }
    }
  };

  const handleApplyRules = async () => {
    try {
      setIsApplyingRules(true);
      setError(null);

      const response = await apiClient.post('/api/apply_categorization_rules', {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorData);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorData.error || t('errors.applyRules'));
      }

      const result = response.data as any;
      setSuccess(t('notifications.rulesApplied', {
        rules: result.rulesApplied ?? 0,
        transactions: result.transactionsUpdated ?? 0,
      }));

      await fetchCategories();
      queueDataRefresh();

      setTimeout(() => setSuccess(null), 5000);
    } catch (error) {
      console.error('Error applying rules:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.applyRules'));
    } finally {
      setIsApplyingRules(false);
    }
  };

  const fetchCategoryTransactionsInline = async (category: CategoryDefinition) => {
    // If already expanded, collapse it
    if (expandedCategoryTransactions === category.id) {
      setExpandedCategoryTransactions(null);
      setExpandedTransactionNames(new Set());
      return;
    }

    try {
      setLoadingCategoryTransactions(category.id);
      setExpandedCategoryTransactions(category.id);
      setExpandedTransactionNames(new Set());

      const response = await apiClient.get(`/api/categories/transactions?categoryId=${category.id}&limit=500`);

      if (!response.ok) {
        throw new Error(t('errors.loadCategoryTransactions'));
      }

      const data = response.data as any;
      const transactions = data?.transactions?.map((txn: any) => ({
        identifier: txn.identifier,
        vendor: txn.vendor,
        date: txn.date,
        name: txn.name,
        price: txn.price,
        accountNumber: txn.accountNumber,
      })) || [];

      setCategoryTransactionsMap(prev => new Map(prev).set(category.id, transactions));
    } catch (error) {
      console.error('Error fetching category transactions:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.loadCategoryTransactions'));
      setExpandedCategoryTransactions(null);
    } finally {
      setLoadingCategoryTransactions(null);
    }
  };

  const handleRemoveTransactionFromCategory = async (txn: TransactionMatch, categoryId: number) => {
    try {
      setError(null);

      const response = await apiClient.put(`/api/transactions/${encodeURIComponent(`${txn.identifier}|${txn.vendor}`)}`, {
        category_definition_id: null,
        auto_categorized: false,
      });

      if (!response.ok) {
        const errorPayload = (response.data as any) || {};
        throw new Error(errorPayload?.error || t('errors.removeTransaction'));
      }

      setSuccess(t('notifications.transactionRemoved'));
      setTimeout(() => setSuccess(null), 3000);

      // Refresh the transaction list for this category
      const category = categoryLookup.get(categoryId);
      if (category) {
        // Force re-fetch by clearing and re-fetching
        setExpandedCategoryTransactions(null);
        setTimeout(() => {
          fetchCategoryTransactionsInline(category);
        }, 100);
      }
      await fetchCategories();
      queueDataRefresh();
    } catch (error) {
      console.error('Error removing transaction:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.removeTransaction'));
    }
  };

  // Opens the Re-categorize by Rule dialog
  const handleCreateRuleFromTransaction = (txn: TransactionMatch, _category: CategoryDefinition) => {
    setRecategorizeTransaction(txn);
    setRecategorizeTargetCategoryId(null);
    setRecategorizeCategoryType('expense');
    setRecategorizeDialogOpen(true);
  };

  // Handles closing the Re-categorize dialog
  const handleCloseRecategorizeDialog = () => {
    setRecategorizeDialogOpen(false);
    setRecategorizeTransaction(null);
    setRecategorizeTargetCategoryId(null);
    setIsCreatingRecategorizeRule(false);
  };

  // Creates the rule with the selected category
  const handleConfirmRecategorize = async () => {
    if (!recategorizeTransaction || !recategorizeTargetCategoryId) {
      setError(t('errors.selectCategory'));
      return;
    }

    const targetCategory = categoryLookup.get(recategorizeTargetCategoryId);
    if (!targetCategory) {
      setError(t('errors.targetCategoryNotFound'));
      return;
    }

    setIsCreatingRecategorizeRule(true);

    try {
      setError(null);

      const response = await apiClient.post('/api/categorization_rules/auto-create', {
        transactionName: recategorizeTransaction.name,
        categoryDefinitionId: recategorizeTargetCategoryId,
        categoryType: targetCategory.category_type,
      });

      const result = response.data as any;

      if (!response.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        if ((response.data as any).status === 409) {
          setSuccess(t('notifications.ruleExistsForName', { name: recategorizeTransaction.name }));
          setTimeout(() => setSuccess(null), 3000);
          handleCloseRecategorizeDialog();
          return;
        } else {
          throw new Error(result.error || t('errors.createRule'));
        }
      }

      const transactionsUpdated = result.transactionsUpdated || 0;
      const successMessage = transactionsUpdated > 0
        ? t('notifications.ruleCreatedAndApplied', {
            name: recategorizeTransaction.name,
            count: transactionsUpdated,
            defaultValue: `Rule created for "${recategorizeTransaction.name}" and applied to ${transactionsUpdated} transaction${transactionsUpdated === 1 ? '' : 's'}`,
          })
        : t('notifications.ruleCreatedForName', { name: recategorizeTransaction.name });
      setSuccess(successMessage);
      setTimeout(() => setSuccess(null), 5000);

      handleCloseRecategorizeDialog();
      await fetchRules();
      await fetchCategories(); // Refresh categories to show updated counts
      queueDataRefresh();
    } catch (error) {
      console.error('Error creating rule:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.createRule'));
    } finally {
      setIsCreatingRecategorizeRule(false);
    }
  };

  const handleMoveTransactionToCategory = async (txn: TransactionMatch, targetCategoryId: number) => {
    try {
      setError(null);

      const targetCategory = categoryLookup.get(targetCategoryId);
      if (!targetCategory) {
        setError(t('errors.targetCategoryNotFound'));
        return;
      }

      const response = await apiClient.put(`/api/transactions/${encodeURIComponent(`${txn.identifier}|${txn.vendor}`)}`, {
        category_definition_id: targetCategoryId,
        category_type: targetCategory.category_type,
        category: targetCategory.name,
        auto_categorized: false,
        confidence_score: 1.0,
      });

      if (!response.ok) {
        const errorPayload = (response.data as any) || {};
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(errorPayload);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(errorPayload?.error || t('errors.moveTransaction'));
      }

      setSuccess(t('notifications.transactionMoved', { category: getLocalizedCategoryName(targetCategory) || targetCategory.name }));
      setTimeout(() => setSuccess(null), 3000);

      // Close the move menu
      setTransactionMoveMenuAnchor(null);
      setTransactionToMove(null);

      // Refresh the transaction list for the source category
      if (movingFromCategory) {
        setExpandedCategoryTransactions(null);
        setTimeout(() => {
          fetchCategoryTransactionsInline(movingFromCategory);
        }, 100);
        setMovingFromCategory(null);
      }
      await fetchCategories();
      queueDataRefresh();
    } catch (error) {
      console.error('Error moving transaction:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.moveTransaction'));
    }
  };

  const toggleCategory = (categoryId: number) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // Handle opening transaction detail modal
  const handleOpenTransactionDetail = (txn: TransactionMatch, category?: CategoryDefinition) => {
    setSelectedTransactionForDetail({
      identifier: txn.identifier,
      vendor: txn.vendor,
      name: txn.name,
      category_name: category?.name || txn.category_name || null,
      parent_name: txn.parent_name || null,
      category_definition_id: category?.id || txn.category_definition_id || null,
      category_type: category?.category_type || txn.category_type || null,
      memo: txn.memo || null,
      tags: txn.tags || [],
      price: txn.price,
      date: txn.date,
      processed_date: null,
      account_number: txn.accountNumber || null,
      type: null,
      status: null,
    });
    setTransactionDetailModalOpen(true);
  };

  const handleTransactionDetailSave = (updatedTransaction: TransactionForModal) => {
    // Update the transaction in categoryTransactionsMap
    setCategoryTransactionsMap(prev => {
      const updated = new Map(prev);
      updated.forEach((transactions, categoryId) => {
        const updatedTransactions = transactions.map(txn =>
          txn.identifier === updatedTransaction.identifier && txn.vendor === updatedTransaction.vendor
            ? { ...txn, memo: updatedTransaction.memo, tags: updatedTransaction.tags }
            : txn
        );
        updated.set(categoryId, updatedTransactions);
      });
      return updated;
    });
  };

  const getCategoryTypeIcon = (type: 'expense' | 'investment' | 'income') => {
    switch (type) {
      case 'expense': return <ExpenseIcon />;
      case 'investment': return <InvestmentIcon />;
      case 'income': return <IncomeIcon />;
    }
  };

  const getCategoryTypeColor = (type: 'expense' | 'investment' | 'income') => {
    switch (type) {
      case 'expense': return 'error';
      case 'investment': return 'success';
      case 'income': return 'primary';
    }
  };

  const HighlightedText = ({ text, highlight }: { text: string, highlight: string }) => {
    if (!highlight.trim()) {
      return <span>{text}</span>;
    }
    const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return (
      <span>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <Box
              component="span"
              key={i}
              sx={{
                color: 'primary.main',
                fontWeight: 'bold',
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                px: 0.25,
                borderRadius: 0.5
              }}
            >
              {part}
            </Box>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  };

  const matchesCategorySearch = useCallback((category: CategoryDefinition, query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return false;

    const lowerQuery = trimmedQuery.toLowerCase();

    const nameMatch = (category.name || '').toLowerCase().includes(lowerQuery);
    const nameEnMatch = (category.name_en || '').toLowerCase().includes(lowerQuery);
    const nameFrMatch = (category.name_fr || '').toLowerCase().includes(lowerQuery);
    const nameHeMatch = (category.name_he || '').toLowerCase().includes(lowerQuery);
    const descMatch = (category.description || '').toLowerCase().includes(lowerQuery);
    const tagMatch = (category.tags || []).some(tag => tag.toLowerCase().includes(lowerQuery));
    const iconMatch = (category.icon || '').toLowerCase().includes(lowerQuery);
    const typeMatch = (category.category_type || '').toLowerCase().includes(lowerQuery);

    const categoryTransactions = categoryTransactionsMap.get(category.id);
    const transactionMatch = categoryTransactions?.some(txn => {
      const name = (txn.name || '').toLowerCase();
      const vendor = (txn.vendor || '').toLowerCase();
      return name.includes(lowerQuery) || vendor.includes(lowerQuery);
    }) || false;

    const remoteTransactionMatch = transactionSearchCategoryIds.has(category.id);

    return (
      nameMatch ||
      nameEnMatch ||
      nameFrMatch ||
      nameHeMatch ||
      descMatch ||
      tagMatch ||
      iconMatch ||
      typeMatch ||
      transactionMatch ||
      remoteTransactionMatch
    );
  }, [categoryTransactionsMap, transactionSearchCategoryIds]);

  const renderCategoryTree = (category: CategoryDefinition, level: number = 0, isSearching: boolean = false, matchingIds: Set<number> = new Set()) => {
    const hasChildren = category.children && category.children.length > 0;
    // Auto-expand if searching and this category or a child matches
    const isExpanded = isSearching ? matchingIds.has(category.id) : expandedCategories.has(category.id);
    const isLeafCategory = !hasChildren && level > 0; // Leaf categories are those without children and not at root level

    const isMatch = isSearching && matchesCategorySearch(category, categorySearchQuery);

    const displayName = getLocalizedCategoryName(category) || category.name;

    // Check if this leaf category has its transactions expanded
    const hasTransactionsExpanded = isLeafCategory && expandedCategoryTransactions === category.id;
    const isLoadingTransactions = loadingCategoryTransactions === category.id;

    // Use cached grouped transactions (already memoized at component level)
    const transactionsByName = hasTransactionsExpanded ? (groupedTransactionsCache.get(category.id) || []) : [];

    const toggleTransactionName = (name: string) => {
      setExpandedTransactionNames(prev => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return next;
      });
    };

    return (
      <React.Fragment key={category.id}>
        <ListItem
          disablePadding
          sx={{
            display: 'block',
            mb: 0.5,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              position: 'relative',
              borderRadius: 2,
              bgcolor: isMatch ? alpha(theme.palette.primary.main, 0.08) : (hasTransactionsExpanded ? alpha(theme.palette.primary.main, 0.04) : 'transparent'),
              transition: 'all 0.2s ease',
              border: '1px solid',
              borderColor: isMatch ? alpha(theme.palette.primary.main, 0.3) : (hasTransactionsExpanded ? alpha(theme.palette.primary.main, 0.2) : 'transparent'),
              '&:hover': {
                bgcolor: alpha(theme.palette.text.primary, 0.04),
                '& .tree-actions': {
                  opacity: 1,
                  visibility: 'visible',
                  transform: 'translateX(0)',
                }
              },
            }}
          >
            {/* Expand/Collapse Button or Spacer */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 40,
                cursor: (hasChildren || (isLeafCategory && category.transaction_count && category.transaction_count > 0)) ? 'pointer' : 'default',
                color: 'text.secondary',
                flexShrink: 0,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) {
                  toggleCategory(category.id);
                } else if (isLeafCategory && category.transaction_count && category.transaction_count > 0) {
                  fetchCategoryTransactionsInline(category);
                }
              }}
            >
              {(hasChildren || (isLeafCategory && category.transaction_count && category.transaction_count > 0)) && (
                <ExpandMoreIcon
                  sx={{
                    transform: (isExpanded || hasTransactionsExpanded) ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.2s ease',
                    fontSize: 20,
                    color: (isExpanded || hasTransactionsExpanded) ? 'primary.main' : 'inherit'
                  }}
                />
              )}
            </Box>

            {/* Main Content Area */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexGrow: 1,
                py: 1,
                pr: 1,
                cursor: (hasChildren || (isLeafCategory && category.transaction_count && category.transaction_count > 0)) ? 'pointer' : 'default',
                minWidth: 0, // Prevent flex overflow
              }}
              onClick={() => {
                if (hasChildren) {
                  toggleCategory(category.id);
                } else if (isLeafCategory && category.transaction_count && category.transaction_count > 0) {
                  fetchCategoryTransactionsInline(category);
                }
              }}
            >
              {/* Icon */}
              <Box sx={{ mr: 1.5, display: 'flex', alignItems: 'center', color: category.color || 'text.secondary' }}>
                {getCategoryIcon(category)}
              </Box>

              {/* Text Content */}
              <Box sx={{ flexGrow: 1, minWidth: 0, mr: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography
                    variant="body2"
                    fontWeight={level === 0 ? 'bold' : 'medium'}
                    noWrap={false}
                    sx={{ lineHeight: 1.2 }}
                  >
                    <HighlightedText text={displayName} highlight={categorySearchQuery} />
                  </Typography>

                  {/* Badges/Chips */}
                  <Box display="flex" gap={0.5} alignItems="center">
                  {category.transaction_count !== undefined && category.transaction_count > 0 && (
                    <Chip
                      label={category.transaction_count}
                      size="small"
                      variant="outlined"
                      sx={{
                        height: 18,
                        minWidth: 18,
                        fontSize: '0.65rem',
                        borderColor: hasTransactionsExpanded ? 'primary.main' : alpha(theme.palette.divider, 0.8),
                        bgcolor: hasTransactionsExpanded ? alpha(theme.palette.primary.main, 0.1) : alpha(theme.palette.background.paper, 0.5),
                        color: hasTransactionsExpanded ? 'primary.main' : 'inherit',
                          '& .MuiChip-label': { px: 0.5 }
                      }}
                    />
                  )}
                  {category.tags && category.tags.length > 0 && (
                      category.tags.slice(0, 2).map((tag, idx) => (
                        <Chip
                          key={idx}
                          label={<HighlightedText text={tag} highlight={categorySearchQuery} />}
                          size="small"
                          color="secondary"
                          variant="outlined"
                          sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 }, opacity: 0.8 }}
                        />
                      ))
                  )}
                  </Box>
                </Box>
                {category.description && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      mt: 0.25,
                      lineHeight: 1.2
                    }}
                  >
                    <HighlightedText text={category.description} highlight={categorySearchQuery} />
                  </Typography>
                )}
              </Box>

              {/* Actions */}
              <Box
                className="tree-actions"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  opacity: 0,
                  visibility: 'hidden',
                  transform: 'translateX(10px)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  bgcolor: theme.palette.background.paper,
                  borderRadius: 16,
                  boxShadow: theme.shadows[2],
                  px: 0.5,
                  py: 0.25,
                  position: 'absolute',
                  right: 8,
                  zIndex: 2,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip title={t('actions.addSubcategory') || 'Add Subcategory'}>
                  <IconButton
                    size="small"
                    onClick={() => {
                      setParentCategoryForCreation(category);
                      setNewCategory({
                        name: '',
                        parent_id: category.id,
                        category_type: category.category_type as CategoryType,
                        description: '',
                        tags: [],
                      });
                      setEditingTags([]);
                      setNewTagInput('');
                      setCreateDialogOpen(true);
                    }}
                    sx={{ color: 'primary.main', p: 0.5 }}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('actions.edit')}>
                  <IconButton
                    size="small"
                    onClick={() => {
                      setEditingCategory(category);
                      setEditingTags(category.tags || []);
                    }}
                    sx={{ color: 'info.main', p: 0.5 }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('actions.delete')}>
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteCategory(category.id)}
                    sx={{ color: 'error.main', p: 0.5 }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Box>
        </ListItem>

        {/* Children Container with Guide Line */}
        {hasChildren && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            <Box
              sx={{
                pl: 2,
                ml: 2, // Indent children
                position: 'relative',
                // Vertical guide line
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 8,
                  width: 2,
                  bgcolor: alpha(theme.palette.divider, 0.5),
                  borderRadius: 1,
                }
              }}
            >
              {category.children!.map(child => renderCategoryTree(child, level + 1, isSearching, matchingIds))}
            </Box>
          </Collapse>
        )}

        {/* Inline Transactions for Leaf Categories */}
        {isLeafCategory && (
          <Collapse in={hasTransactionsExpanded} timeout="auto" unmountOnExit>
            <Box
              sx={{
                pl: 4,
                ml: 2,
                position: 'relative',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 8,
                  width: 2,
                  bgcolor: alpha(category.color || theme.palette.primary.main, 0.3),
                  borderRadius: 1,
                }
              }}
            >
              {isLoadingTransactions ? (
                <Box display="flex" alignItems="center" gap={1} py={2} pl={2}>
                  <CircularProgress size={16} />
                  <Typography variant="caption" color="text.secondary">
                    {t('transactions.loading')}
                  </Typography>
                </Box>
              ) : transactionsByName.length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ py: 2, pl: 2, display: 'block' }}>
                  {t('transactions.none')}
                </Typography>
              ) : (
                <Box sx={{ py: 0.5 }}>
                  {transactionsByName.map(([txnName, txns]) => {
                    const isNameExpanded = expandedTransactionNames.has(txnName);
                    const totalAmount = txns.reduce((sum, t) => sum + t.price, 0);
                    const uniqueKey = `${category.id}-${txnName}`;

                    return (
                      <Box key={uniqueKey} sx={{ mb: 0.5 }}>
                        {/* Transaction Row - Always Collapsible */}
                        <Box
                          onClick={() => toggleTransactionName(txnName)}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            py: 1,
                            px: 1.5,
                            borderRadius: 2,
                            cursor: 'pointer',
                            bgcolor: isNameExpanded 
                              ? alpha(theme.palette.primary.main, 0.08)
                              : alpha(theme.palette.background.paper, 0.4),
                            border: `1px solid ${isNameExpanded 
                              ? alpha(theme.palette.primary.main, 0.2) 
                              : alpha(theme.palette.divider, 0.1)}`,
                            transition: 'all 0.15s ease',
                            '&:hover': {
                              bgcolor: isNameExpanded
                                ? alpha(theme.palette.primary.main, 0.12)
                                : alpha(theme.palette.background.paper, 0.8),
                              borderColor: isNameExpanded
                                ? alpha(theme.palette.primary.main, 0.3)
                                : alpha(theme.palette.divider, 0.3),
                            },
                          }}
                        >
                          {/* Expand Icon */}
                          <Box
                            sx={{
                              width: 20,
                              height: 20,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <ExpandMoreIcon
                              sx={{
                                fontSize: 18,
                                transform: isNameExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                                transition: 'transform 0.2s ease',
                                color: isNameExpanded ? 'primary.main' : 'text.secondary',
                              }}
                            />
                          </Box>

                          {/* Transaction Info */}
                          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography
                              variant="body2"
                              fontWeight={500}
                              noWrap
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                color: 'text.primary',
                              }}
                            >
                              {txnName}
                            </Typography>
                            {/* Count Badge - Always Shown */}
                            <Box
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                px: 0.75,
                                py: 0.25,
                                borderRadius: 1,
                                bgcolor: txns.length > 1 
                                  ? alpha(theme.palette.primary.main, 0.12)
                                  : alpha(theme.palette.text.secondary, 0.1),
                                minWidth: 28,
                              }}
                            >
                              <Typography
                                variant="caption"
                                fontWeight={600}
                                sx={{ 
                                  color: txns.length > 1 ? 'primary.main' : 'text.secondary', 
                                  fontSize: '0.7rem' 
                                }}
                              >
                                {txns.length}x
                              </Typography>
                            </Box>
                          </Box>

                          {/* Amount */}
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              px: 1,
                              py: 0.5,
                              borderRadius: 1.5,
                              bgcolor: totalAmount < 0
                                ? alpha(theme.palette.error.main, 0.08)
                                : alpha(theme.palette.success.main, 0.08),
                            }}
                          >
                            <Typography
                              variant="body2"
                              fontWeight={700}
                              sx={{
                                color: totalAmount < 0 ? 'error.main' : 'success.main',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {formatCurrency(totalAmount)}
                            </Typography>
                          </Box>

                          {/* Actions - Create Rule button */}
                          <Box
                            className="txn-actions"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.25,
                              opacity: 0.7,
                              transition: 'opacity 0.15s ease',
                              '&:hover': {
                                opacity: 1,
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Tooltip title={t('transactions.createRule')}>
                              <IconButton
                                size="small"
                                sx={{
                                  p: 0.5,
                                  color: 'primary.main',
                                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                                  '&:hover': {
                                    color: 'primary.main',
                                    bgcolor: alpha(theme.palette.primary.main, 0.15),
                                    transform: 'scale(1.05)',
                                  },
                                  transition: 'all 0.15s ease',
                                }}
                                onClick={() => handleCreateRuleFromTransaction(txns[0], category)}
                              >
                                <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>

                        {/* Expanded Transaction Details - Always available */}
                        <Collapse in={isNameExpanded} timeout="auto" unmountOnExit>
                          <Box
                            sx={{
                              ml: 3.5,
                              mt: 0.5,
                              pl: 2,
                              borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                            }}
                          >
                            {txns.map((txn, idx) => (
                              <Box
                                key={`${txn.identifier}-${txn.vendor}-${idx}`}
                                onClick={() => handleOpenTransactionDetail(txn, category)}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1.5,
                                  py: 0.75,
                                  px: 1,
                                  mb: 0.25,
                                  borderRadius: 1.5,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                  '&:hover': {
                                    bgcolor: alpha(theme.palette.background.paper, 0.6),
                                    '& .detail-actions': {
                                        opacity: 1,
                                      }
                                    },
                                  }}
                                >
                                  {/* Date */}
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: 'text.secondary',
                                      fontWeight: 500,
                                      minWidth: 75,
                                      fontVariantNumeric: 'tabular-nums',
                                    }}
                                  >
                                    {formatDate(txn.date)}
                                  </Typography>

                                  {/* Vendor */}
                                  <Typography
                                    variant="caption"
                                    noWrap
                                    sx={{
                                      flex: 1,
                                      color: 'text.secondary',
                                      opacity: 0.7,
                                    }}
                                  >
                                    {txn.vendor}
                                  </Typography>

                                  {/* Amount */}
                                  <Typography
                                    variant="caption"
                                    fontWeight={600}
                                    sx={{
                                      color: txn.price < 0 ? 'error.main' : 'success.main',
                                      fontVariantNumeric: 'tabular-nums',
                                      minWidth: 60,
                                      textAlign: 'right',
                                    }}
                                  >
                                    {formatCurrency(txn.price)}
                                  </Typography>

                                  {/* Actions */}
                                  <Box
                                    className="detail-actions"
                                    sx={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 0.25,
                                      opacity: 0,
                                      transition: 'opacity 0.15s ease',
                                    }}
                                  >
                                    <Tooltip title={t('transactions.move')}>
                                      <IconButton
                                        size="small"
                                        sx={{
                                          p: 0.5,
                                          color: 'text.secondary',
                                          '&:hover': { color: 'info.main', bgcolor: alpha(theme.palette.info.main, 0.1) }
                                        }}
                                        onClick={(e) => {
                                          setTransactionToMove(txn);
                                          setMovingFromCategory(category);
                                          setTransactionMoveMenuAnchor(e.currentTarget);
                                        }}
                                      >
                                        <SwapVertIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title={t('transactions.remove')}>
                                      <IconButton
                                        size="small"
                                        sx={{
                                          p: 0.5,
                                          color: 'text.secondary',
                                          '&:hover': { color: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.1) }
                                        }}
                                        onClick={() => handleRemoveTransactionFromCategory(txn, category.id)}
                                      >
                                        <DeleteIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </Box>
                              ))}
                            </Box>
                          </Collapse>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          </Collapse>
        )}
      </React.Fragment>
    );
  };

  // Helper function to sort and group transactions
  const getSortedTransactions = (transactions: UncategorizedTransaction[]): UncategorizedTransaction[] => {
    if (!transactions || transactions.length === 0) return [];

    // Create a copy to avoid mutating the original array
    const txnsCopy = [...transactions];

    if (sortBy === 'name') {
      // Group by transaction name and sort by count (number of similar transactions)
      const grouped = new Map<string, UncategorizedTransaction[]>();
      txnsCopy.forEach(txn => {
        const key = txn.name || 'Unknown';
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(txn);
      });

      // Sort groups by size (descending) and flatten
      const sortedGroups = Array.from(grouped.entries())
        .sort((a, b) => b[1].length - a[1].length);

      return sortedGroups.flatMap(([_, txns]) =>
        txns.sort((a, b) => Math.abs(b.price) - Math.abs(a.price))
      );
    } else if (sortBy === 'amount') {
      // Sort by transaction amount (descending)
      return txnsCopy.sort((a, b) => Math.abs(b.price) - Math.abs(a.price));
    } else {
      // Default: sort by date (most recent first)
      return txnsCopy.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  };

  // Helper function to filter categories by search query (returns matching categories with their children preserved)
  const filterCategoriesBySearch = useCallback((cats: CategoryDefinition[], query: string): CategoryDefinition[] => {
    if (!query.trim()) return cats;

    const categoryMatches = (cat: CategoryDefinition): boolean => matchesCategorySearch(cat, query);
    
    const filterRecursive = (categories: CategoryDefinition[]): CategoryDefinition[] => {
      return categories.reduce((acc: CategoryDefinition[], cat) => {
        const filteredChildren = cat.children ? filterRecursive(cat.children) : [];
        const hasMatchingChildren = filteredChildren.length > 0;
        const selfMatches = categoryMatches(cat);
        
        if (selfMatches || hasMatchingChildren) {
          acc.push({
            ...cat,
            children: selfMatches && cat.children ? cat.children : filteredChildren,
          });
        }
        return acc;
      }, []);
    };
    
    return filterRecursive(cats);
  }, [matchesCategorySearch]);

  // Get IDs of categories that match search (to auto-expand parents)
  const getMatchingCategoryIds = useCallback((cats: CategoryDefinition[], query: string): Set<number> => {
    if (!query.trim()) return new Set();
    const matchingIds = new Set<number>();

    const categoryMatches = (cat: CategoryDefinition): boolean => {
      return matchesCategorySearch(cat, query);
    };

    const collectMatchingIds = (categories: CategoryDefinition[], parentIds: number[] = []) => {
      categories.forEach(cat => {
        const selfMatches = categoryMatches(cat);
        if (selfMatches) {
          matchingIds.add(cat.id);
          parentIds.forEach(id => matchingIds.add(id));
        }
        if (cat.children) {
          collectMatchingIds(cat.children, [...parentIds, cat.id]);
        }
      });
    };

    collectMatchingIds(cats);
    return matchingIds;
  }, [matchesCategorySearch]);

  const renderCategorizationTab = () => {
    const allUncategorizedTxns = uncategorized?.recentTransactions ?? [];
    const sortedTransactions = getSortedTransactions(allUncategorizedTxns);
    const uncategorizedPreview = sortedTransactions.slice(0, 10);

    return (
      <Box>
        {uncategorized && (
          <Paper
            sx={(theme) => ({
              p: 3,
              mb: 3,
              background: theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, rgba(30, 30, 30, 0.95) 0%, rgba(30, 30, 30, 0.85) 100%)'
                : 'linear-gradient(135deg, rgba(200, 250, 207, 0.08) 0%, rgba(250, 207, 200, 0.08) 100%)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 3,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 4px 20px rgba(0, 0, 0, 0.4)'
                : '0 4px 20px rgba(0, 0, 0, 0.08)',
            })}
          >
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
              <Box display="flex" alignItems="center" gap={2} flex={1}>
                <CategoryIcon sx={{ fontSize: 40, color: '#c8facf' }} />
                <Box flex={1}>
                  <Typography variant="h5" fontWeight="bold" gutterBottom sx={{ mb: 0 }}>
                    {t('summary.title')}
                  </Typography>
                  {uncategorized.totalCount === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('summary.allDone')}
                    </Typography>
                  ) : (
                    <Box>
                      <Typography variant="body1" color="text.primary">
                        {t('summary.pendingCount', {
                          count: uncategorized.totalCount,
                          countDisplay: uncategorized.totalCount.toLocaleString(),
                        })}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {t('summary.totalPending', { amount: formatCurrency(uncategorized.totalAmount) })}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
              <Box display="flex" alignItems="center" gap={1}>
                {uncategorized.totalCount > 0 && (
                  <>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel>{t('sort.label')}</InputLabel>
                      <Select
                        value={sortBy}
                        label={t('sort.label')}
                        onChange={(e) => setSortBy(e.target.value as 'name' | 'amount' | 'date')}
                        startAdornment={<SortIcon sx={{ mr: 1, color: 'text.secondary' }} />}
                      >
                        <MenuItem value="date">{t('sort.date')}</MenuItem>
                        <MenuItem value="name">{t('sort.name')}</MenuItem>
                        <MenuItem value="amount">{t('sort.amount')}</MenuItem>
                      </Select>
                    </FormControl>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={handleApplyRules}
                      disabled={isApplyingRules}
                      startIcon={isApplyingRules ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                      sx={(theme) => ({
                        borderColor: theme.palette.primary.main,
                        color: theme.palette.primary.main,
                        fontWeight: 600,
                        '&:hover': {
                          borderColor: theme.palette.primary.dark,
                          backgroundColor: `${theme.palette.primary.main}20`,
                        },
                      })}
                    >
                      {isApplyingRules ? t('actions.applyingRules') : t('actions.applyRules')}
                    </Button>
                  </>
                )}
              </Box>
            </Box>

            {/* Progress Bar */}
            {(uncategorized && uncategorized.totalCount >= 0) && (
              <>
                <Box sx={{ mb: 3, mt: 2 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="body2" fontWeight="medium">
                      {t('summary.progress')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {(() => {
                        // Helper to check if a category is a leaf (has no children)
                        const isLeafCategory = (cat: CategoryDefinition): boolean => {
                          return !cat.children || cat.children.length === 0;
                        };

                        // Recursively collect all leaf categories
                        const collectLeafCategories = (cats: CategoryDefinition[]): CategoryDefinition[] => {
                          const leaves: CategoryDefinition[] = [];
                          cats.forEach(cat => {
                            if (isLeafCategory(cat)) {
                              leaves.push(cat);
                            }
                            if (cat.children && cat.children.length > 0) {
                              leaves.push(...collectLeafCategories(cat.children));
                            }
                          });
                          return leaves;
                        };

                        // Get all leaf categories and sum their transaction counts
                        const leafCategories = collectLeafCategories(categories);
                        const assignedToLeaf = leafCategories.reduce((sum, cat) => sum + (cat.transaction_count || 0), 0);

                        // Transactions NOT assigned to terminal categories (from backend)
                        const notAssignedToLeaf = uncategorized.totalCount;

                        // Total unique transactions in database
                        const total = assignedToLeaf + notAssignedToLeaf;

                        const percentage = total > 0
                          ? Math.round((assignedToLeaf / total) * 100)
                          : 0;
                        return t('helpers.progressDetail', {
                          assigned: assignedToLeaf.toLocaleString(),
                          missing: notAssignedToLeaf.toLocaleString(),
                          percent: percentage,
                        });
                      })()}
                    </Typography>
                  </Box>
                  <Box sx={{ position: 'relative', height: 24, borderRadius: 2, overflow: 'hidden', bgcolor: 'grey.200' }}>
                    {(() => {
                      // Helper to check if a category is a leaf (has no children)
                      const isLeafCategory = (cat: CategoryDefinition): boolean => {
                        return !cat.children || cat.children.length === 0;
                      };

                      // Recursively collect all leaf categories
                      const collectLeafCategories = (cats: CategoryDefinition[]): CategoryDefinition[] => {
                        const leaves: CategoryDefinition[] = [];
                        cats.forEach(cat => {
                          if (isLeafCategory(cat)) {
                            leaves.push(cat);
                          }
                          if (cat.children && cat.children.length > 0) {
                            leaves.push(...collectLeafCategories(cat.children));
                          }
                        });
                        return leaves;
                      };

                      // Get all leaf categories and sum their transaction counts
                      const leafCategories = collectLeafCategories(categories);
                      const assignedToLeaf = leafCategories.reduce((sum, cat) => sum + (cat.transaction_count || 0), 0);

                      // Transactions NOT assigned to terminal categories
                      const notAssignedToLeaf = uncategorized.totalCount;

                      // Total unique transactions
                      const total = assignedToLeaf + notAssignedToLeaf;

                      const assignedPercent = total > 0 ? (assignedToLeaf / total) * 100 : 0;
                      const missingPercent = total > 0 ? (notAssignedToLeaf / total) * 100 : 0;

                      return (
                        <>
                          {/* Green bar for assigned */}
                          {assignedPercent > 0 && (
                            <Box
                              sx={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${assignedPercent}%`,
                                bgcolor: '#66bb6a',
                                transition: 'width 0.3s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {assignedPercent > 15 && (
                                <Typography variant="caption" sx={{ color: 'white', fontWeight: 'bold' }}>
                                  {t('helpers.complete', { count: assignedToLeaf })}
                                </Typography>
                              )}
                            </Box>
                          )}
                          {/* Red bar for missing */}
                          {missingPercent > 0 && (
                            <Box
                              sx={{
                                position: 'absolute',
                                left: `${assignedPercent}%`,
                                top: 0,
                                bottom: 0,
                                width: `${missingPercent}%`,
                                bgcolor: '#ef5350',
                                transition: 'width 0.3s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {missingPercent > 15 && (
                                <Typography variant="caption" sx={{ color: 'white', fontWeight: 'bold' }}>
                                  {t('summary.incomplete', {
                                    count: notAssignedToLeaf,
                                    formattedCount: notAssignedToLeaf.toLocaleString(),
                                  })}
                            </Typography>
                              )}
                            </Box>
                          )}
                        </>
                      );
                    })()}
                  </Box>
                  <Box display="flex" gap={2} mt={1} justifyContent="flex-start">
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#66bb6a' }} />
                      <Typography variant="caption" color="text.secondary">
                        {t('legend.assignedTerminal')}
                      </Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#ef5350' }} />
                      <Typography variant="caption" color="text.secondary">
                        {t('legend.notAssignedTerminal')}
                      </Typography>
                  </Box>
                  </Box>
                </Box>
              </>
            )}

            {uncategorized.totalCount > 0 && (
              <>
                <List dense sx={{ pt: 1, mt: 2 }}>
                  {uncategorizedPreview.map((txn: UncategorizedTransaction) => {
                    const key = getTransactionKey(txn);
                    const draft = assignmentDrafts[key];
                    // Show ALL category types in the first dropdown
                    const rootOptions = [
                      ...categoryRootsByType.expense,
                      ...categoryRootsByType.investment,
                      ...categoryRootsByType.income,
                    ];
                    const isSaving = Boolean(savingAssignments[key]);

                    // Count similar transactions (same name) for grouping indicator
                    const similarCount = sortBy === 'name'
                      ? allUncategorizedTxns.filter(t => t.name === txn.name).length
                      : 0;

                    // Determine card styling based on category type and status
                    const hasExistingCategory = Boolean(txn.categoryDefinitionId);
                    const existingCategory = txn.categoryDefinitionId
                      ? categoryLookup.get(txn.categoryDefinitionId)
                      : null;
                    const existingCategoryName = hasExistingCategory
                      ? getLocalizedCategoryName(existingCategory || {
                        name: txn.categoryName,
                        name_en: txn.categoryNameEn || undefined,
                        name_fr: txn.categoryNameFr || undefined,
                      })
                      : '';

                    // Get the selected category's color (use the deepest selected category)
                    const selectedCategoryId = draft?.categoryPath?.[draft.categoryPath.length - 1];
                    const selectedCategory = selectedCategoryId ? categoryLookup.get(selectedCategoryId) : null;

                    // Fallback colors based on type
                    const categoryTypeColor = draft?.type === 'expense'
                      ? '#ef5350'
                      : draft?.type === 'investment'
                      ? '#66bb6a'
                      : '#42a5f5';

                    // Priority: selected category color > existing transaction color > type color
                    const borderColor = selectedCategory?.color || txn.categoryColor || categoryTypeColor;

                    return (
                      <ListItem
                        key={`${txn.identifier}-${txn.vendor}-${txn.date}`}
                        alignItems="flex-start"
                        sx={(theme) => ({
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: 1.5,
                          borderLeft: (hasExistingCategory || draft?.categoryPath?.length > 0)
                            ? `3px solid ${borderColor}`
                            : `2px dashed ${theme.palette.divider}`,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          mb: 2,
                          py: 2,
                          px: 2.5,
                          background: hasExistingCategory
                            ? (theme.palette.mode === 'dark'
                              ? 'rgba(30, 30, 30, 0.5)'
                              : 'rgba(255, 255, 255, 0.98)')
                            : theme.palette.background.paper,
                          boxShadow: theme.palette.mode === 'dark'
                            ? '0 1px 3px rgba(0,0,0,0.2)'
                            : '0 1px 3px rgba(0,0,0,0.05)',
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            boxShadow: theme.palette.mode === 'dark'
                              ? '0 4px 12px rgba(0,0,0,0.4)'
                              : '0 4px 12px rgba(0,0,0,0.1)',
                            transform: 'translateY(-2px)',
                          },
                        })}
                      >
                        <Box display="flex" justifyContent="space-between" width="100%" alignItems="flex-start">
                          <Box flex={1}>
                            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                              <Typography variant="h6" fontWeight="600" sx={{ fontSize: '1.1rem' }}>
                                {txn.name || t('transactions.unknown')}
                              </Typography>
                              {similarCount > 1 && (
                                <Chip
                                  label={t('uncategorized.similar', { count: similarCount })}
                                  size="small"
                                  color="info"
                                  variant="outlined"
                                  sx={{
                                    fontWeight: 600,
                                    borderWidth: 2,
                                    '& .MuiChip-label': {
                                      px: 1,
                                    },
                                  }}
                                />
                              )}
                              {hasExistingCategory && (existingCategoryName || txn.categoryName) && (
                                <Chip
                                  icon={getCategoryIcon({ icon: txn.categoryIcon, color: txn.categoryColor } as any)}
                                  label={existingCategoryName || txn.categoryName || t('rulesList.unknownCategory')}
                                  size="small"
                                  sx={{
                                    backgroundColor: txn.categoryColor ? `${txn.categoryColor}20` : 'rgba(0,0,0,0.08)',
                                    color: txn.categoryColor || 'text.primary',
                                    fontWeight: 500,
                                    borderLeft: `3px solid ${txn.categoryColor || '#999'}`,
                                  }}
                                />
                              )}
                              {hasExistingCategory && (
                                <Chip
                                  label={t('uncategorized.needsRefinement')}
                                  size="small"
                                  color="warning"
                                  variant="outlined"
                                  sx={{ fontWeight: 500 }}
                                />
                              )}
                            </Box>
                            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                              <Chip
                                label={txn.vendor || t('transactions.unknownVendor')}
                                size="small"
                                variant="outlined"
                                sx={{ fontWeight: 500 }}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(txn.date)}
                              </Typography>
                              {txn.accountNumber && (
                                <Typography variant="caption" color="text.secondary">
                                  • ****{txn.accountNumber}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                          <Box textAlign="right">
                            <Typography
                              variant="h6"
                              fontWeight="bold"
                              sx={{
                                fontSize: '1.25rem',
                                color: txn.price < 0 ? '#ef5350' : '#66bb6a',
                              }}
                            >
                              {formatCurrency(txn.price)}
                            </Typography>
                          </Box>
                        </Box>

                        {/* Status helper text */}
                            {hasExistingCategory && (
                              <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
                                <Typography variant="caption">
                                  {t('uncategorized.parentAssigned')}
                                </Typography>
                              </Alert>
                            )}

                        <Grid container spacing={1.5} alignItems="center">
                          {renderCategorySelectors(key, draft, rootOptions)}
                          <Grid size={{ xs: 12, md: 4 }}>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Button
                                fullWidth
                                variant="contained"
                                size="small"
                                onClick={() => handleSaveAssignment(txn)}
                                disabled={!draft?.categoryPath?.length || isSaving}
                                startIcon={isSaving ? <CircularProgress color="inherit" size={16} /> : undefined}
                                sx={(theme) => ({
                                  textTransform: 'none',
                                  fontWeight: 600,
                                  transition: 'all 0.3s ease',
                                  backgroundColor: draft?.categoryPath?.length
                                    ? theme.palette.primary.main
                                    : undefined,
                                  '&:hover': {
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                                  },
                                })}
                              >
                                {isSaving ? t('uncategorized.assign.saving') : t('uncategorized.assign.cta')}
                              </Button>
                              <Button
                                fullWidth
                                variant="outlined"
                                size="small"
                                onClick={() => handleAutoAssignSimilar(txn)}
                                disabled={!draft?.categoryPath?.length || creatingRules[key]}
                                startIcon={creatingRules[key] ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 600,
                                  transition: 'all 0.3s ease',
                                  '&:hover': {
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                                  },
                                }}
                              >
                                {creatingRules[key] ? t('uncategorized.createRule.saving') : t('uncategorized.createRule.cta')}
                              </Button>
                            </Box>
                          </Grid>
                        </Grid>
                      </ListItem>
                    );
                  })}
                </List>
                {uncategorized.totalCount > uncategorizedPreview.length && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    {t('uncategorized.showingLatest', {
                      previewCount: uncategorizedPreview.length,
                      total: uncategorized.totalCount.toLocaleString(),
                    })}
                  </Typography>
                )}
              </>
            )}
          </Paper>
        )}
      </Box>
    );
  };

  const renderCategoryTreeTab = () => {
    // Apply search filter
    const filteredCategories = filterCategoriesBySearch(categories, categorySearchQuery);
    
    // Auto-expand sections and categories when searching
    const hasSearchQuery = categorySearchQuery.trim().length > 0;
    const matchingIds = getMatchingCategoryIds(categories, categorySearchQuery);

    // Get type color for root categories
    const getTypeColor = (type: string) => {
      switch (type) {
        case 'expense': return '#ef5350';
        case 'investment': return '#66bb6a';
        case 'income': return '#42a5f5';
        default: return theme.palette.text.secondary;
      }
    };

    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Sticky Header with Search */}
        <Box sx={{ mb: 2, position: 'sticky', top: 0, zIndex: 10, bgcolor: theme.palette.background.paper, pt: 1, pb: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            fullWidth
            placeholder={t('search.categoryPlaceholder')}
            value={categorySearchQuery}
            onChange={(e) => setCategorySearchQuery(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: 22 }} />,
              endAdornment: categorySearchQuery && (
                <IconButton
                  size="small"
                  onClick={() => setCategorySearchQuery('')}
                  sx={{ ml: 1, bgcolor: alpha(theme.palette.text.primary, 0.05) }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
              sx: {
                borderRadius: 3,
                bgcolor: alpha(theme.palette.background.default, 0.6),
                '&.Mui-focused': {
                  bgcolor: theme.palette.background.paper,
                  boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.1)}`,
                },
                transition: 'all 0.2s ease',
                pl: 2
              }
            }}
            variant="outlined"
            sx={{
              '& .MuiOutlinedInput-notchedOutline': {
                border: 'none',
              },
            }}
            helperText={!hasSearchQuery ? t('search.searchHint') : undefined}
            FormHelperTextProps={{
              sx: { ml: 2, mt: 0.5, opacity: 0.7 }
            }}
          />

          {/* Search Results Info */}
          {hasSearchQuery && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 1, mt: 1 }}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary">
                {t('search.resultsFound', {
                  count: filteredCategories.length,
                  query: categorySearchQuery
                })}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Category Tree Content */}
        {loading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Paper
            elevation={0}
            sx={{
              flexGrow: 1,
              overflow: 'hidden',
              borderRadius: 4,
              border: `1px solid ${theme.palette.divider}`,
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Legend Header */}
            <Box
              sx={{
                display: 'flex',
                gap: 3,
                px: 2,
                py: 1.5,
                borderBottom: `1px solid ${theme.palette.divider}`,
                bgcolor: alpha(theme.palette.background.default, 0.5),
              }}
            >
              <Box display="flex" alignItems="center" gap={0.75}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#ef5350' }} />
                <Typography variant="caption" color="text.secondary" fontWeight={500}>{t('sections.expense')}</Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={0.75}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#66bb6a' }} />
                <Typography variant="caption" color="text.secondary" fontWeight={500}>{t('sections.investment')}</Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={0.75}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#42a5f5' }} />
                <Typography variant="caption" color="text.secondary" fontWeight={500}>{t('sections.income')}</Typography>
              </Box>
            </Box>

            {/* Unified Tree */}
            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1.5 }}>
              {filteredCategories.length === 0 ? (
                <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" py={6} sx={{ opacity: 0.5 }}>
                  <CategoryIcon sx={{ fontSize: 48, mb: 2, color: 'text.secondary' }} />
                  <Typography variant="body1" color="text.secondary">
                    {t('search.noResults')}
                  </Typography>
                </Box>
              ) : (
                <List dense sx={{ pt: 0 }}>
                  {filteredCategories.map((category) => {
                    const typeColor = getTypeColor(category.category_type);
                    return (
                      <Box
                        key={category.id}
                        sx={{
                          position: 'relative',
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            left: 0,
                            top: 8,
                            bottom: 8,
                            width: 3,
                            bgcolor: typeColor,
                            borderRadius: 1,
                          },
                          pl: 1.5,
                          mb: 0.5,
                        }}
                      >
                        {renderCategoryTree(category, 0, hasSearchQuery, matchingIds)}
                      </Box>
                    );
                  })}
                </List>
              )}
            </Box>
          </Paper>
        )}

        {/* Edit Category Dialog */}
        {editingCategory && (
          <Dialog open={true} onClose={() => { setEditingCategory(null); setEditingTags([]); setNewTagInput(''); }} maxWidth="sm" fullWidth>
            <DialogTitle>{t('editDialog.title')}</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label={t('editDialog.fields.name')}
                    value={editingCategory.name}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label={t('editDialog.fields.notes')}
                    value={editingCategory.description || ''}
                    onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                    multiline
                    rows={3}
                    placeholder={t('editDialog.fields.notesPlaceholder')}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('editDialog.fields.tags')}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                    {(editingCategory.tags || []).map((tag, idx) => (
                      <Chip
                        key={idx}
                        label={tag}
                        size="small"
                        onDelete={() => {
                          const newTags = [...(editingCategory.tags || [])];
                          newTags.splice(idx, 1);
                          setEditingCategory({ ...editingCategory, tags: newTags });
                        }}
                        color="primary"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder={t('editDialog.fields.addTagPlaceholder')}
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTagInput.trim()) {
                        e.preventDefault();
                        const currentTags = editingCategory.tags || [];
                        if (!currentTags.includes(newTagInput.trim())) {
                          setEditingCategory({ ...editingCategory, tags: [...currentTags, newTagInput.trim()] });
                        }
                        setNewTagInput('');
                      }
                    }}
                    InputProps={{
                      endAdornment: newTagInput.trim() && (
                        <IconButton
                          size="small"
                          onClick={() => {
                            const currentTags = editingCategory.tags || [];
                            if (!currentTags.includes(newTagInput.trim())) {
                              setEditingCategory({ ...editingCategory, tags: [...currentTags, newTagInput.trim()] });
                            }
                            setNewTagInput('');
                          }}
                        >
                          <AddIcon fontSize="small" />
                        </IconButton>
                      ),
                    }}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!editingCategory.is_active}
                        onChange={(e) => setEditingCategory({ ...editingCategory, is_active: e.target.checked })}
                      />
                    }
                    label={t('editDialog.fields.active')}
                  />
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setEditingCategory(null); setEditingTags([]); setNewTagInput(''); }}>{t('actions.cancel')}</Button>
              <Button variant="contained" onClick={() => handleUpdateCategory(editingCategory)}>
                {t('actions.save')}
              </Button>
            </DialogActions>
          </Dialog>
        )}

        {/* Re-categorize by Rule Dialog */}
        {recategorizeDialogOpen && recategorizeTransaction && (
          <Dialog
            open={recategorizeDialogOpen}
            onClose={handleCloseRecategorizeDialog}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle sx={{ pb: 1 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <AutoAwesomeIcon sx={{ color: 'primary.main' }} />
                <Typography variant="h6" component="span">
                  {t('recategorize.title', 'Re-categorize by Rule')}
                </Typography>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ pt: 1 }}>
                {/* Transaction Name Display */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {t('recategorize.transactionName', 'Transaction name')}
                  </Typography>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      bgcolor: alpha(theme.palette.background.default, 0.5),
                    }}
                  >
                    <Typography variant="body1" fontWeight={500}>
                      {recategorizeTransaction.name}
                    </Typography>
                  </Paper>
                </Box>

                {/* Category Type Selector */}
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>{t('recategorize.categoryType', 'Category type')}</InputLabel>
                  <Select
                    value={recategorizeCategoryType}
                    label={t('recategorize.categoryType', 'Category type')}
                    onChange={(e) => {
                      setRecategorizeCategoryType(e.target.value as CategoryType);
                      setRecategorizeTargetCategoryId(null);
                    }}
                  >
                    <MenuItem value="expense">
                      <Box display="flex" alignItems="center" gap={1}>
                        <ExpenseIcon sx={{ fontSize: 20, color: '#ef5350' }} />
                        {t('types.expense', 'Expense')}
                      </Box>
                    </MenuItem>
                    <MenuItem value="investment">
                      <Box display="flex" alignItems="center" gap={1}>
                        <InvestmentIcon sx={{ fontSize: 20, color: '#66bb6a' }} />
                        {t('types.investment', 'Investment')}
                      </Box>
                    </MenuItem>
                    <MenuItem value="income">
                      <Box display="flex" alignItems="center" gap={1}>
                        <IncomeIcon sx={{ fontSize: 20, color: '#42a5f5' }} />
                        {t('types.income', 'Income')}
                      </Box>
                    </MenuItem>
                  </Select>
                </FormControl>

                {/* Category Selector */}
                <FormControl fullWidth>
                  <InputLabel>{t('recategorize.assignToCategory', 'Assign to category')}</InputLabel>
                  <Select
                    value={recategorizeTargetCategoryId ?? ''}
                    label={t('recategorize.assignToCategory', 'Assign to category')}
                    onChange={(e) => {
                      const value = e.target.value as string | number;
                      setRecategorizeTargetCategoryId(value === '' ? null : Number(value));
                    }}
                    MenuProps={{
                      PaperProps: {
                        style: { maxHeight: 350 },
                      },
                    }}
                  >
                    <MenuItem value="">
                      <em>{t('recategorize.selectCategory', 'Select a category...')}</em>
                    </MenuItem>
                    {(() => {
                      const filteredCategories = categories.filter(
                        (cat) => cat.category_type === recategorizeCategoryType
                      );
                      const items: React.ReactElement[] = [];

                      const renderOptions = (cats: CategoryDefinition[], depth: number = 0) => {
                        cats.forEach((cat) => {
                          items.push(
                            <MenuItem
                              key={cat.id}
                              value={cat.id}
                              sx={{ pl: 2 + depth * 2 }}
                            >
                              <Box display="flex" alignItems="center" gap={1}>
                                {getCategoryIcon(cat)}
                                <Typography
                                  sx={{
                                    fontWeight: depth === 0 ? 600 : 400,
                                  }}
                                >
                                  {getLocalizedCategoryName(cat) || cat.name}
                                </Typography>
                              </Box>
                            </MenuItem>
                          );
                          if (cat.children && cat.children.length > 0) {
                            renderOptions(cat.children, depth + 1);
                          }
                        });
                      };

                      renderOptions(filteredCategories);
                      return items;
                    })()}
                  </Select>
                </FormControl>

                {/* Helper text */}
                <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                  {t('recategorize.helperText', 'This will create a rule that automatically categorizes all transactions with this name.')}
                </Typography>
              </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={handleCloseRecategorizeDialog} disabled={isCreatingRecategorizeRule}>
                {t('actions.cancel')}
              </Button>
              <Button
                variant="contained"
                onClick={handleConfirmRecategorize}
                disabled={!recategorizeTargetCategoryId || isCreatingRecategorizeRule}
                startIcon={isCreatingRecategorizeRule ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
              >
                {isCreatingRecategorizeRule
                  ? t('recategorize.creating', 'Creating...')
                  : t('recategorize.createRule', 'Create Rule')}
              </Button>
            </DialogActions>
          </Dialog>
        )}

        {/* Move to Category Menu */}
        {transactionToMove && (
          <Menu
            anchorEl={transactionMoveMenuAnchor}
            open={Boolean(transactionMoveMenuAnchor)}
            onClose={() => {
              setTransactionMoveMenuAnchor(null);
              setTransactionToMove(null);
            }}
            PaperProps={{
              style: {
                maxHeight: 400,
                width: '300px',
              },
            }}
          >
            <MenuItem disabled>
              <Typography variant="caption" fontWeight="bold">
                {t('labels.targetCategory')}
              </Typography>
            </MenuItem>
            <Divider />
            {categories.map((rootCategory) => {
              const renderCategoryMenuItem = (cat: CategoryDefinition, depth: number = 0): React.ReactElement[] => {
                const items: React.ReactElement[] = [];

                // Only show leaf categories (those without children) as options
                if (!cat.children || cat.children.length === 0) {
                  if (depth > 0) { // Don't show root categories as targets
                    const primaryName = getLocalizedCategoryName(cat) || cat.name;
                    const secondaryName = [cat.name_fr, cat.name_en, cat.name].find(
                      name => name && name !== primaryName
                    );
                    items.push(
                      <MenuItem
                        key={cat.id}
                        onClick={() => handleMoveTransactionToCategory(transactionToMove, cat.id)}
                        sx={{ pl: depth * 2 + 2 }}
                      >
                        <ListItemIcon>
                          {getCategoryIcon(cat)}
                        </ListItemIcon>
                        <ListItemText
                          primary={primaryName}
                          secondary={secondaryName}
                        />
                      </MenuItem>
                    );
                  }
                }

                // Recursively render children
                if (cat.children && cat.children.length > 0) {
                  cat.children.forEach(child => {
                    items.push(...renderCategoryMenuItem(child, depth + 1));
                  });
                }

                return items;
              };

              return renderCategoryMenuItem(rootCategory);
            })}
          </Menu>
        )}
      </Box>
    );
  };

  const renderPatternRulesTab = () => {
    const parentOptions = categoryRootsByType[newRuleType];
    const parentDefinition = newRuleParentId ? categoryLookup.get(newRuleParentId) : undefined;
    const childOptions = parentDefinition?.children ?? [];
    const subcategoryValue = newRuleCategoryId ?? '';
    const filteredRules = rules.filter(rule => {
      if (!ruleSearchQuery.trim()) return true;
      const query = ruleSearchQuery.toLowerCase();
      const patternMatch = rule.name_pattern?.toLowerCase().includes(query);
      const categoryMatch = (rule.category_name || rule.target_category || rule.parent_category || rule.subcategory || '')?.toLowerCase().includes(query);
      return patternMatch || categoryMatch;
    });

    return (
      <Box>
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            {t('rulesForm.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('rulesForm.description')}
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label={t('rulesForm.fields.pattern')}
                value={newRule.name_pattern || ''}
                onChange={(e) => setNewRule({ ...newRule, name_pattern: e.target.value })}
                placeholder={t('rulesForm.fields.patternPlaceholder')}
                size="small"
                helperText={
                  newRulePreview
                    ? t('rulesForm.fields.patternPreview', { count: newRulePreview.totalCount })
                    : t('rulesForm.fields.patternHelper')
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('rulesForm.fields.type')}</InputLabel>
                <Select
                  value={newRuleType}
                  label={t('rulesForm.fields.type')}
                  onChange={(e) => {
                    setNewRuleType(e.target.value as CategoryType);
                    setNewRuleParentId(null);
                    setNewRuleCategoryId(null);
                  }}
                >
                  <MenuItem value="expense">{t('rulesForm.typeOptions.expense')}</MenuItem>
                  <MenuItem value="investment">{t('rulesForm.typeOptions.investment')}</MenuItem>
                  <MenuItem value="income">{t('rulesForm.typeOptions.income')}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('rulesForm.fields.category')}</InputLabel>
                <Select
                  value={newRuleParentId ?? ''}
                  label={t('rulesForm.fields.category')}
                  onChange={(e) => {
                    const value = e.target.value as string | number;
                    setNewRuleParentId(value === '' ? null : Number(value));
                    setNewRuleCategoryId(null);
                  }}
                >
                  <MenuItem value="">{t('rulesForm.fields.selectCategory')}</MenuItem>
                  {parentOptions.map((parent: CategoryDefinition) => (
                    <MenuItem key={parent.id} value={parent.id}>
                      {getLocalizedCategoryName(parent) || parent.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 2 }}>
              <FormControl fullWidth size="small" disabled={!newRuleParentId || childOptions.length === 0}>
                <InputLabel>{t('rulesForm.fields.subcategory')}</InputLabel>
                <Select
                  value={subcategoryValue}
                  label={t('rulesForm.fields.subcategory')}
                  onChange={(e) => {
                    const value = e.target.value as string | number;
                    setNewRuleCategoryId(value === '' ? null : Number(value));
                  }}
                  displayEmpty
                >
                  <MenuItem value="">{t('rulesForm.fields.none')}</MenuItem>
                  {childOptions.map((child: CategoryDefinition) => (
                    <MenuItem key={child.id} value={child.id}>
                      {getLocalizedCategoryName(child) || child.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 1 }}>
              <Button
                fullWidth
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleCreateRule}
                disabled={loading || !newRule.name_pattern || !newRuleParentId}
                sx={{ height: '40px' }}
              >
                {t('rulesForm.actions.add')}
              </Button>
            </Grid>
          </Grid>

          {/* New Rule Preview */}
          {newRulePreview && newRulePreview.totalCount > 0 && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="info" sx={{ mb: 1 }}>
                <Typography variant="body2" fontWeight="bold" gutterBottom>
                  {t('rulesForm.preview.title', { count: newRulePreview.totalCount })}
                </Typography>
                <Box sx={{ maxHeight: 200, overflowY: 'auto', mt: 1 }}>
                  {newRulePreview.matchedTransactions.slice(0, 5).map((txn, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        py: 0.5,
                        borderBottom: idx < 4 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                      }}
                      >
                        <Typography variant="caption" sx={{ flex: 1 }}>
                          {new Date(txn.date).toLocaleDateString()} - {txn.name}
                        </Typography>
                        <Typography variant="caption" fontWeight="bold">
                        ₪{Math.abs(txn.price).toFixed(2)}
                      </Typography>
                    </Box>
                  ))}
                  {newRulePreview.totalCount > 5 && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      {t('rulesForm.preview.more', { count: newRulePreview.totalCount - 5 })}
                    </Typography>
                  )}
                </Box>
              </Alert>
            </Box>
          )}

          <Box sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              startIcon={isApplyingRules ? <CircularProgress size={20} /> : <PlayArrowIcon />}
              onClick={handleApplyRules}
              disabled={isApplyingRules || rules.length === 0}
            >
              {t('rulesForm.actions.applyToExisting')}
            </Button>
          </Box>
        </Paper>

        {/* Rules List */}
        <Box sx={{ mb: 2 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Typography variant="subtitle1" fontWeight="bold">
              {ruleSearchQuery.trim()
                ? t('rulesList.titleFiltered', { visible: filteredRules.length, total: rules.length })
                : t('rulesList.title', { count: rules.length })}
            </Typography>
          </Box>
          <TextField
            fullWidth
            size="small"
            placeholder={t('rulesList.searchPlaceholder')}
            value={ruleSearchQuery}
            onChange={(e) => setRuleSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
              endAdornment: ruleSearchQuery && (
                <IconButton
                  size="small"
                  onClick={() => setRuleSearchQuery('')}
                  sx={{ ml: 1 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
            }}
            sx={{ mb: 2 }}
          />
        </Box>
        {rules.length === 0 ? (
          <Alert severity="info">
            {t('rulesList.empty')}
          </Alert>
        ) : (
          <Grid container spacing={2}>
            {filteredRules.map(rule => {
              const transactionCount = ruleTransactionCounts.get(rule.id) || 0;
              const isExpanded = expandedRuleId === rule.id;
              const previewData = rulePreviewData.get(rule.id);

              // Get category details for display
              const ruleCategory = rule.category_definition_id ? categoryLookup.get(rule.category_definition_id) : null;
              const categoryDisplayName = getLocalizedCategoryName(ruleCategory || {
                name: rule.category_name || rule.target_category || rule.parent_category || '',
                name_en: rule.category_name_en,
                name_fr: rule.category_name_fr,
                name_he: rule.category_name_he,
              }) || t('rulesList.unknownCategory');
              const subcategoryDisplay = rule.subcategory ? getLocalizedCategoryName({ name: rule.subcategory }) : '';
              const categoryDisplayIcon = ruleCategory ? getCategoryIcon(ruleCategory) : null;
              const categoryDisplayColor = ruleCategory?.color;

              return (
                <Grid size={{ xs: 12 }} key={rule.id}>
                  <Card variant="outlined">
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box display="flex" alignItems="center" justifyContent="space-between">
                        <Box flex={1}>
                      <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                        <Typography variant="body2" fontWeight="medium">
                          {t('rulesList.ifContains', { pattern: rule.name_pattern })}
                        </Typography>
                        <Chip
                          label={t('rulesList.txnCount', { count: transactionCount })}
                          size="small"
                          color={transactionCount > 0 ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </Box>
                      <Box display="flex" alignItems="center" gap={0.5}>
                        <Typography variant="body2" color="text.secondary">
                          {t('rulesList.then')}
                        </Typography>
                        {categoryDisplayIcon && (
                          <Box display="flex" alignItems="center">
                            {categoryDisplayIcon}
                          </Box>
                            )}
                            <Typography
                              variant="body2"
                              fontWeight="medium"
                              sx={{
                                color: categoryDisplayColor || 'text.primary',
                              }}
                            >
                              {categoryDisplayName}
                            </Typography>
                            {subcategoryDisplay && (
                              <Typography variant="body2" color="text.secondary">
                                › {subcategoryDisplay}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Chip
                        label={rule.is_active ? t('rulesList.status.active') : t('rulesList.status.inactive')}
                        size="small"
                        color={rule.is_active ? 'success' : 'default'}
                      />
                      <Tooltip title={transactionCount > 0 ? t('rulesList.tooltips.viewMatches') : t('rulesList.tooltips.noMatches')}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleToggleRuleExpansion(rule.id)}
                            disabled={transactionCount === 0}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <IconButton
                        size="small"
                        onClick={() => handleToggleRule(rule.id, rule.is_active)}
                        title={rule.is_active ? t('rulesList.tooltips.deactivate') : t('rulesList.tooltips.activate')}
                      >
                        {rule.is_active ? <ToggleOnIcon color="success" /> : <ToggleOffIcon />}
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteRule(rule.id)}
                        title={t('rulesList.tooltips.delete')}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                      {/* Expandable Transaction List */}
                      <Collapse in={isExpanded}>
                        <Divider sx={{ my: 1.5 }} />
                      {loadingPreview && !previewData ? (
                        <Box display="flex" justifyContent="center" py={2}>
                          <CircularProgress size={24} />
                        </Box>
                      ) : previewData && previewData.matchedTransactions.length > 0 ? (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary" fontWeight="bold" gutterBottom>
                            {t('rulesList.matches.title')}
                          </Typography>
                            <Box sx={{ maxHeight: 300, overflowY: 'auto', mt: 1 }}>
                              {previewData.matchedTransactions.map((txn, idx) => (
                                <Box
                                  key={`${txn.identifier}-${txn.vendor}-${idx}`}
                                  sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    py: 1,
                                    px: 1,
                                    borderBottom: idx < previewData.matchedTransactions.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                                    '&:hover': {
                                      backgroundColor: 'rgba(0,0,0,0.02)',
                                    },
                                  }}
                                >
                                  <Box flex={1}>
                                    <Typography variant="caption" display="block">
                                      {txn.name}
                                    </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {new Date(txn.date).toLocaleDateString()} • {txn.vendor}
                                {txn.accountNumber && ` • ****${txn.accountNumber}`}
                              </Typography>
                            </Box>
                                  <Typography variant="caption" fontWeight="bold">
                                    ₪{Math.abs(txn.price).toFixed(2)}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          {previewData.totalCount > previewData.matchedTransactions.length && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                              {t('rulesList.matches.more', { count: previewData.totalCount - previewData.matchedTransactions.length })}
                            </Typography>
                          )}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {t('rulesList.matches.none')}
                        </Typography>
                      )}
                      </Collapse>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Box>
    );
  };

  const handleClose = () => {
    setEditingCategory(null);
    setError(null);
    setSuccess(null);
    setActiveTab(0);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        },
      }}
    >
      <ModalHeader title={t('header.title')} onClose={handleClose} />

      <DialogContent style={{ padding: '0 24px 24px 24px' }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        {pendingRefresh && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('refresh.pending')}
          </Alert>
        )}

        <Tabs
          value={activeTab}
          onChange={(e, newValue) => setActiveTab(newValue)}
          sx={{ mb: 3 }}
        >
          <Tab label={t('tabs.categorize')} />
          <Tab label={t('tabs.hierarchy')} />
          <Tab label={t('tabs.rules')} />
        </Tabs>

        {activeTab === 0 && renderCategorizationTab()}
        {activeTab === 1 && renderCategoryTreeTab()}
        {activeTab === 2 && renderPatternRulesTab()}
      </DialogContent>

      <DialogActions style={{ padding: '16px 24px 24px 24px' }}>
        {pendingRefresh && (
          <Button onClick={handleRefreshNow} variant="contained">
            {t('actions.refreshAnalytics')}
          </Button>
        )}
        <Button onClick={handleClose} variant="outlined">
          {t('actions.close')}
        </Button>
      </DialogActions>

      {/* License Read-Only Alert */}
      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        open={transactionDetailModalOpen}
        onClose={() => setTransactionDetailModalOpen(false)}
        transaction={selectedTransactionForDetail}
        onSave={handleTransactionDetailSave}
      />
    </Dialog>
  );
};

export default CategoryHierarchyModal;
