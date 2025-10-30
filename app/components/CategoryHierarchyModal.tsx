import React, { useState, useEffect, useMemo } from 'react';
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
} from '@mui/material';
import {
  Close as CloseIcon,
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
  Refresh as RefreshIcon,
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
} from '@mui/icons-material';
import ModalHeader from './ModalHeader';

interface CategoryDefinition {
  id: number;
  name: string;
  name_en?: string;
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
  onCategoriesUpdated: () => void;
}

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
  onCategoriesUpdated,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Category Hierarchy State
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [uncategorized, setUncategorized] = useState<UncategorizedSummary | null>(null);
  const [bankTransactions, setBankTransactions] = useState<UncategorizedSummary | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [editingCategory, setEditingCategory] = useState<CategoryDefinition | null>(null);
  const [newCategory, setNewCategory] = useState<Partial<CategoryDefinition>>({
    name: '',
    parent_id: null,
    category_type: 'expense',
    description: '',
  });

  // Pattern Rules State
  const [rules, setRules] = useState<PatternRule[]>([]);
  const [editingRule, setEditingRule] = useState<PatternRule | null>(null);
  const [newRule, setNewRule] = useState<Partial<PatternRule>>({
    name_pattern: '',
    category_type: 'expense',
  });
  const [newRuleType, setNewRuleType] = useState<CategoryType>('expense');
  const [newRuleParentId, setNewRuleParentId] = useState<number | null>(null);
  const [newRuleCategoryId, setNewRuleCategoryId] = useState<number | null>(null);
  const [isApplyingRules, setIsApplyingRules] = useState(false);

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
      return 'Unknown date';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown date' : parsed.toLocaleDateString('en-IL');
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

    // Get actual parent categories (level 2) - children of root categories
    // Root categories (level 1) are: הוצאות, השקעות, הכנסות
    categories.forEach((root: CategoryDefinition) => {
      if (root.children && root.children.length > 0) {
        // Add the children (level 2 - actual parent categories) to the list
        result[root.category_type as CategoryType].push(...root.children);
      }
    });

    return result;
  }, [categories]);

  const getTransactionKey = (txn: UncategorizedTransaction) => `${txn.identifier}|${txn.vendor}`;

  useEffect(() => {
    if (open) {
      fetchCategories();
      fetchRules();
    }
  }, [open]);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/categories/hierarchy');
      if (!response.ok) throw new Error('Failed to fetch categories');

      const payload = await response.json();
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

      if (!Array.isArray(payload) && payload?.bankTransactions) {
        setBankTransactions({
          totalCount: payload.bankTransactions.totalCount ?? 0,
          totalAmount: payload.bankTransactions.totalAmount ?? 0,
          recentTransactions: payload.bankTransactions.recentTransactions ?? [],
        });
      } else {
        setBankTransactions(null);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      setError('Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const hasUncategorized = uncategorized?.recentTransactions && uncategorized.recentTransactions.length > 0;
    const hasBankTransactions = bankTransactions?.recentTransactions && bankTransactions.recentTransactions.length > 0;

    if (!hasUncategorized && !hasBankTransactions) {
      setAssignmentDrafts({});
      setSavingAssignments({});
      return;
    }

    setAssignmentDrafts((prev: Record<string, TransactionAssignment>) => {
      const next: Record<string, TransactionAssignment> = {};

      // Process uncategorized transactions
      if (hasUncategorized) {
        uncategorized!.recentTransactions.forEach((txn: UncategorizedTransaction) => {
          const key = getTransactionKey(txn);
          if (prev[key]) {
            next[key] = prev[key];
          } else {
            const defaultType: CategoryType = txn.price >= 0 ? 'income' : 'expense';

            next[key] = {
              type: defaultType,
              categoryPath: [],
            };
          }
        });
      }

      // Process bank transactions
      if (hasBankTransactions) {
        bankTransactions!.recentTransactions.forEach((txn: UncategorizedTransaction) => {
          const key = getTransactionKey(txn);
          if (prev[key]) {
            next[key] = prev[key];
          } else {
            // Bank transactions are typically expenses or could be transfers
            const defaultType: CategoryType = txn.price >= 0 ? 'income' : 'expense';
            
            next[key] = {
              type: defaultType,
              categoryPath: [],
            };
          }
        });
      }

      return next;
    });
  }, [uncategorized, bankTransactions, categories]);

  const updateAssignmentDraft = (key: string, updates: Partial<TransactionAssignment>) => {
    setAssignmentDrafts((prev: Record<string, TransactionAssignment>) => ({
      ...prev,
      [key]: {
        type: updates.type ?? prev[key]?.type ?? 'expense',
        categoryPath: updates.categoryPath ?? prev[key]?.categoryPath ?? [],
      },
    }));
  };

  const handleAssignmentTypeChange = (key: string, type: CategoryType) => {
    updateAssignmentDraft(key, { type, categoryPath: [] });
  };

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

      return {
        ...prev,
        [key]: {
          ...draft,
          categoryPath: newPath,
        },
      };
    });
  };

  const handleSaveAssignment = async (txn: UncategorizedTransaction) => {
    const key = getTransactionKey(txn);
    const draft = assignmentDrafts[key];

    if (!draft || draft.categoryPath.length === 0) {
      setError('Please select at least one category.');
      return;
    }

    // Get the final (leaf) category from the path
    const selectedCategoryId = draft.categoryPath[draft.categoryPath.length - 1];
    const categoryDefinition = categoryLookup.get(selectedCategoryId);

    if (!categoryDefinition) {
      setError('Selected category is no longer available.');
      return;
    }

  setSavingAssignments((prev: Record<string, boolean>) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(`${txn.identifier}|${txn.vendor}`)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_definition_id: selectedCategoryId,
          category_type: draft.type,
          category: categoryDefinition.name,
          auto_categorized: false,
          confidence_score: 1.0,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to categorize transaction');
      }

      setSuccess('Transaction categorized successfully');
      setTimeout(() => setSuccess(null), 3000);

      await fetchCategories();
      onCategoriesUpdated();
    } catch (assignmentError) {
      console.error('Error categorizing transaction:', assignmentError);
      setError(assignmentError instanceof Error ? assignmentError.message : 'Failed to categorize transaction');
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
      setError('Please select at least one category first.');
      return;
    }

    const selectedCategoryId = draft.categoryPath[draft.categoryPath.length - 1];

    setCreatingRules((prev: Record<string, boolean>) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const response = await fetch('/api/categorization_rules/auto-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionName: txn.name,
          categoryDefinitionId: selectedCategoryId,
          categoryType: draft.type,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          // Rule already exists - just apply the existing rules
          setSuccess(`A rule for "${txn.name}" already exists. Applying all rules now...`);
          setTimeout(() => setSuccess(null), 5000);
          
          // Apply existing rules
          await handleApplyRules();
          await fetchCategories();
          await fetchRules();
          onCategoriesUpdated();
          return;
        } else {
          throw new Error(result.error || 'Failed to create auto-assignment rule');
        }
      }

      setSuccess(`Rule created! All transactions named "${txn.name}" will now be auto-categorized.`);
      setTimeout(() => setSuccess(null), 5000);

      // Apply the newly created rule to existing transactions
      await handleApplyRules();
      
      await fetchCategories();
      await fetchRules();
      onCategoriesUpdated();
    } catch (ruleError) {
      console.error('Error creating auto-assignment rule:', ruleError);
      setError(ruleError instanceof Error ? ruleError.message : 'Failed to create rule');
    } finally {
      setCreatingRules((prev: Record<string, boolean>) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const buildCategoryTree = (flatCategories: CategoryDefinition[] = []): CategoryDefinition[] => {
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
      const isLastInPath = depth === path.length - 1;
      const currentCategory = currentValue ? categoryLookup.get(currentValue) : undefined;
      const hasChildren = currentCategory?.children && currentCategory.children.length > 0;

      selectors.push(
        <Grid key={`cat-${depth}`} item xs={12} md={depth === 0 ? 3 : 2}>
          <FormControl fullWidth size="small">
            <InputLabel>{depth === 0 ? 'Category' : `Level ${depth + 1}`}</InputLabel>
            <Select
              value={currentValue}
              label={depth === 0 ? 'Category' : `Level ${depth + 1}`}
              onChange={(event: any) => {
                const value = event.target.value;
                handleCategoryPathChange(transactionKey, depth, value === '' ? null : Number(value));
              }}
            >
              <MenuItem value="">Select...</MenuItem>
              {options.map((cat: CategoryDefinition) => (
                <MenuItem key={cat.id} value={cat.id}>
                  {cat.name} {cat.name_en ? `(${cat.name_en})` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      );
    }

    return selectors;
  };

  const fetchRules = async () => {
    try {
      const response = await fetch('/api/categorization_rules');
      if (!response.ok) throw new Error('Failed to fetch rules');

      const rulesData = await response.json();
      setRules(rulesData);

      // Fetch transaction counts for all rules
      await fetchAllTransactionCounts(rulesData);
    } catch (error) {
      console.error('Error fetching rules:', error);
      setError('Failed to load rules');
    }
  };

  const fetchAllTransactionCounts = async (rulesToFetch: PatternRule[]) => {
    try {
      const counts = new Map<number, number>();

      await Promise.all(
        rulesToFetch.map(async (rule) => {
          try {
            const response = await fetch(
              `/api/categorization_rules/preview?ruleId=${rule.id}&limit=0`
            );
            if (response.ok) {
              const data = await response.json();
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
  };

  const fetchRulePreview = async (ruleId: number) => {
    try {
      setLoadingPreview(true);
      const response = await fetch(
        `/api/categorization_rules/preview?ruleId=${ruleId}&limit=20`
      );

      if (!response.ok) throw new Error('Failed to fetch preview');

      const data: PatternPreview = await response.json();
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
      const response = await fetch(
        `/api/categorization_rules/preview?pattern=${encodeURIComponent(pattern)}&limit=10`
      );

      if (!response.ok) throw new Error('Failed to fetch preview');

      const data: PatternPreview = await response.json();
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
      setError('Please enter a category name');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/categories/hierarchy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCategory),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create category');
      }

      setSuccess('Category created successfully');
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
      setError(error instanceof Error ? error.message : 'Failed to create category');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCategory = async (category: CategoryDefinition) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/categories/hierarchy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(category),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update category');
      }

      setSuccess('Category updated successfully');
      setEditingCategory(null);
      await fetchCategories();
      onCategoriesUpdated();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error updating category:', error);
      setError(error instanceof Error ? error.message : 'Failed to update category');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCategory = async (categoryId: number) => {
    if (!confirm('Are you sure you want to delete this category? This will also affect all its subcategories.')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/categories/hierarchy?id=${categoryId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete category');
      }

      setSuccess('Category deleted successfully');
      await fetchCategories();
      onCategoriesUpdated();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error deleting category:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete category');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRule = async () => {
    if (!newRule.name_pattern?.trim() || !newRuleParentId) {
      setError('Please enter a pattern and select a category');
      return;
    }

    const parentDefinition = categoryLookup.get(newRuleParentId);
    if (!parentDefinition) {
      setError('Selected category is no longer available.');
      return;
    }

    const selectedCategoryId = newRuleCategoryId ?? newRuleParentId;
    const categoryDefinition = categoryLookup.get(selectedCategoryId);

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/categorization_rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name_pattern: newRule.name_pattern,
          category_definition_id: selectedCategoryId,
          category_type: newRuleType,
          is_active: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create rule');
      }

      setSuccess('Rule created successfully');
      setNewRule({ name_pattern: '', category_type: 'expense' });
      setNewRuleType('expense');
      setNewRuleParentId(null);
      setNewRuleCategoryId(null);
      await fetchRules();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error creating rule:', error);
      setError(error instanceof Error ? error.message : 'Failed to create rule');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRule = async (ruleId: number, currentStatus: boolean) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/categorization_rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ruleId,
          is_active: !currentStatus,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to toggle rule');
      }

      setSuccess(`Rule ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      await fetchRules();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error toggling rule:', error);
      setError(error instanceof Error ? error.message : 'Failed to toggle rule');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    if (!confirm('Are you sure you want to delete this rule?')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/categorization_rules?id=${ruleId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete rule');
      }

      setSuccess('Rule deleted successfully');
      await fetchRules();

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error deleting rule:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete rule');
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

      const response = await fetch('/api/apply_categorization_rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to apply rules');
      }

      const result = await response.json();
      setSuccess(`Successfully applied ${result.rulesApplied} rules to ${result.transactionsUpdated} transactions`);

      await fetchCategories();
      onCategoriesUpdated();

      setTimeout(() => setSuccess(null), 5000);
    } catch (error) {
      console.error('Error applying rules:', error);
      setError(error instanceof Error ? error.message : 'Failed to apply rules');
    } finally {
      setIsApplyingRules(false);
    }
  };

  const fetchCategoryTransactions = async (category: CategoryDefinition) => {
    try {
      setLoadingCategoryTransactions(true);
      setSelectedCategoryForTransactions(category);

      const response = await fetch(`/api/categories/transactions?categoryId=${category.id}&limit=200`);

      if (!response.ok) {
        throw new Error('Failed to fetch category transactions');
      }

      const data = await response.json();
      setCategoryTransactions(data.transactions.map((txn: any) => ({
        identifier: txn.identifier,
        vendor: txn.vendor,
        date: txn.date,
        name: txn.name,
        price: txn.price,
        accountNumber: txn.accountNumber,
      })));
    } catch (error) {
      console.error('Error fetching category transactions:', error);
      setError('Failed to load transactions for this category');
    } finally {
      setLoadingCategoryTransactions(false);
    }
  };

  const handleRemoveTransactionFromCategory = async (txn: TransactionMatch) => {
    try {
      setError(null);

      const response = await fetch(`/api/transactions/${encodeURIComponent(`${txn.identifier}|${txn.vendor}`)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_definition_id: null,
          auto_categorized: false,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to remove transaction from category');
      }

      setSuccess('Transaction removed from category');
      setTimeout(() => setSuccess(null), 3000);

      // Refresh the transaction list
      if (selectedCategoryForTransactions) {
        await fetchCategoryTransactions(selectedCategoryForTransactions);
      }
      await fetchCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error removing transaction:', error);
      setError(error instanceof Error ? error.message : 'Failed to remove transaction');
    }
  };

  const handleCreateRuleFromTransaction = async (txn: TransactionMatch) => {
    try {
      setError(null);

      if (!selectedCategoryForTransactions) {
        setError('No category selected');
        return;
      }

      const response = await fetch('/api/categorization_rules/auto-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionName: txn.name,
          categoryDefinitionId: selectedCategoryForTransactions.id,
          categoryType: selectedCategoryForTransactions.category_type,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setSuccess(`A rule for "${txn.name}" already exists.`);
          setTimeout(() => setSuccess(null), 3000);
          return;
        } else {
          throw new Error(result.error || 'Failed to create rule');
        }
      }

      setSuccess(`Rule created! All transactions named "${txn.name}" will now be auto-categorized.`);
      setTimeout(() => setSuccess(null), 5000);

      await fetchRules();
    } catch (error) {
      console.error('Error creating rule:', error);
      setError(error instanceof Error ? error.message : 'Failed to create rule');
    }
  };

  const handleMoveTransactionToCategory = async (txn: TransactionMatch, targetCategoryId: number) => {
    try {
      setError(null);

      const targetCategory = categoryLookup.get(targetCategoryId);
      if (!targetCategory) {
        setError('Target category not found');
        return;
      }

      const response = await fetch(`/api/transactions/${encodeURIComponent(`${txn.identifier}|${txn.vendor}`)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_definition_id: targetCategoryId,
          category_type: targetCategory.category_type,
          category: targetCategory.name,
          auto_categorized: false,
          confidence_score: 1.0,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to move transaction');
      }

      setSuccess(`Transaction moved to ${targetCategory.name}`);
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
      setError(error instanceof Error ? error.message : 'Failed to move transaction');
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
          sx={{
            pl: level * 4 + 2,
            borderLeft: level > 0 ? '2px solid #e0e0e0' : 'none',
            '&:hover': { bgcolor: 'action.hover' },
            cursor: isLeafCategory ? 'pointer' : 'default',
          }}
          onClick={() => {
            if (isLeafCategory && category.transaction_count && category.transaction_count > 0) {
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
                sx={{ mr: 1 }}
              >
                {isExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
              </IconButton>
            )}
            {!hasChildren && <Box sx={{ width: 40 }} />}

            {getCategoryIcon(category)}

            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1" fontWeight={level === 0 ? 'bold' : 'normal'}>
                    {category.name}
                  </Typography>
                  {category.transaction_count !== undefined && (
                    <Chip
                      label={`${category.transaction_count} txns`}
                      size="small"
                      variant="outlined"
                    />
                  )}
                  {level === 0 && (
                    <Chip
                      icon={getCategoryTypeIcon(category.category_type)}
                      label={category.category_type}
                      size="small"
                      color={getCategoryTypeColor(category.category_type)}
                    />
                  )}
                </Box>
              }
              secondary={category.description}
            />

            <ListItemSecondaryAction>
              <Tooltip title="Edit">
                <IconButton
                  size="small"
                  onClick={() => setEditingCategory(category)}
                  sx={{ color: 'primary.main' }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton
                  size="small"
                  onClick={() => handleDeleteCategory(category.id)}
                  sx={{ color: 'error.main' }}
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

  const renderHierarchyTab = () => {
  const expenseCategories = categories.filter((c: CategoryDefinition) => c.category_type === 'expense');
  const investmentCategories = categories.filter((c: CategoryDefinition) => c.category_type === 'investment');
  const incomeCategories = categories.filter((c: CategoryDefinition) => c.category_type === 'income');
    const uncategorizedPreview = uncategorized?.recentTransactions?.slice(0, 10) ?? [];

    return (
      <Box>
        {uncategorized && (
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
              Unassigned Transactions
            </Typography>
            {uncategorized.totalCount === 0 ? (
              <Typography variant="body2" color="text.secondary">
                All transactions are currently assigned to categories.
              </Typography>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  {`You have ${uncategorized.totalCount.toLocaleString()} transaction${uncategorized.totalCount !== 1 ? 's' : ''} waiting for categorization.`}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>
                  {`Total pending amount: ${formatCurrency(uncategorized.totalAmount)}`}
                </Typography>
                <List dense sx={{ pt: 0 }}>
                  {uncategorizedPreview.map((txn: UncategorizedTransaction) => {
                    const key = getTransactionKey(txn);
                    const draft = assignmentDrafts[key];
                    const rootOptions = categoryRootsByType[draft?.type ?? 'expense'];
                    const isSaving = Boolean(savingAssignments[key]);

                    return (
                      <ListItem
                        key={`${txn.identifier}-${txn.vendor}-${txn.date}`}
                        alignItems="flex-start"
                        sx={{
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          mb: 1,
                          py: 1.5,
                          px: 2,
                        }}
                      >
                        <Box display="flex" justifyContent="space-between" width="100%">
                          <Box>
                            <Typography variant="subtitle2" fontWeight="600">
                              {txn.name || 'Unknown transaction'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {(txn.vendor || 'Unknown vendor')}
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

                        <Grid container spacing={1} alignItems="center">
                          <Grid item xs={12} md={3}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Type</InputLabel>
                              <Select
                                value={draft?.type ?? 'expense'}
                                label="Type"
                                onChange={(event: any) =>
                                  handleAssignmentTypeChange(key, event.target.value as CategoryType)
                                }
                              >
                                <MenuItem value="expense">Expense</MenuItem>
                                <MenuItem value="investment">Investment</MenuItem>
                                <MenuItem value="income">Income</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          {renderCategorySelectors(key, draft, rootOptions)}
                          <Grid item xs={12} md={4}>
                            <ButtonGroup fullWidth variant="contained" size="small">
                              <Button
                                onClick={() => handleSaveAssignment(txn)}
                                disabled={!draft?.categoryPath?.length || isSaving}
                                startIcon={isSaving ? <CircularProgress color="inherit" size={16} /> : undefined}
                              >
                                {isSaving ? 'Saving' : 'Assign'}
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
                                <ListItemText primary={creatingRules[key] ? 'Creating...' : 'Auto-Assign Similar'} />
                              </MenuItem>
                            </Menu>
                          </Grid>
                        </Grid>
                      </ListItem>
                    );
                  })}
                </List>
                {uncategorized.totalCount > uncategorizedPreview.length && (
                  <Typography variant="caption" color="text.secondary">
                    {`Showing the latest ${uncategorizedPreview.length} of ${uncategorized.totalCount.toLocaleString()} transactions.`}
                  </Typography>
                )}
              </>
            )}
          </Paper>
        )}

        {/* Bank Transactions to Categorize */}
        {bankTransactions && (
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
              Bank Transactions to Categorize
            </Typography>
            {bankTransactions.totalCount === 0 ? (
              <Typography variant="body2" color="text.secondary">
                All bank transactions have been categorized.
              </Typography>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  {`You have ${bankTransactions.totalCount.toLocaleString()} bank transaction${bankTransactions.totalCount !== 1 ? 's' : ''} to categorize.`}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>
                  {`Total amount: ${formatCurrency(bankTransactions.totalAmount)}`}
                </Typography>
                <List dense sx={{ pt: 0 }}>
                  {bankTransactions.recentTransactions.slice(0, 10).map((txn: UncategorizedTransaction) => {
                    const key = getTransactionKey(txn);
                    const draft = assignmentDrafts[key];
                    const rootOptions = categoryRootsByType[draft?.type ?? 'expense'];
                    const isSaving = Boolean(savingAssignments[key]);

                    return (
                      <ListItem
                        key={`${txn.identifier}-${txn.vendor}-${txn.date}`}
                        alignItems="flex-start"
                        sx={{
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          mb: 1,
                          py: 1.5,
                          px: 2,
                        }}
                      >
                        <Box display="flex" justifyContent="space-between" width="100%">
                          <Box>
                            <Typography variant="subtitle2" fontWeight="600">
                              {txn.name || 'Unknown transaction'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {(txn.vendor || 'Unknown vendor')}
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

                        <Grid container spacing={1} alignItems="center">
                          <Grid item xs={12} md={3}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Type</InputLabel>
                              <Select
                                value={draft?.type ?? 'expense'}
                                label="Type"
                                onChange={(event: any) =>
                                  handleAssignmentTypeChange(key, event.target.value as CategoryType)
                                }
                              >
                                <MenuItem value="expense">Expense</MenuItem>
                                <MenuItem value="investment">Investment</MenuItem>
                                <MenuItem value="income">Income</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          {renderCategorySelectors(key, draft, rootOptions)}
                          <Grid item xs={12} md={4}>
                            <ButtonGroup fullWidth variant="contained" size="small">
                              <Button
                                onClick={() => handleSaveAssignment(txn)}
                                disabled={!draft?.categoryPath?.length || isSaving}
                                startIcon={isSaving ? <CircularProgress color="inherit" size={16} /> : undefined}
                              >
                                {isSaving ? 'Saving' : 'Assign'}
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
                                <ListItemText primary={creatingRules[key] ? 'Creating...' : 'Auto-Assign Similar'} />
                              </MenuItem>
                            </Menu>
                          </Grid>
                        </Grid>
                      </ListItem>
                    );
                  })}
                </List>
                {bankTransactions.totalCount > 10 && (
                  <Typography variant="caption" color="text.secondary">
                    {`Showing the latest 10 of ${bankTransactions.totalCount.toLocaleString()} transactions.`}
                  </Typography>
                )}
              </>
            )}
          </Paper>
        )}

        {/* Create New Category */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            Add New Category
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Category Name"
                value={newCategory.name || ''}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                placeholder="e.g., Restaurants"
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={newCategory.category_type || 'expense'}
                  onChange={(e) => setNewCategory({ ...newCategory, category_type: e.target.value as any })}
                  label="Type"
                >
                  <MenuItem value="expense">Expense</MenuItem>
                  <MenuItem value="investment">Investment</MenuItem>
                  <MenuItem value="income">Income</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Parent Category</InputLabel>
                <Select
                  value={newCategory.parent_id || ''}
                  onChange={(e) => setNewCategory({ ...newCategory, parent_id: e.target.value ? Number(e.target.value) : null })}
                  label="Parent Category"
                >
                  <MenuItem value="">None (Top Level)</MenuItem>
                  {categories
                    .filter(c => c.category_type === newCategory.category_type)
                    .map(c => {
                      // Show root and its children as potential parents
                      const items = [
                        <MenuItem key={c.id} value={c.id}>
                          {c.name} {c.name_en ? `(${c.name_en})` : ''}
                        </MenuItem>
                      ];
                      if (c.children && c.children.length > 0) {
                        c.children.forEach(child => {
                          items.push(
                            <MenuItem key={child.id} value={child.id} sx={{ pl: 4 }}>
                              ↳ {child.name} {child.name_en ? `(${child.name_en})` : ''}
                            </MenuItem>
                          );
                        });
                      }
                      return items;
                    })
                    .flat()}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button
                fullWidth
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleCreateCategory}
                disabled={loading || !newCategory.name}
              >
                Add
              </Button>
            </Grid>
          </Grid>
        </Paper>

        {/* Category Tree */}
        {loading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ExpenseIcon /> Expenses
            </Typography>
            <List dense>
              {expenseCategories.map(category => renderCategoryTree(category))}
            </List>

            <Divider sx={{ my: 2 }} />

            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InvestmentIcon /> Investments
            </Typography>
            <List dense>
              {investmentCategories.map(category => renderCategoryTree(category))}
            </List>

            <Divider sx={{ my: 2 }} />

            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IncomeIcon /> Income
            </Typography>
            <List dense>
              {incomeCategories.map(category => renderCategoryTree(category))}
            </List>
          </>
        )}

        {/* Edit Category Dialog */}
        {editingCategory && (
          <Dialog open={true} onClose={() => setEditingCategory(null)} maxWidth="sm" fullWidth>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Category Name"
                    value={editingCategory.name}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Description"
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
                    label="Active"
                  />
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditingCategory(null)}>Cancel</Button>
              <Button variant="contained" onClick={() => handleUpdateCategory(editingCategory)}>
                Save
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
                  {selectedCategoryForTransactions.name} Transactions
                </Typography>
                <Chip
                  label={`${categoryTransactions.length} transaction${categoryTransactions.length !== 1 ? 's' : ''}`}
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
                <Alert severity="info">No transactions found for this category.</Alert>
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
                            {txn.name || 'Unknown transaction'}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {txn.vendor || 'Unknown vendor'}
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
                          Remove from Category
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
                          Move to Category
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AutoAwesomeIcon />}
                          onClick={() => handleCreateRuleFromTransaction(txn)}
                        >
                          Create Rule
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
                Close
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
                Select Target Category
              </Typography>
            </MenuItem>
            <Divider />
            {categories.map((rootCategory) => {
              const renderCategoryMenuItem = (cat: CategoryDefinition, depth: number = 0): JSX.Element[] => {
                const items: JSX.Element[] = [];

                // Only show leaf categories (those without children) as options
                if (!cat.children || cat.children.length === 0) {
                  if (depth > 0) { // Don't show root categories as targets
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
                          primary={cat.name}
                          secondary={cat.name_en}
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

    return (
      <Box>
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            Add Categorization Rule
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Create rules to automatically categorize transactions based on merchant names
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Merchant Pattern"
                value={newRule.name_pattern || ''}
                onChange={(e) => setNewRule({ ...newRule, name_pattern: e.target.value })}
                placeholder="e.g., 'starbucks' or 'interactive broker'"
                size="small"
                helperText={
                  newRulePreview
                    ? `Will match ${newRulePreview.totalCount} transaction${newRulePreview.totalCount !== 1 ? 's' : ''}`
                    : "Pattern to match in transaction name (case-insensitive)"
                }
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={newRuleType}
                  label="Type"
                  onChange={(e) => {
                    setNewRuleType(e.target.value as CategoryType);
                    setNewRuleParentId(null);
                    setNewRuleCategoryId(null);
                  }}
                >
                  <MenuItem value="expense">Expense</MenuItem>
                  <MenuItem value="investment">Investment</MenuItem>
                  <MenuItem value="income">Income</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Category</InputLabel>
                <Select
                  value={newRuleParentId ?? ''}
                  label="Category"
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewRuleParentId(value === '' ? null : Number(value));
                    setNewRuleCategoryId(null);
                  }}
                >
                  <MenuItem value="">Select category</MenuItem>
                  {parentOptions.map((parent: CategoryDefinition) => (
                    <MenuItem key={parent.id} value={parent.id}>
                      {parent.name} {parent.name_en ? `(${parent.name_en})` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small" disabled={!newRuleParentId || childOptions.length === 0}>
                <InputLabel>Subcategory (Optional)</InputLabel>
                <Select
                  value={subcategoryValue}
                  label="Subcategory (Optional)"
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewRuleCategoryId(value === '' ? null : Number(value));
                  }}
                  displayEmpty
                >
                  <MenuItem value="">None</MenuItem>
                  {childOptions.map((child: CategoryDefinition) => (
                    <MenuItem key={child.id} value={child.id}>
                      {child.name} {child.name_en ? `(${child.name_en})` : ''}
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
                Add
              </Button>
            </Grid>
          </Grid>

          {/* New Rule Preview */}
          {newRulePreview && newRulePreview.totalCount > 0 && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="info" sx={{ mb: 1 }}>
                <Typography variant="body2" fontWeight="bold" gutterBottom>
                  Preview: {newRulePreview.totalCount} transaction{newRulePreview.totalCount !== 1 ? 's' : ''} will be affected
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
                      ...and {newRulePreview.totalCount - 5} more
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
              Apply Rules to Existing Transactions
            </Button>
          </Box>
        </Paper>

        {/* Rules List */}
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          Active Rules ({rules.length})
        </Typography>
        {rules.length === 0 ? (
          <Alert severity="info">
            No rules created yet. Add your first rule above to automatically categorize transactions.
          </Alert>
        ) : (
          <Grid container spacing={2}>
            {rules.map(rule => {
              const transactionCount = ruleTransactionCounts.get(rule.id) || 0;
              const isExpanded = expandedRuleId === rule.id;
              const previewData = rulePreviewData.get(rule.id);

              return (
                <Grid item xs={12} key={rule.id}>
                  <Card variant="outlined">
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box display="flex" alignItems="center" justifyContent="space-between">
                        <Box flex={1}>
                          <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                            <Typography variant="body2" fontWeight="medium">
                              IF transaction contains "<strong>{rule.name_pattern}</strong>"
                            </Typography>
                            <Chip
                              label={`${transactionCount} txn${transactionCount !== 1 ? 's' : ''}`}
                              size="small"
                              color={transactionCount > 0 ? 'primary' : 'default'}
                              variant="outlined"
                            />
                          </Box>
                          <Typography variant="body2" color="text.secondary">
                            THEN categorize as: {rule.target_category || rule.parent_category}
                            {rule.subcategory && ` › ${rule.subcategory}`}
                          </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Chip
                            label={rule.is_active ? 'Active' : 'Inactive'}
                            size="small"
                            color={rule.is_active ? 'success' : 'default'}
                          />
                          <Tooltip title={transactionCount > 0 ? 'View matching transactions' : 'No transactions match this pattern'}>
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
                            title={rule.is_active ? 'Deactivate rule' : 'Activate rule'}
                          >
                            {rule.is_active ? <ToggleOnIcon color="success" /> : <ToggleOffIcon />}
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteRule(rule.id)}
                            title="Delete rule"
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
                              Matching Transactions (showing up to 20):
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
                                ...and {previewData.totalCount - previewData.matchedTransactions.length} more
                              </Typography>
                            )}
                          </Box>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            No matching transactions found
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
    setEditingRule(null);
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
      <ModalHeader title="Category Hierarchy" onClose={handleClose} />

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
          <Tab label="Category Hierarchy" />
          <Tab label="Pattern Rules" />
        </Tabs>

        {activeTab === 0 && renderHierarchyTab()}
        {activeTab === 1 && renderPatternRulesTab()}
      </DialogContent>

      <DialogActions style={{ padding: '16px 24px 24px 24px' }}>
        <Button onClick={handleClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CategoryHierarchyModal;
