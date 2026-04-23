import React from 'react';
import {
  Box,
  Chip,
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
import {
  buildHybridHoldingsPositionRows,
  filterHybridHoldingsPositionRows,
  type InvestmentHoldingsRowFilter,
} from '../utils/holdings-positions';
import { getPortfolioCategoryBuckets } from '../utils/portfolio-categories';

interface HoldingsPositionsSectionProps {
  portfolioData: PortfolioSummary | null;
  positions: InvestmentPosition[];
  loading: boolean;
}

const HoldingsPositionsSection: React.FC<HoldingsPositionsSectionProps> = ({
  portfolioData,
  positions,
  loading,
}) => {
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'investmentsPage.holdings' });
  const { t: tRoot } = useTranslation('translation');
  const locale = i18n.language;
  const [search, setSearch] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState<'all' | InvestmentCategoryKey>('all');
  const [rowKindFilter, setRowKindFilter] = React.useState<InvestmentHoldingsRowFilter>('all');

  const categoryOptions = React.useMemo(() => {
    if (!portfolioData) {
      return [];
    }

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

  const formatCurrencyValue = React.useCallback((value: number | null) => {
    if (value === null) {
      return t('table.notAvailable');
    }

    return maskAmounts
      ? '***'
      : formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });
  }, [formatCurrency, maskAmounts, t]);

  const formatDate = React.useCallback((value: string | null) => {
    if (!value) {
      return t('table.notAvailable');
    }

    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [t]);

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
      <Box>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('subtitle')}
        </Typography>
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
        </TextField>
      </Box>

      {rows.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('empty')}</Typography>
        </Box>
      ) : (
        <TableContainer sx={{ maxHeight: 420 }}>
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
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.rowId} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={row.rowKind === 'position' ? t('rowKind.position') : t('rowKind.holding')}
                        color={row.rowKind === 'position' ? 'primary' : 'default'}
                        variant={row.rowKind === 'position' ? 'filled' : 'outlined'}
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
                      <Typography variant="caption" color="text.secondary" display="block">
                        {resolvePortfolioInstitutionName(row.institution, locale)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.itemType}</Typography>
                  </TableCell>
                  <TableCell>{row.currency || t('table.notAvailable')}</TableCell>
                  <TableCell align="right">{formatCurrencyValue(row.currentValue)}</TableCell>
                  <TableCell align="right">{formatCurrencyValue(row.basisValue)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color:
                        row.unrealizedPnL === null
                          ? 'text.secondary'
                          : row.unrealizedPnL >= 0
                            ? 'success.main'
                            : 'error.main',
                    }}
                  >
                    {formatCurrencyValue(row.unrealizedPnL)}
                  </TableCell>
                  <TableCell>{formatDate(row.displayDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default HoldingsPositionsSection;
