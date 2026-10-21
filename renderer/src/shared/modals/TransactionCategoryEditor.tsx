import { useEffect, useId, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient, invalidateApiCache } from '@renderer/lib/api-client';
import {
  CATEGORY_UPDATED_EVENT, OPEN_CATEGORY_EDITOR_EVENT, type TransactionCategoryReference,
} from '../components/EditTransactionCategoryButton';
import type { TransactionForModal } from './TransactionDetailModal';
import { resolveLocalizedCategoryName } from './category-hierarchy-helpers';

interface Category {
  id: number;
  name: string;
  name_en?: string;
  name_fr?: string;
  parent_id: number | null;
  category_type: string;
}

function EditorDialog({ reference, onClose }: { reference: TransactionCategoryReference; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [transaction, setTransaction] = useState<TransactionForModal | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Category | null>(null);
  const [applyRule, setApplyRule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const transactionUrl = `/api/transactions/${encodeURIComponent(`${reference.identifier}|${reference.vendor}`)}`;
  const locale = i18n.language?.startsWith('he') ? 'he' : i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const byId = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const categoryLabel = (category: Category) => {
    const names: string[] = [];
    const visited = new Set<number>();
    let current: Category | undefined = category;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      names.unshift(resolveLocalizedCategoryName(current, locale));
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return names.join(' › ');
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      apiClient.get<TransactionForModal>(transactionUrl, { cacheMode: 'no-store' }),
      apiClient.get<{ categories: Category[] }>('/api/categories/hierarchy', { cacheMode: 'no-store' }),
    ]).then(([transactionResponse, categoryResponse]) => {
      if (cancelled) return;
      if (!transactionResponse.ok || !transactionResponse.data || !categoryResponse.ok || !Array.isArray(categoryResponse.data?.categories)) {
        throw new Error('Unable to load category editor');
      }
      const options = categoryResponse.data.categories;
      setTransaction(transactionResponse.data);
      setCategories(options);
      setSelected(options.find(category => category.id === transactionResponse.data.category_definition_id) || null);
    }).catch(() => {
      if (!cancelled) setError(t('transactionCategoryEditor.loadError', 'Could not load the transaction and categories. Please try again.'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [transactionUrl, loadAttempt, t]);

  const save = async () => {
    if (!transaction || !selected || saving) return;
    setSaving(true);
    setError('');
    let transactionSaved = false;
    const updated = {
      ...transaction,
      category_definition_id: selected.id,
      category_type: selected.category_type,
      category_name: resolveLocalizedCategoryName(selected, locale),
      parent_name: resolveLocalizedCategoryName(byId.get(selected.parent_id ?? -1), locale) || null,
    };
    try {
      const response = await apiClient.put(transactionUrl, {
        category_definition_id: selected.id,
        category_type: selected.category_type,
        auto_categorized: false,
        confidence_score: 1,
      });
      if (!response.ok) throw new Error('Transaction update failed');
      transactionSaved = true;
      if (applyRule) {
        const ruleResponse = await apiClient.post('/api/categorization_rules/auto-create', {
          transactionName: transaction.name,
          categoryDefinitionId: selected.id,
          categoryType: selected.category_type,
        });
        if (!ruleResponse.ok) throw new Error('Rule update failed');
      }
      onClose();
    } catch {
      setError(transactionSaved
        ? t('transactionCategoryEditor.ruleError', 'The transaction was updated, but the rule could not be saved. Try again to save the rule.')
        : t('transactionCategoryEditor.saveError', 'Could not update the category. Please try again.'));
    } finally {
      if (transactionSaved) {
        invalidateApiCache();
        window.dispatchEvent(new CustomEvent(CATEGORY_UPDATED_EVENT, { detail: updated }));
        window.dispatchEvent(new Event('dataRefresh'));
      }
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby={titleId} sx={{ zIndex: theme => theme.zIndex.modal + 2 }}>
      <DialogTitle id={titleId}>{t('transactionCategoryEditor.title', 'Edit category')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading ? <CircularProgress size={24} /> : transaction ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography>{transaction.name || transaction.vendor}</Typography>
            <Autocomplete
              options={categories}
              value={selected}
              disabled={saving}
              disablePortal
              getOptionLabel={categoryLabel}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              onChange={(_event, value) => setSelected(value)}
              renderInput={params => <TextField {...params} label={t('transactionCategoryEditor.category', 'Category')} />}
            />
            <Typography variant="body2" color="text.secondary">
              {t('transactionCategoryEditor.singleHint', 'Only this transaction will change unless you enable the rule below.')}
            </Typography>
            <FormControlLabel
              control={<Checkbox checked={applyRule} disabled={saving || !transaction.name?.trim()} onChange={event => setApplyRule(event.target.checked)} />}
              label={t('transactionCategoryEditor.applyRule', 'Also create or update a rule for matching transaction names')}
            />
            {applyRule && <Alert severity="info">{t('transactionCategoryEditor.ruleHint', 'The rule applies to existing and future transactions whose names contain this transaction name. Income rules match positive amounts; expense rules match negative amounts.')}</Alert>}
          </Box>
        ) : <Button onClick={() => setLoadAttempt(value => value + 1)}>{t('transactionCategoryEditor.retry', 'Try again')}</Button>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('transactionCategoryEditor.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={loading || saving || !transaction || !selected}>
          {saving ? t('transactionCategoryEditor.saving', 'Saving…') : t('transactionCategoryEditor.save', 'Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A single host keeps the editor mounted even when a source list refreshes. */
export default function TransactionCategoryEditor() {
  const [reference, setReference] = useState<TransactionCategoryReference | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<TransactionCategoryReference>).detail;
      if (detail?.identifier && detail?.vendor) setReference(current => current || detail);
    };
    window.addEventListener(OPEN_CATEGORY_EDITOR_EVENT, open);
    return () => window.removeEventListener(OPEN_CATEGORY_EDITOR_EVENT, open);
  }, []);
  return reference ? <EditorDialog reference={reference} onClose={() => setReference(null)} /> : null;
}
