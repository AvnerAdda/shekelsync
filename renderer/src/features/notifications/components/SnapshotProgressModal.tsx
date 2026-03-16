import React from 'react';
import { Alert, Box, Card, CardContent, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, Grid, IconButton, Stack, Typography } from '@mui/material';
import { ArrowDownward as DownIcon, ArrowUpward as UpIcon, Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import SpendComparisonBar from './SpendComparisonBar';

export interface SnapshotWindow {
  start: string;
  end: string;
  range?: string;
  income: number;
  expenses: number;
  investmentOutflow: number;
  investmentInflow: number;
  capitalReturns?: number;
  net: number;
  txCount: number;
}

export interface SnapshotPeriod {
  key: string;
  label: string;
  current: SnapshotWindow;
  previous: SnapshotWindow;
  spendDelta: number;
  spendDeltaPct: number | null;
  hasData: boolean;
}

export interface SnapshotSinceStart {
  startDate: string;
  endDate: string;
  daysTracked: number;
  income: number;
  expenses: number;
  investmentOutflow: number;
  investmentInflow: number;
  capitalReturns?: number;
  net: number;
  txCount: number;
}

export interface SnapshotProgressData {
  triggerKey: string;
  generatedAt: string;
  periods: SnapshotPeriod[];
  sinceStart: SnapshotSinceStart;
}

interface SnapshotProgressModalProps {
  open: boolean;
  onClose: () => void;
  data: SnapshotProgressData | null;
  loading: boolean;
  error: string | null;
}

function resolveLocale(language: string) {
  if (language?.startsWith('he')) return 'he-IL';
  if (language?.startsWith('fr')) return 'fr-FR';
  return 'en-US';
}

function parseSnapshotDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Keep date rendering stable for legacy timestamp payloads by parsing date-only.
  const datePrefixMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  const normalized = datePrefixMatch ? `${datePrefixMatch[1]}T00:00:00` : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

const SnapshotProgressModal: React.FC<SnapshotProgressModalProps> = ({ open, onClose, data, loading, error }) => {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0,
    }).format(value || 0);

  const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value || 0);

  const formatDateRange = (start: string | null | undefined, end: string | null | undefined) => {
    const formatter = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    const startDate = parseSnapshotDate(start);
    const endDate = parseSnapshotDate(end);
    if (!startDate || !endDate) {
      return t('insights.snapshot.modal.notAvailable');
    }

    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  };

  const formatDeltaPctStr = (value: number | null, isPositiveDelta: boolean) => {
    if (value === null) return t('insights.snapshot.modal.notAvailable');
    const positiveStr = t('insights.snapshot.modal.reductionBy', {
      pct: Math.abs(value).toFixed(1),
    });
    const negativeStr = t('insights.snapshot.modal.increasedBy', {
      pct: Math.abs(value).toFixed(1),
    });
    return isPositiveDelta ? positiveStr : negativeStr;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={false}
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      transitionDuration={0}
      PaperProps={{ sx: { height: '55vh', width: '85vw', maxWidth: '85vw' } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 1,
          px: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={600} component="span" role="heading" aria-level={2}>
          {t('insights.snapshot.modal.title')}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('common.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          display: 'flex',
          flexDirection: 'column',
          p: 1.5,
          overflow: 'auto',
        }}
      >
        {loading && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 6,
              gap: 2,
            }}
          >
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              {t('insights.snapshot.modal.loading')}
            </Typography>
          </Box>
        )}

        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && !data && <Alert severity="info">{t('insights.snapshot.modal.empty')}</Alert>}

        {!loading &&
          !error &&
          data &&
          (() => {
            const visiblePeriods = data.periods.filter((p) => p.hasData);

            return (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  gap: 1,
                }}
              >
                <Grid container spacing={1} sx={{ flex: 1 }}>
                  {visiblePeriods.map((period) => {
                    const periodLabel = t(`insights.snapshot.periodLabels.${period.key}`, period.label);
                    const positiveDelta = period.spendDelta >= 0;
                    const currentRange = period.current.range || formatDateRange(period.current.start, period.current.end);
                    const previousRange = period.previous.range || formatDateRange(period.previous.start, period.previous.end);
                    const previousMissing = period.previous.txCount === 0;

                    return (
                      <Grid size="grow" key={period.key} sx={{ display: 'flex' }}>
                        <Card variant="outlined" sx={{ flex: 1, display: 'flex' }}>
                          <CardContent
                            sx={{
                              flex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              p: 1,
                              '&:last-child': { pb: 1 },
                            }}
                          >
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.5}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {periodLabel}
                              </Typography>
                              <Chip
                                size="small"
                                color={positiveDelta ? 'success' : 'error'}
                                icon={positiveDelta ? <DownIcon sx={{ fontSize: 14 }} /> : <UpIcon sx={{ fontSize: 14 }} />}
                                label={formatDeltaPctStr(period.spendDeltaPct, positiveDelta)}
                                sx={{ height: 22, fontSize: '0.7rem' }}
                              />
                            </Stack>

                            <Box
                              sx={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                              }}
                            >
                              <SpendComparisonBar
                                previous={period.previous.expenses}
                                current={period.current.expenses}
                                formatCurrency={formatCurrency}
                                previousRange={previousRange}
                                currentRange={currentRange}
                              />
                            </Box>

                            {previousMissing && (
                              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                                {t('insights.snapshot.modal.insufficientHistory')}
                              </Typography>
                            )}
                          </CardContent>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>

                {visiblePeriods.length > 0 && <Divider />}

                <Card variant="outlined" sx={{ flexShrink: 0 }}>
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {t('insights.snapshot.periodLabels.sinceStart')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateRange(data.sinceStart.startDate, data.sinceStart.endDate)}
                        {' \u00b7 '}
                        {t('insights.snapshot.modal.daysTracked', {
                          count: data.sinceStart.daysTracked,
                        })}
                      </Typography>
                    </Stack>

                    <Grid container spacing={2}>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {t('insights.snapshot.metrics.totalSpend')}
                        </Typography>
                        <Typography variant="h6" fontWeight="bold">
                          {formatCurrency(data.sinceStart.expenses)}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {t('insights.snapshot.metrics.investmentOutflow')}
                        </Typography>
                        <Typography variant="h6" fontWeight="bold">
                          {formatCurrency(data.sinceStart.investmentOutflow)}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {t('insights.snapshot.metrics.investmentInflow')}
                        </Typography>
                        <Typography variant="h6" fontWeight="bold">
                          {formatCurrency(data.sinceStart.investmentInflow)}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {t('insights.snapshot.metrics.txCount')}
                        </Typography>
                        <Typography variant="h6">{formatCount(data.sinceStart.txCount)}</Typography>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Box>
            );
          })()}
      </DialogContent>
    </Dialog>
  );
};

export default SnapshotProgressModal;
