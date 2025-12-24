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
  ButtonGroup,
  Menu,
  ListItemIcon,
  LinearProgress,
} from '@mui/material';
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
  ArrowDropDown as ArrowDropDownIcon,
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
}

type LocalizedCategoryInfo = {
  name?: string | null;
  name_en?: string | null;
  name_fr?: string | null;
  name_he?: string | null;
  category_name?: string | null;
  category_name_en?: string | null;
  category_name_fr?: string | null;
  category_name_he?: string | null;
};

// Icon mapping for dynamic icon rendering
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Restaurant: RestaurantIcon,
  DirectionsCar: DirectionsCarIcon,
  LocalGroceryStore: LocalGroceryStoreIcon,
  ShoppingCart: ExpenseIcon,
  Home: HomeIcon,
  Flight: FlightIcon,
  LocalHospital: LocalHospitalIcon,
  School: SchoolIcon,
  FitnessCenter: FitnessCenterIcon,
  Smartphone: SmartphoneIcon,
  Checkroom: CheckroomIcon,
  Pets: PetsIcon,
  SportsEsports: SportsEsportsIcon,
  Theaters: TheatersIcon,
  LocalBar: LocalBarIcon,
  LocalCafe: LocalCafeIcon,
  AccountBalance: AccountBalanceIcon,
  CreditCard: CreditCardIcon,
  Savings: SavingsIcon,
  Work: WorkIcon,
  AttachMoney: AttachMoneyIcon,
  TrendingUp: InvestmentIcon,
  TrendingDown: TrendingDownIcon,
  MonetizationOn: IncomeIcon,
  LocalTaxi: LocalTaxiIcon,
  Train: TrainIcon,
  LocalGasStation: LocalGasStationIcon,
  ElectricBolt: ElectricBoltIcon,
  Water: WaterIcon,
  Wifi: WifiIcon,
  Phone: PhoneIcon,
  LiveTv: LiveTvIcon,
  MedicalServices: MedicalServicesIcon,
  Cake: CakeIcon,
  CardGiftcard: CardGiftcardIcon,
  ChildCare: ChildCareIcon,
  MenuBook: MenuBookIcon,
  Category: CategoryIcon,
};

const CategoryHierarchyModal: React.FC<CategoryHierarchyModalProps> = ({
  open,
  onClose,
  onCategoriesUpdated = () => {},
}) => {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'categoryHierarchy' });
  const locale = useMemo(() => (i18n.language?.split('-')[0] || 'he') as 'he' | 'en' | 'fr', [i18n.language]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
  const [assignMenuAnchors, setAssignMenuAnchors] = useState<Record<string, HTMLElement | null>>({});

  // Transaction Viewer State
  const [selectedCategoryForTransactions, setSelectedCategoryForTransactions] = useState<CategoryDefinition | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<TransactionMatch[]>([]);
  const [loadingCategoryTransactions, setLoadingCategoryTransactions] = useState(false);
  const [transactionToMove, setTransactionToMove] = useState<TransactionMatch | null>(null);
  const [transactionMoveMenuAnchor, setTransactionMoveMenuAnchor] = useState<HTMLElement | null>(null);

  // Sorting State for Uncategorized Transactions
  const [sortBy, setSortBy] = useState<'name' | 'amount' | 'date'>('date');

  const getLocalizedCategoryName = useCallback((category?: LocalizedCategoryInfo | null) => {
    if (!category) return '';

    const heName = category.name || category.name_he || category.category_name || category.category_name_he || '';
    const enName = category.name_en || category.category_name_en || '';
    const frName = category.name_fr || category.category_name_fr || '';

    if (locale === 'fr') return frName || enName || heName;
    if (locale === 'en') return enName || frName || heName;
    return heName || frName || enName;
  }, [locale]);

  const formatCurrency = (value: number) => {
    const amount = Number.isFinite(value) ? Math.abs(value) : 0;
    const formatted = amount.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return `${value < 0 ? '-' : ''}₪${formatted}`;
  };

  const formatDate = (value: string) => {
    if (!value) {
      return t('helpers.unknownDate');
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? t('helpers.unknownDate') : parsed.toLocaleDateString('en-IL');
  };

  const getCategoryIcon = (category: CategoryDefinition) => {
    if (category.icon && ICON_MAP[category.icon]) {
      const IconComponent = ICON_MAP[category.icon];
      return <IconComponent sx={{ mr: 1, color: category.color || 'text.secondary' }} />;
    }
    // Fallback to generic category icon
    return <CategoryIcon sx={{ mr: 1, color: category.color || 'text.secondary' }} />;
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

  const getTransactionKey = (txn: UncategorizedTransaction) => `${txn.identifier}|${txn.vendor}`;

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
      setCategories(buildCategoryTree(categoryList || []));

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
      onCategoriesUpdated();
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
        onCategoriesUpdated();
        return;
      }

      // New rule was created
      setSuccess(t('notifications.ruleCreatedForName', { name: txn.name }));
      setTimeout(() => setSuccess(null), 5000);

      // Apply the newly created rule to existing transactions
      await handleApplyRules();

      await fetchCategories();
      await fetchRules();
      onCategoriesUpdated();
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
    const selectors: JSX.Element[] = [];

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
        <Grid key={`cat-${depth}`} item xs={12} md={3}>
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
      onCategoriesUpdated();

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
        throw new Error(errorData.error || t('errors.updateCategory'));
      }

      setSuccess(t('notifications.categoryUpdated'));
      setEditingCategory(null);
      await fetchCategories();
      onCategoriesUpdated();

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
        throw new Error(errorData.error || t('errors.deleteCategory'));
      }

      setSuccess(t('notifications.categoryDeleted'));
      await fetchCategories();
      onCategoriesUpdated();

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
        throw new Error(errorData.error || t('errors.applyRules'));
      }

      const result = response.data as any;
      setSuccess(t('notifications.rulesApplied', {
        rules: result.rulesApplied ?? 0,
        transactions: result.transactionsUpdated ?? 0,
      }));

      await fetchCategories();
      onCategoriesUpdated();

      setTimeout(() => setSuccess(null), 5000);
    } catch (error) {
      console.error('Error applying rules:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.applyRules'));
    } finally {
      setIsApplyingRules(false);
    }
  };

  const fetchCategoryTransactions = async (category: CategoryDefinition) => {
    try {
      setLoadingCategoryTransactions(true);
      setSelectedCategoryForTransactions(category);

      const response = await apiClient.get(`/api/categories/transactions?categoryId=${category.id}&limit=200`);

      if (!response.ok) {
        throw new Error(t('errors.loadCategoryTransactions'));
      }

      const data = response.data as any;
      setCategoryTransactions(data?.transactions?.map((txn: any) => ({
        identifier: txn.identifier,
        vendor: txn.vendor,
        date: txn.date,
        name: txn.name,
        price: txn.price,
        accountNumber: txn.accountNumber,
      })));
    } catch (error) {
      console.error('Error fetching category transactions:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.loadCategoryTransactions'));
    } finally {
      setLoadingCategoryTransactions(false);
    }
  };

  const handleRemoveTransactionFromCategory = async (txn: TransactionMatch) => {
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

      // Refresh the transaction list
      if (selectedCategoryForTransactions) {
        await fetchCategoryTransactions(selectedCategoryForTransactions);
      }
      await fetchCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error removing transaction:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.removeTransaction'));
    }
  };

  const handleCreateRuleFromTransaction = async (txn: TransactionMatch) => {
    try {
      setError(null);

      if (!selectedCategoryForTransactions) {
        setError(t('errors.noCategorySelected'));
        return;
      }

      const response = await apiClient.post('/api/categorization_rules/auto-create', {
        transactionName: txn.name,
        categoryDefinitionId: selectedCategoryForTransactions.id,
        categoryType: selectedCategoryForTransactions.category_type,
      });

      const result = response.data as any;

      if (!response.ok) {
        if ((response.data as any).status === 409) {
          setSuccess(t('notifications.ruleExistsForName', { name: txn.name }));
          setTimeout(() => setSuccess(null), 3000);
          return;
        } else {
          throw new Error(result.error || t('errors.createRule'));
        }
      }

      setSuccess(t('notifications.ruleCreatedForName', { name: txn.name }));
      setTimeout(() => setSuccess(null), 5000);

      await fetchRules();
    } catch (error) {
      console.error('Error creating rule:', error);
      setError(error instanceof Error && error.message ? error.message : t('errors.createRule'));
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
        throw new Error(errorPayload?.error || t('errors.moveTransaction'));
      }

      setSuccess(t('notifications.transactionMoved', { category: targetCategory.name }));
      setTimeout(() => setSuccess(null), 3000);

      // Close the move menu
      setTransactionMoveMenuAnchor(null);
      setTransactionToMove(null);

      // Refresh the transaction list
      if (selectedCategoryForTransactions) {
        await fetchCategoryTransactions(selectedCategoryForTransactions);
      }
      await fetchCategories();
      onCategoriesUpdated();
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

  const renderCategoryTree = (category: CategoryDefinition, level: number = 0) => {
    const hasChildren = category.children && category.children.length > 0;
    const isExpanded = expandedCategories.has(category.id);
    const isLeafCategory = !hasChildren && level > 0; // Leaf categories are those without children and not at root level

    return (
      <React.Fragment key={category.id}>
        <ListItem
          sx={(theme) => ({
            pl: level * 4 + 2,
            borderLeft: level > 0 ? `2px solid ${theme.palette.divider}` : 'none',
            transition: 'all 0.2s ease',
            '&:hover': {
              bgcolor: theme.palette.action.hover,
              pl: level * 4 + 2.5, // Slight indent on hover
            },
            cursor: (hasChildren || isLeafCategory) ? 'pointer' : 'default',
            my: 0.5,
            borderRadius: '0 8px 8px 0',
          })}
          onClick={(e) => {
            // If clicking the row, toggle expansion if it has children
            if (hasChildren) {
              toggleCategory(category.id);
            } else if (isLeafCategory && category.transaction_count && category.transaction_count > 0) {
              fetchCategoryTransactions(category);
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
            {hasChildren && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCategory(category.id);
                }}
                sx={{
                  mr: 1,
                  transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: 'transform 0.2s ease',
                }}
              >
                <ExpandMoreIcon />
              </IconButton>
            )}
            {!hasChildren && <Box sx={{ width: 40 }} />}

            {getCategoryIcon(category)}

            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1" fontWeight={level === 0 ? 'bold' : 'medium'}>
                    {getLocalizedCategoryName(category) || category.name}
                  </Typography>
                  {category.transaction_count !== undefined && category.transaction_count > 0 && (
                    <Chip
                      label={category.transaction_count}
                      size="small"
                      variant="outlined"
                      sx={{ height: 20, minWidth: 20, '& .MuiChip-label': { px: 1 } }}
                    />
                  )}
                </Box>
              }
              secondary={category.description}
              secondaryTypographyProps={{
                noWrap: true,
                sx: { maxWidth: 300, fontSize: '0.75rem' }
              }}
            />

            <ListItemSecondaryAction>
              <Tooltip title={t('actions.edit')}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCategory(category);
                  }}
                  sx={{ color: 'primary.main', opacity: 0.7, '&:hover': { opacity: 1 } }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('actions.delete')}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCategory(category.id);
                  }}
                  sx={{ color: 'error.main', opacity: 0.7, '&:hover': { opacity: 1 } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </ListItemSecondaryAction>
          </Box>
        </ListItem>

        {hasChildren && isExpanded && (
          <Collapse in={isExpanded}>
            {category.children!.map(child => renderCategoryTree(child, level + 1))}
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

  const renderHierarchyTab = () => {
  const expenseCategories = categories.filter((c: CategoryDefinition) => c.category_type === 'expense');
  const investmentCategories = categories.filter((c: CategoryDefinition) => c.category_type === 'investment');
  const incomeCategories = categories.filter((c: CategoryDefinition) => c.category_type === 'income');
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
                                  {t('helpers.complete', { count: assignedToLeaf.toLocaleString() })}
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
                          <Grid item xs={12} md={3}>
                            <ButtonGroup
                              fullWidth
                              variant="contained"
                              size="small"
                              sx={(theme) => ({
                                '& .MuiButton-root': {
                                  backgroundColor: draft?.categoryPath?.length
                                    ? theme.palette.primary.main
                                    : undefined,
                                  color: draft?.categoryPath?.length
                                    ? theme.palette.primary.contrastText
                                    : undefined,
                                  transition: 'all 0.3s ease',
                                  fontWeight: 600,
                                  '&:hover': {
                                    backgroundColor: draft?.categoryPath?.length
                                      ? theme.palette.primary.dark
                                      : undefined,
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                                  },
                                  '&:disabled': {
                                    opacity: 0.5,
                                  },
                                },
                              })}
                            >
                              <Button
                                onClick={() => handleSaveAssignment(txn)}
                                disabled={!draft?.categoryPath?.length || isSaving}
                                startIcon={isSaving ? <CircularProgress color="inherit" size={16} /> : undefined}
                              >
                                {isSaving ? t('uncategorized.assign.saving') : t('uncategorized.assign.cta')}
                              </Button>
                              <Button
                                size="small"
                                onClick={(e) => setAssignMenuAnchors({ ...assignMenuAnchors, [key]: e.currentTarget })}
                                disabled={!draft?.categoryPath?.length || isSaving}
                              >
                                <ArrowDropDownIcon />
                              </Button>
                            </ButtonGroup>
                            <Menu
                              anchorEl={assignMenuAnchors[key]}
                              open={Boolean(assignMenuAnchors[key])}
                              onClose={() => setAssignMenuAnchors({ ...assignMenuAnchors, [key]: null })}
                            >
                              <MenuItem
                                onClick={() => {
                                  setAssignMenuAnchors({ ...assignMenuAnchors, [key]: null });
                                  handleAutoAssignSimilar(txn);
                                }}
                                disabled={!draft?.categoryPath?.length || creatingRules[key]}
                              >
                                <ListItemIcon>
                                  {creatingRules[key] ? <CircularProgress size={20} /> : <AutoAwesomeIcon fontSize="small" />}
                                </ListItemIcon>
                                <ListItemText primary={creatingRules[key] ? t('uncategorized.createRule.saving') : t('uncategorized.createRule.cta')} />
                              </MenuItem>
                            </Menu>
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

        {/* Category Tree */}
        {loading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Expense Section */}
            <Paper
              elevation={0}
              sx={(theme) => ({
                overflow: 'hidden',
                borderRadius: 3,
                border: `1px solid ${theme.palette.divider}`,
                background: theme.palette.mode === 'dark'
                  ? 'rgba(30, 30, 30, 0.6)'
                  : 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: theme.palette.mode === 'dark'
                    ? '0 8px 24px rgba(0,0,0,0.4)'
                    : '0 8px 24px rgba(0,0,0,0.1)',
                  transform: 'translateY(-2px)',
                }
              })}
            >
              <ListItemButton
                onClick={() => setExpandedSections(prev => ({ ...prev, expense: !prev.expense }))}
                sx={{
                  py: 2,
                  background: (theme) => theme.palette.mode === 'dark'
                    ? 'linear-gradient(to right, rgba(239, 83, 80, 0.15), transparent)'
                    : 'linear-gradient(to right, rgba(239, 83, 80, 0.08), transparent)',
                }}
              >
                <ListItemIcon>
                  <ExpenseIcon sx={{ color: '#ef5350', fontSize: 28 }} />
                </ListItemIcon>
                <ListItemText
                  primary={t('sections.expense')}
                  primaryTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  secondary={t('sections.expenseSubtitle', { count: expenseCategories.length })}
                />
                {expandedSections.expense ? <ExpandMoreIcon /> : <ChevronRightIcon />}
              </ListItemButton>
              <Collapse in={expandedSections.expense} timeout="auto" unmountOnExit>
                <List dense sx={{ px: 2, pb: 2 }}>
                  {expenseCategories.map(category => renderCategoryTree(category))}
                </List>
              </Collapse>
            </Paper>

            {/* Investment Section */}
            <Paper
              elevation={0}
              sx={(theme) => ({
                overflow: 'hidden',
                borderRadius: 3,
                border: `1px solid ${theme.palette.divider}`,
                background: theme.palette.mode === 'dark'
                  ? 'rgba(30, 30, 30, 0.6)'
                  : 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: theme.palette.mode === 'dark'
                    ? '0 8px 24px rgba(0,0,0,0.4)'
                    : '0 8px 24px rgba(0,0,0,0.1)',
                  transform: 'translateY(-2px)',
                }
              })}
            >
              <ListItemButton
                onClick={() => setExpandedSections(prev => ({ ...prev, investment: !prev.investment }))}
                sx={{
                  py: 2,
                  background: (theme) => theme.palette.mode === 'dark'
                    ? 'linear-gradient(to right, rgba(102, 187, 106, 0.15), transparent)'
                    : 'linear-gradient(to right, rgba(102, 187, 106, 0.08), transparent)',
                }}
              >
                <ListItemIcon>
                  <InvestmentIcon sx={{ color: '#66bb6a', fontSize: 28 }} />
                </ListItemIcon>
                <ListItemText
                  primary={t('sections.investment')}
                  primaryTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  secondary={t('sections.investmentSubtitle', { count: investmentCategories.length })}
                />
                {expandedSections.investment ? <ExpandMoreIcon /> : <ChevronRightIcon />}
              </ListItemButton>
              <Collapse in={expandedSections.investment} timeout="auto" unmountOnExit>
                <List dense sx={{ px: 2, pb: 2 }}>
                  {investmentCategories.map(category => renderCategoryTree(category))}
                </List>
              </Collapse>
            </Paper>

            {/* Income Section */}
            <Paper
              elevation={0}
              sx={(theme) => ({
                overflow: 'hidden',
                borderRadius: 3,
                border: `1px solid ${theme.palette.divider}`,
                background: theme.palette.mode === 'dark'
                  ? 'rgba(30, 30, 30, 0.6)'
                  : 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: theme.palette.mode === 'dark'
                    ? '0 8px 24px rgba(0,0,0,0.4)'
                    : '0 8px 24px rgba(0,0,0,0.1)',
                  transform: 'translateY(-2px)',
                }
              })}
            >
              <ListItemButton
                onClick={() => setExpandedSections(prev => ({ ...prev, income: !prev.income }))}
                sx={{
                  py: 2,
                  background: (theme) => theme.palette.mode === 'dark'
                    ? 'linear-gradient(to right, rgba(66, 165, 245, 0.15), transparent)'
                    : 'linear-gradient(to right, rgba(66, 165, 245, 0.08), transparent)',
                }}
              >
                <ListItemIcon>
                  <IncomeIcon sx={{ color: '#42a5f5', fontSize: 28 }} />
                </ListItemIcon>
                <ListItemText
                  primary={t('sections.income')}
                  primaryTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  secondary={t('sections.incomeSubtitle', { count: incomeCategories.length })}
                />
                {expandedSections.income ? <ExpandMoreIcon /> : <ChevronRightIcon />}
              </ListItemButton>
              <Collapse in={expandedSections.income} timeout="auto" unmountOnExit>
                <List dense sx={{ px: 2, pb: 2 }}>
                  {incomeCategories.map(category => renderCategoryTree(category))}
                </List>
              </Collapse>
            </Paper>
          </Box>
        )}

        {/* Edit Category Dialog */}
        {editingCategory && (
          <Dialog open={true} onClose={() => setEditingCategory(null)} maxWidth="sm" fullWidth>
            <DialogTitle>{t('editDialog.title')}</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label={t('editDialog.fields.name')}
                    value={editingCategory.name}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label={t('editDialog.fields.description')}
                    value={editingCategory.description || ''}
                    onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                    multiline
                    rows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={editingCategory.is_active}
                        onChange={(e) => setEditingCategory({ ...editingCategory, is_active: e.target.checked })}
                      />
                    }
                    label={t('editDialog.fields.active')}
                  />
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditingCategory(null)}>{t('actions.cancel')}</Button>
              <Button variant="contained" onClick={() => handleUpdateCategory(editingCategory)}>
                {t('actions.save')}
              </Button>
            </DialogActions>
          </Dialog>
        )}

        {/* Transaction Viewer Dialog */}
        {selectedCategoryForTransactions && (
          <Dialog
            open={true}
            onClose={() => {
              setSelectedCategoryForTransactions(null);
              setCategoryTransactions([]);
            }}
            maxWidth="md"
            fullWidth
          >
            <DialogTitle>
              <Box display="flex" alignItems="center" gap={1}>
                {getCategoryIcon(selectedCategoryForTransactions)}
                <Typography variant="h6">
                  {t('transactions.title', { name: getLocalizedCategoryName(selectedCategoryForTransactions) || selectedCategoryForTransactions.name })}
                </Typography>
                <Chip
                  label={t('transactions.count', { count: categoryTransactions.length })}
                  size="small"
                  color="primary"
                />
              </Box>
            </DialogTitle>
            <DialogContent>
              {loadingCategoryTransactions ? (
                <Box display="flex" justifyContent="center" py={4}>
                  <CircularProgress />
                </Box>
              ) : categoryTransactions.length === 0 ? (
                <Alert severity="info">{t('transactions.none')}</Alert>
              ) : (
                <List dense>
                  {categoryTransactions.map((txn, idx) => (
                    <ListItem
                      key={`${txn.identifier}-${txn.vendor}-${idx}`}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        mb: 1,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                      }}
                    >
                      <Box display="flex" justifyContent="space-between" width="100%" mb={1}>
                        <Box>
                          <Typography variant="subtitle2" fontWeight="600">
                            {txn.name || t('transactions.unknown')}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {txn.vendor || t('transactions.unknownVendor')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(txn.date)}
                            {txn.accountNumber ? ` • ****${txn.accountNumber}` : ''}
                          </Typography>
                        </Box>
                        <Typography variant="subtitle2" fontWeight="bold">
                          {formatCurrency(txn.price)}
                        </Typography>
                      </Box>
                      <Box display="flex" gap={1}>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => handleRemoveTransactionFromCategory(txn)}
                          >
                            {t('transactions.remove')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            startIcon={<EditIcon />}
                          onClick={(e) => {
                              setTransactionToMove(txn);
                              setTransactionMoveMenuAnchor(e.currentTarget);
                            }}
                          >
                            {t('transactions.move')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AutoAwesomeIcon />}
                            onClick={() => handleCreateRuleFromTransaction(txn)}
                          >
                            {t('transactions.createRule')}
                          </Button>
                      </Box>
                    </ListItem>
                  ))}
                </List>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                onClick={() => {
              setSelectedCategoryForTransactions(null);
              setCategoryTransactions([]);
            }}
          >
            {t('actions.close')}
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
              const renderCategoryMenuItem = (cat: CategoryDefinition, depth: number = 0): JSX.Element[] => {
                const items: JSX.Element[] = [];

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
            <Grid item xs={12} md={4}>
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
            <Grid item xs={12} md={2}>
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
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('rulesForm.fields.category')}</InputLabel>
                <Select
                  value={newRuleParentId ?? ''}
                  label={t('rulesForm.fields.category')}
                  onChange={(e) => {
                    const value = e.target.value;
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
            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small" disabled={!newRuleParentId || childOptions.length === 0}>
                <InputLabel>{t('rulesForm.fields.subcategory')}</InputLabel>
                <Select
                  value={subcategoryValue}
                  label={t('rulesForm.fields.subcategory')}
                  onChange={(e) => {
                    const value = e.target.value;
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
            <Grid item xs={12} md={1}>
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
                <Grid item xs={12} key={rule.id}>
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

        <Tabs
          value={activeTab}
          onChange={(e, newValue) => setActiveTab(newValue)}
          sx={{ mb: 3 }}
        >
          <Tab label={t('tabs.hierarchy')} />
          <Tab label={t('tabs.rules')} />
        </Tabs>

        {activeTab === 0 && renderHierarchyTab()}
        {activeTab === 1 && renderPatternRulesTab()}
      </DialogContent>

      <DialogActions style={{ padding: '16px 24px 24px 24px' }}>
        <Button onClick={handleClose} variant="outlined">
          {t('actions.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CategoryHierarchyModal;
