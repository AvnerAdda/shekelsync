import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  MenuItem,
  Select,
  Typography,
  Button,
  alpha,
} from '@mui/material';
import {
  Close as CloseIcon,
  SwapHoriz as SwapHorizIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { resolveLocalizedCategoryName } from '@renderer/shared/modals/category-hierarchy-helpers';
import type {
  SpendingAllocation,
  SpendingCategory,
  SpendingCategoryTransactionItem,
  SpendingCategoryTransactionsResponse,
} from '@renderer/types/spending-categories';

interface Props {
  open: boolean;
  onClose: () => void;
  spendingCategory: SpendingAllocation | null;
  categoryLabel: string;
  timeRangeLabel: string;
  periodStart: string;
  periodEnd: string;
  onDataChanged: () => void;
}

interface HierarchyCategory {
  id: number;
  name: string;
  name_en?: string;
  name_fr?: string;
  parent_id: number | null;
  category_type: string;
}

interface HierarchyResponse {
  categories: HierarchyCategory[];
}

interface CategoryGroup {
  categoryDefinitionId: number | null;
  categoryName: string;
  transactions: SpendingCategoryTransactionItem[];
  totalAmount: number;
}

const ALLOCATION_BUCKETS: SpendingCategory[] = ['essential', 'growth', 'stability', 'reward'];

const SpendingCategoryTransactionsModal: React.FC<Props> = ({
  open,
  onClose,
  spendingCategory,
  categoryLabel,
  timeRangeLabel,
  periodStart,
  periodEnd,
  onDataChanged,
}) => {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.spendingChart' });
  const { formatCurrency } = useFinancePrivacy();

  const [transactions, setTransactions] = useState<SpendingCategoryTransactionItem[]>([]);
  const [meta, setMeta] = useState({ totalCount: 0, totalAmount: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reassign transaction dialog state
  const [reassignTxn, setReassignTxn] = useState<SpendingCategoryTransactionItem | null>(null);
  const [allCategories, setAllCategories] = useState<HierarchyCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | ''>('');
  const [applyToAll, setApplyToAll] = useState(true);
  const [reassigning, setReassigning] = useState(false);

  // Category move loading state
  const [movingCategoryId, setMovingCategoryId] = useState<number | null>(null);

  const locale = (i18n.language || 'en') as 'he' | 'en' | 'fr';

  const fetchTransactions = async () => {
    if (!spendingCategory || !periodStart || !periodEnd) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        spendingCategory,
        startDate: periodStart,
        endDate: periodEnd,
        limit: '500',
      });
      const response = await apiClient.get(`/api/spending-categories/transactions?${params.toString()}`);
      if (!response.ok) {
        throw new Error(t('transactionModal.loadError'));
      }

      const data = response.data as SpendingCategoryTransactionsResponse;
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
      setMeta({
        totalCount: Number(data.total_count || 0),
        totalAmount: Number(data.total_amount || 0),
      });
    } catch (err) {
      console.error('Failed to load spending category transactions:', err);
      setError(err instanceof Error ? err.message : t('transactionModal.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && spendingCategory) {
      void fetchTransactions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spendingCategory, periodStart, periodEnd]);

  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const groupMap = new Map<number | 'uncategorized', CategoryGroup>();

    for (const txn of transactions) {
      const key = txn.category_definition_id ?? 'uncategorized';
      let group = groupMap.get(key);
      if (!group) {
        group = {
          categoryDefinitionId: txn.category_definition_id,
          categoryName: resolveLocalizedCategoryName(
            {
              category_name: txn.category_name,
              category_name_en: txn.category_name_en,
              category_name_fr: txn.category_name_fr,
            },
            locale,
          ) || t('transactionModal.unknown'),
          transactions: [],
          totalAmount: 0,
        };
        groupMap.set(key, group);
      }
      group.transactions.push(txn);
      group.totalAmount += Math.abs(txn.price);
    }

    return Array.from(groupMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [transactions, locale, t]);

  const formatTransactionDate = (dateValue: string): string => {
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
      return dateValue;
    }
    return parsed.toLocaleDateString(i18n.language || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Category allocation move
  const handleMoveCategoryToBucket = async (categoryDefinitionId: number, newBucket: SpendingCategory) => {
    setMovingCategoryId(categoryDefinitionId);
    try {
      const response = await apiClient.put(`/api/spending-categories/mapping/${categoryDefinitionId}`, {
        spendingCategory: newBucket,
      });
      if (!response.ok) {
        throw new Error(t('transactionModal.moveCategoryError'));
      }
      // Remove those transactions from the list
      setTransactions(prev => prev.filter(txn => txn.category_definition_id !== categoryDefinitionId));
      setMeta(prev => {
        const removed = categoryGroups.find(g => g.categoryDefinitionId === categoryDefinitionId);
        const removedAmount = removed?.totalAmount ?? 0;
        const removedCount = removed?.transactions.length ?? 0;
        return {
          totalCount: prev.totalCount - removedCount,
          totalAmount: prev.totalAmount - removedAmount,
        };
      });
      onDataChanged();
    } catch (err) {
      console.error('Failed to move category:', err);
    } finally {
      setMovingCategoryId(null);
    }
  };

  // Open reassign dialog
  const openReassignDialog = async (txn: SpendingCategoryTransactionItem) => {
    setReassignTxn(txn);
    setSelectedCategoryId(txn.category_definition_id || '');
    setApplyToAll(true);
    setReassigning(false);

    if (allCategories.length === 0) {
      try {
        const response = await apiClient.get('/api/categories/hierarchy');
        if (response.ok) {
          const data = response.data as HierarchyResponse;
          setAllCategories(data.categories || []);
        }
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      }
    }
  };

  const closeReassignDialog = () => {
    setReassignTxn(null);
  };

  const handleReassign = async () => {
    if (!reassignTxn || !selectedCategoryId) return;

    setReassigning(true);
    try {
      if (applyToAll) {
        const response = await apiClient.post('/api/categorization_rules/auto-create', {
          transactionName: reassignTxn.name || reassignTxn.vendor,
          categoryDefinitionId: selectedCategoryId,
          categoryType: reassignTxn.category_type || 'expense',
        });
        if (!response.ok) {
          throw new Error('Failed to create rule');
        }
      } else {
        const response = await apiClient.put(`/api/transactions/${reassignTxn.identifier}`, {
          category_definition_id: selectedCategoryId,
          category_type: reassignTxn.category_type || 'expense',
        });
        if (!response.ok) {
          throw new Error('Failed to update transaction');
        }
      }

      closeReassignDialog();
      await fetchTransactions();
      onDataChanged();
    } catch (err) {
      console.error('Failed to reassign transaction:', err);
    } finally {
      setReassigning(false);
    }
  };

  // Build grouped category options for Select
  const categoryOptions = useMemo(() => {
    const parents = allCategories.filter(c => c.parent_id === null);
    const children = allCategories.filter(c => c.parent_id !== null);

    const groups: { parent: HierarchyCategory; children: HierarchyCategory[] }[] = [];
    for (const parent of parents) {
      const kids = children.filter(c => c.parent_id === parent.id);
      if (kids.length > 0) {
        groups.push({ parent, children: kids });
      }
    }

    // Also include categories without children as top-level options
    const childIds = new Set(children.map(c => c.id));
    const parentIds = new Set(parents.filter(p => children.some(c => c.parent_id === p.id)).map(p => p.id));
    const standalone = allCategories.filter(c => !childIds.has(c.id) && !parentIds.has(c.id));

    return { groups, standalone };
  }, [allCategories]);

  const resolveCatName = (cat: HierarchyCategory) =>
    resolveLocalizedCategoryName(
      { name: cat.name, name_en: cat.name_en, name_fr: cat.name_fr },
      locale,
    ) || cat.name;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ pr: 6 }}>
          {t('transactionModal.title', {
            category: categoryLabel,
            range: timeRangeLabel,
          })}
          <IconButton
            aria-label={t('transactionModal.close')}
            onClick={onClose}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : transactions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('transactionModal.empty')}
            </Typography>
          ) : (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  {t('transactionModal.count', { count: meta.totalCount })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('transactionModal.total', {
                    amount: formatCurrency(meta.totalAmount, {
                      absolute: true,
                      maximumFractionDigits: 0,
                    }),
                  })}
                </Typography>
              </Box>
              <List dense disablePadding>
                {categoryGroups.map((group) => (
                  <React.Fragment key={group.categoryDefinitionId ?? 'uncategorized'}>
                    {/* Category group header */}
                    <ListSubheader
                      disableSticky
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        bgcolor: (theme) => alpha(theme.palette.action.hover, 0.04),
                        borderRadius: 1,
                        mt: 1,
                        py: 0.5,
                        px: 1.5,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {group.categoryName}
                        </Typography>
                        <Chip
                          size="small"
                          label={t('transactionModal.count', { count: group.transactions.length })}
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {formatCurrency(group.totalAmount, { absolute: true, maximumFractionDigits: 0 })}
                        </Typography>
                      </Box>
                      {group.categoryDefinitionId != null && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            {t('transactionModal.moveTo')}
                          </Typography>
                          <Select
                            size="small"
                            value={spendingCategory === 'unallocated' ? '' : spendingCategory ?? ''}
                            disabled={movingCategoryId === group.categoryDefinitionId}
                            onChange={(e) => {
                              const newBucket = e.target.value as SpendingCategory;
                              if (newBucket && newBucket !== spendingCategory) {
                                void handleMoveCategoryToBucket(group.categoryDefinitionId!, newBucket);
                              }
                            }}
                            sx={{ minWidth: 120, height: 28, fontSize: '0.75rem' }}
                            displayEmpty
                            renderValue={(value) => {
                              if (!value) return <em>{t('transactionModal.selectBucket')}</em>;
                              return t(`categories.${value}`, { defaultValue: value });
                            }}
                          >
                            {ALLOCATION_BUCKETS.filter(b => b !== spendingCategory).map(bucket => (
                              <MenuItem key={bucket} value={bucket} sx={{ fontSize: '0.8rem' }}>
                                {t(`categories.${bucket}`, { defaultValue: bucket })}
                              </MenuItem>
                            ))}
                          </Select>
                          {movingCategoryId === group.categoryDefinitionId && (
                            <CircularProgress size={16} />
                          )}
                        </Box>
                      )}
                    </ListSubheader>

                    {/* Transactions in this group */}
                    {group.transactions.map((transaction, index) => (
                      <React.Fragment key={`${transaction.identifier}-${transaction.vendor}-${index}`}>
                        <ListItem
                          sx={{ px: 1, py: 0.75 }}
                          secondaryAction={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="body2" fontWeight={700}>
                                {formatCurrency(Math.abs(transaction.price), { absolute: true, maximumFractionDigits: 0 })}
                              </Typography>
                              <IconButton
                                size="small"
                                onClick={() => void openReassignDialog(transaction)}
                                title={t('transactionModal.reassignTransaction')}
                              >
                                <SwapHorizIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          }
                        >
                          <ListItemText
                            primary={transaction.name || transaction.vendor || t('transactionModal.unknown')}
                            secondary={
                              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                                <span>
                                  {transaction.vendor || t('transactionModal.unknownVendor')}
                                  {' \u2022 '}
                                  {formatTransactionDate(transaction.date)}
                                </span>
                                {transaction.category_name && (
                                  <Chip
                                    size="small"
                                    label={resolveLocalizedCategoryName(
                                      {
                                        category_name: transaction.category_name,
                                        category_name_en: transaction.category_name_en,
                                        category_name_fr: transaction.category_name_fr,
                                      },
                                      locale,
                                    )}
                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                    variant="outlined"
                                  />
                                )}
                              </Box>
                            }
                            secondaryTypographyProps={{ component: 'div' }}
                          />
                        </ListItem>
                        {index < group.transactions.length - 1 && <Divider variant="inset" />}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </List>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Reassign transaction dialog */}
      <Dialog
        open={Boolean(reassignTxn)}
        onClose={closeReassignDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('transactionModal.reassignDialogTitle')}</DialogTitle>
        <DialogContent>
          {reassignTxn && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {reassignTxn.name || reassignTxn.vendor}
              </Typography>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  {t('transactionModal.assignToCategory')}
                </Typography>
                <Select
                  fullWidth
                  size="small"
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value as number)}
                  displayEmpty
                  renderValue={(value) => {
                    if (!value) return <em>{t('transactionModal.selectCategory')}</em>;
                    const cat = allCategories.find(c => c.id === value);
                    return cat ? resolveCatName(cat) : String(value);
                  }}
                >
                  {categoryOptions.groups.map(({ parent, children }) => [
                    <ListSubheader key={`header-${parent.id}`} sx={{ fontSize: '0.75rem', fontWeight: 700 }}>
                      {resolveCatName(parent)}
                    </ListSubheader>,
                    ...children.map(child => (
                      <MenuItem key={child.id} value={child.id} sx={{ pl: 4, fontSize: '0.85rem' }}>
                        {resolveCatName(child)}
                      </MenuItem>
                    )),
                  ])}
                  {categoryOptions.standalone.map(cat => (
                    <MenuItem key={cat.id} value={cat.id} sx={{ fontSize: '0.85rem' }}>
                      {resolveCatName(cat)}
                    </MenuItem>
                  ))}
                </Select>
              </Box>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={applyToAll}
                    onChange={(e) => setApplyToAll(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">
                      {t('transactionModal.applyToAll')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('transactionModal.applyToAllHint')}
                    </Typography>
                  </Box>
                }
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeReassignDialog} disabled={reassigning}>
            {t('transactionModal.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleReassign()}
            disabled={reassigning || !selectedCategoryId}
          >
            {reassigning ? t('transactionModal.reassigning') : t('transactionModal.reassign')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SpendingCategoryTransactionsModal;
