import React from 'react';
import AddIcon from '@mui/icons-material/Add';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PostAddOutlinedIcon from '@mui/icons-material/PostAddOutlined';
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import type {
  InvestmentCategoryKey,
  InvestmentPosition,
  PortfolioSummary,
} from '@renderer/types/investments';
import { resolvePortfolioInstitutionName } from './portfolio-breakdown-helpers';
import PositionActivityDialog from './PositionActivityDialog';
import PositionCloseDialog from './PositionCloseDialog';
import PositionEditorDialog from './PositionEditorDialog';
import {
  buildHybridHoldingsPositionRows,
  filterHybridHoldingsPositionRows,
  type InvestmentHoldingsRowFilter,
} from '../utils/holdings-positions';
import { getPortfolioCategoryBuckets } from '../utils/portfolio-categories';

export interface HoldingsPositionsSectionProps {
  portfolioData: PortfolioSummary | null;
  positions: InvestmentPosition[];
  loading: boolean;
  onChanged?: () => void | Promise<void>;
}

const HoldingsPositionsSection: React.FC<HoldingsPositionsSectionProps> = ({
  portfolioData,
  positions,
  loading,
  onChanged,
}) => {
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'investmentsPage.holdings' });
  const { t: tRoot } = useTranslation('translation');
  const locale = i18n.language;
  const [search, setSearch] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState<'all' | InvestmentCategoryKey>('all');
  const [rowKindFilter, setRowKindFilter] = React.useState<InvestmentHoldingsRowFilter>('all');
  const [editingPosition, setEditingPosition] = React.useState<'new' | InvestmentPosition | null>(null);
  const [activityPosition, setActivityPosition] = React.useState<InvestmentPosition | null>(null);
  const [closingPosition, setClosingPosition] = React.useState<InvestmentPosition | null>(null);

  const accounts = portfolioData?.accounts || [];
  const categoryOptions = React.useMemo(() => {
    if (!portfolioData) return [];

    return getPortfolioCategoryBuckets(portfolioData)
      .filter(({ bucket }) => (bucket.accounts?.length || 0) > 0)
      .map(({ key }) => key);
  }, [portfolioData]);

  const rows = React.useMemo(() => {
    const hybridRows = buildHybridHoldingsPositionRows(portfolioData, positions);
    return filterHybridHoldingsPositionRows(hybridRows, {
      search,
      category: categoryFilter,
      rowKind: rowKindFilter,
    });
  }, [categoryFilter, portfolioData, positions, rowKindFilter, search]);

  const formatCurrencyValue = React.useCallback((
    value: number | null,
    currency: string | null,
    absolute = true,
    maximumFractionDigits = 0,
  ) => {
    if (value === null) return t('table.notAvailable', '—');
    if (maskAmounts) return '***';

    const normalizedCurrency = String(currency || 'ILS').toUpperCase();
    return formatCurrency(value, {
      absolute,
      maximumFractionDigits,
      currencySymbol: normalizedCurrency === 'ILS' ? '₪' : `${normalizedCurrency} `,
    });
  }, [formatCurrency, maskAmounts, t]);

  const formatUnits = React.useCallback((value: number | null | undefined) => {
    if (value === null || value === undefined) return null;
    if (maskAmounts) return '***';
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
  }, [locale, maskAmounts]);

  const formatDate = React.useCallback((value: string | null) => {
    if (!value) return t('table.notAvailable', '—');
    return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [t]);

  const notifyChanged = React.useCallback(async () => {
    if (onChanged) {
      await onChanged();
      return;
    }
    window.dispatchEvent(new CustomEvent('dataRefresh'));
  }, [onChanged]);

  const rowName = React.useCallback((row: (typeof rows)[number]) => {
    if (row.reconciliationState === 'remainder') {
      return t('reconciliation.remainder', 'Reconciliation remainder');
    }
    if (row.reconciliationState === 'unavailable') {
      return t('reconciliation.unavailable', 'Reconciliation unavailable');
    }
    return row.name;
  }, [rows, t]);

  if (loading) {
    return (
      <Paper sx={{ p: 2.5 }}>
        <Skeleton variant="text" width={220} height={28} />
        <Skeleton variant="text" width={340} height={20} sx={{ mb: 2 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr' }, gap: 1.5, mb: 2 }}>
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={40} />
        </Box>
        <Skeleton variant="rounded" height={320} />
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('subtitle')}</Typography>
        </Box>
        <Tooltip
          title={accounts.length === 0
            ? t('actions.addDisabled', 'Create an investment account before adding a holding')
            : ''}
        >
          <span>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              disabled={accounts.length === 0}
              onClick={() => setEditingPosition('new')}
            >
              {t('actions.add', 'Add holding')}
            </Button>
          </span>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr' }, gap: 1.5 }}>
        <TextField
          size="small"
          label={t('filters.searchLabel')}
          placeholder={t('filters.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <TextField
          select
          size="small"
          label={t('filters.categoryLabel')}
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value as 'all' | InvestmentCategoryKey)}
        >
          <MenuItem value="all">{t('filters.allCategories')}</MenuItem>
          {categoryOptions.map((category) => (
            <MenuItem key={category} value={category}>
              {tRoot(`investmentsPage.balanceSheet.buckets.${category}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('filters.rowTypeLabel')}
          value={rowKindFilter}
          onChange={(event) => setRowKindFilter(event.target.value as InvestmentHoldingsRowFilter)}
        >
          <MenuItem value="all">{t('filters.rowTypeAll')}</MenuItem>
          <MenuItem value="position">{t('filters.rowTypePositions')}</MenuItem>
          <MenuItem value="holding">{t('filters.rowTypeHoldings')}</MenuItem>
          <MenuItem value="reconciliation">{t('filters.rowTypeReconciliation', 'Reconciliation')}</MenuItem>
        </TextField>
      </Box>
      {rows.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('empty')}</Typography>
        </Box>
      ) : (
        <TableContainer sx={{ maxHeight: 460 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('table.name')}</TableCell>
                <TableCell>{t('table.rowType')}</TableCell>
                <TableCell>{t('table.category')}</TableCell>
                <TableCell>{t('table.account')}</TableCell>
                <TableCell>{t('table.itemType')}</TableCell>
                <TableCell>{t('table.currency')}</TableCell>
                <TableCell align="right">{t('table.currentValue')}</TableCell>
                <TableCell align="right">{t('table.costBasis')}</TableCell>
                <TableCell align="right">{t('table.unrealizedPnL')}</TableCell>
                <TableCell>{t('table.date')}</TableCell>
                <TableCell align="right">{t('table.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const units = formatUnits(row.units);
                return (
                  <TableRow
                    key={row.rowId}
                    hover
                    sx={row.rowKind === 'reconciliation'
                      ? { '& td': { bgcolor: 'action.hover' } }
                      : undefined}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{rowName(row)}</Typography>
                      {row.rowKind === 'position' && (row.symbol || units !== null) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {[row.symbol, units === null
                            ? null
                            : t('table.unitsValue', '{{units}} units', { units })]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      )}
                      {row.rowKind === 'reconciliation' && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {row.reconciliationState === 'remainder'
                            ? t('reconciliation.help', 'Account snapshot minus tracked items')
                            : row.reconciliationReason === 'currency_mismatch'
                              ? t('reconciliation.currencyMismatch', 'Items use currencies that cannot be added directly')
                              : t('reconciliation.missingValues', 'Value one or more items to calculate the remainder')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={row.rowKind === 'position'
                            ? t('rowKind.position')
                            : row.rowKind === 'reconciliation'
                              ? t('rowKind.reconciliation', 'Reconciliation')
                              : t('rowKind.holding')}
                          color={row.rowKind === 'position'
                            ? 'primary'
                            : row.rowKind === 'reconciliation'
                              ? 'info'
                              : 'default'}
                          variant={row.rowKind === 'holding' ? 'outlined' : 'filled'}
                        />
                        {row.status === 'needs_valuation' && (
                          <Chip
                            size="small"
                            label={t('status.needsValuation')}
                            color="warning"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={tRoot(`investmentsPage.balanceSheet.buckets.${row.category}`)}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.accountName}</Typography>
                      {row.institution && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {resolvePortfolioInstitutionName(row.institution, locale)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {row.rowKind === 'reconciliation'
                          ? t('reconciliation.itemType', 'Unallocated snapshot value')
                          : t(`assetTypes.${row.itemType}`, row.itemType)}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.currency || t('table.notAvailable', '—')}</TableCell>
                    <TableCell align="right">
                      {formatCurrencyValue(
                        row.currentValue,
                        row.currency,
                        row.rowKind !== 'reconciliation',
                      )}
                      {row.currentPrice !== null && row.currentPrice !== undefined && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {t('table.priceValue', '{{price}} / unit', {
                            price: formatCurrencyValue(row.currentPrice, row.currency, true, 4),
                          })}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {formatCurrencyValue(
                        row.basisValue,
                        row.currency,
                        row.rowKind !== 'reconciliation',
                      )}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        color: row.unrealizedPnL === null
                          ? 'text.secondary'
                          : row.unrealizedPnL >= 0
                            ? 'success.main'
                            : 'error.main',
                      }}
                    >
                      {formatCurrencyValue(row.unrealizedPnL, row.currency, false)}
                    </TableCell>
                    <TableCell>{formatDate(row.displayDate)}</TableCell>
                    <TableCell align="right">
                      {row.position && (
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <Tooltip title={t('actions.activity', 'Add activity')}>
                            <IconButton
                              size="small"
                              aria-label={t('actions.activity', 'Add activity')}
                              onClick={() => setActivityPosition(row.position || null)}
                            >
                              <PostAddOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('actions.edit', 'Edit holding')}>
                            <IconButton
                              size="small"
                              aria-label={t('actions.edit', 'Edit holding')}
                              onClick={() => setEditingPosition(row.position || null)}
                            >
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('actions.close', 'Close holding')}>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={t('actions.close', 'Close holding')}
                              onClick={() => setClosingPosition(row.position || null)}
                            >
                              <ArchiveOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <PositionEditorDialog
        open={editingPosition !== null}
        accounts={accounts}
        position={editingPosition === 'new' ? null : editingPosition}
        onClose={() => setEditingPosition(null)}
        onSaved={notifyChanged}
      />
      <PositionActivityDialog
        open={Boolean(activityPosition)}
        position={activityPosition}
        onClose={() => setActivityPosition(null)}
        onSaved={notifyChanged}
      />
      <PositionCloseDialog
        position={closingPosition}
        onClose={() => setClosingPosition(null)}
        onClosed={notifyChanged}
      />
    </Paper>
  );
};

export default HoldingsPositionsSection;
