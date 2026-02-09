import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Chip,
  Autocomplete,
  CircularProgress,
  Divider,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Notes as NotesIcon,
  LocalOffer as TagIcon,
  ArrowUpward as IncomeIcon,
  ArrowDownward as ExpenseIcon,
  TrendingUp as InvestmentIcon,
  CalendarToday as CalendarIcon,
  Category as CategoryIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import ModalHeader from './ModalHeader';
import { apiClient } from '@/lib/api-client';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '../components/LicenseReadOnlyAlert';

export interface TransactionForModal {
  identifier: string;
  vendor: string;
  name: string;
  category_name: string | null;
  parent_name: string | null;
  category_definition_id: number | null;
  category_type: string | null;
  memo: string | null;
  tags: string[];
  price: number;
  date: string;
  processed_date: string | null;
  account_number: string | null;
  type: string | null;
  status: string | null;
}

interface TransactionDetailModalProps {
  open: boolean;
  onClose: () => void;
  transaction: TransactionForModal | null;
  onSave?: (transaction: TransactionForModal) => void;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  open,
  onClose,
  transaction,
  onSave,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [licenseError, setLicenseError] = useState<{ open: boolean; reason?: string }>({
    open: false,
  });

  // Load transaction data and all tags when modal opens
  useEffect(() => {
    if (open && transaction) {
      setMemo(transaction.memo || '');
      setTags(transaction.tags || []);
      fetchAllTags();
    }
  }, [open, transaction]);

  const fetchAllTags = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<string[]>('/api/transactions/tags');
      setAllTags(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = useCallback((newTag: string) => {
    const trimmedTag = newTag.trim().toLowerCase();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
    }
    setTagInput('');
  }, [tags]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  }, [tags]);

  const handleSave = async () => {
    if (!transaction) return;

    setSaving(true);
    try {
      const transactionId = `${transaction.identifier}|${transaction.vendor}`;
      await apiClient.put(`/api/transactions/${encodeURIComponent(transactionId)}`, {
        memo: memo || null,
        tags,
      });

      // Call onSave callback with updated transaction
      if (onSave) {
        onSave({
          ...transaction,
          memo: memo || null,
          tags,
        });
      }
      onClose();
    } catch (error: unknown) {
      console.error('Failed to save transaction:', error);
      // Check if this is a license read-only error
      const errorData = (error as { response?: { data?: unknown } })?.response?.data;
      const licenseCheck = isLicenseReadOnlyError(errorData);
      if (licenseCheck.isReadOnly) {
        setLicenseError({ open: true, reason: licenseCheck.reason });
      }
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
    }).format(Math.abs(price));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const getTransactionIcon = () => {
    if (!transaction) return null;
    const type = transaction.category_type || (transaction.price > 0 ? 'income' : 'expense');
    switch (type) {
      case 'income':
        return <IncomeIcon sx={{ color: theme.palette.success.main }} />;
      case 'investment':
        return <InvestmentIcon sx={{ color: theme.palette.info.main }} />;
      default:
        return <ExpenseIcon sx={{ color: theme.palette.error.main }} />;
    }
  };

  // Get suggestions for autocomplete (exclude already selected tags)
  const tagSuggestions = allTags.filter((tag) => !tags.includes(tag));

  const hasChanges = transaction && (
    (memo || '') !== (transaction.memo || '') ||
    JSON.stringify(tags) !== JSON.stringify(transaction.tags || [])
  );

  if (!transaction) return null;

  const categoryLabel =
    transaction.category_name && transaction.parent_name
      ? `${transaction.parent_name} › ${transaction.category_name}`
      : transaction.category_name || transaction.parent_name;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            backgroundColor: alpha(theme.palette.background.paper, 0.98),
            backdropFilter: 'blur(20px)',
          },
        }}
      >
        <ModalHeader
          title={t('transactionDetail.title', 'Transaction Details')}
          onClose={onClose}
        />

        <DialogContent sx={{ pt: 3 }}>
          {/* Transaction Info Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 2,
              mb: 3,
              p: 2,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.primary.main, 0.05),
            }}
          >
            <Box sx={{ pt: 0.5 }}>{getTransactionIcon()}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" fontWeight={600} noWrap>
                {transaction.name}
              </Typography>
              <Typography
                variant="h5"
                fontWeight={700}
                sx={{
                  color: transaction.price > 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                }}
              >
                {transaction.price > 0 ? '+' : '-'}{formatPrice(transaction.price)}
              </Typography>
            </Box>
          </Box>

          {/* Transaction Meta Info */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CalendarIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                {formatDate(transaction.date)}
              </Typography>
            </Box>
            {categoryLabel && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CategoryIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Chip
                  label={categoryLabel}
                  size="small"
                  sx={{
                    backgroundColor: alpha(theme.palette.primary.main, 0.1),
                    color: theme.palette.primary.main,
                  }}
                />
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Notes Section */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <NotesIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              <Typography variant="subtitle2" fontWeight={600}>
                {t('transactionDetail.notes', 'Notes')}
              </Typography>
            </Box>
            <TextField
              fullWidth
              multiline
              rows={3}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={t('transactionDetail.notesPlaceholder', 'Add notes about this transaction...')}
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  backgroundColor: alpha(theme.palette.text.primary, 0.02),
                },
              }}
            />
          </Box>

          {/* Tags Section */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <TagIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              <Typography variant="subtitle2" fontWeight={600}>
                {t('transactionDetail.tags', 'Tags')}
              </Typography>
            </Box>

            {/* Current Tags */}
            {tags.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    onDelete={() => handleRemoveTag(tag)}
                    sx={{
                      backgroundColor: alpha(theme.palette.secondary.main, 0.1),
                      color: theme.palette.secondary.main,
                      '& .MuiChip-deleteIcon': {
                        color: alpha(theme.palette.secondary.main, 0.6),
                        '&:hover': {
                          color: theme.palette.secondary.main,
                        },
                      },
                    }}
                  />
                ))}
              </Box>
            )}

            {/* Tag Input with Autocomplete */}
            <Autocomplete
              freeSolo
              options={tagSuggestions}
              inputValue={tagInput}
              onInputChange={(_event, newValue) => setTagInput(newValue)}
              onChange={(_event, newValue) => {
                if (typeof newValue === 'string' && newValue) {
                  handleAddTag(newValue);
                }
              }}
              loading={loading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder={t('transactionDetail.addTag', 'Add a tag...')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tagInput.trim()) {
                      e.preventDefault();
                      handleAddTag(tagInput);
                    }
                  }}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loading ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      backgroundColor: alpha(theme.palette.text.primary, 0.02),
                    },
                  }}
                />
              )}
              renderOption={(props, option) => (
                <li {...props}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TagIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="body2">{option}</Typography>
                  </Box>
                </li>
              )}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {t('transactionDetail.tagHint', 'Press Enter to add a tag')}
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} color="inherit">
            {t('transactionDetail.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={saving || !hasChanges}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
          >
            {t('transactionDetail.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      <LicenseReadOnlyAlert
        open={licenseError.open}
        onClose={() => setLicenseError({ open: false })}
        reason={licenseError.reason}
      />
    </>
  );
};

export default TransactionDetailModal;
