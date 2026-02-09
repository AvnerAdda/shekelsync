import React from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import {
  ArrowDownward as DownIcon,
  ArrowUpward as UpIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

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
  deltaNet: number;
  deltaNetPct: number | null;
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

const SnapshotProgressModal: React.FC<SnapshotProgressModalProps> = ({
  open,
  onClose,
  data,
  loading,
  error,
}) => {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0,
    }).format(value || 0);

  const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value || 0);

  const formatDateRange = (start: string, end: string) => {
    const formatter = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  };

  const formatDelta = (value: number) =>
    `${value >= 0 ? '+' : ''}${formatCurrency(value)}`;

  const formatDeltaPct = (value: number | null) => {
    if (value === null) return t('insights.snapshot.modal.notAvailable');
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      transitionDuration={0}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6">{t('insights.snapshot.modal.title')}</Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('common.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6, gap: 2 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              {t('insights.snapshot.modal.loading')}
            </Typography>
          </Box>
        )}

        {!loading && error && (
          <Alert severity="error">
            {error}
          </Alert>
        )}

        {!loading && !error && !data && (
          <Alert severity="info">
            {t('insights.snapshot.modal.empty')}
          </Alert>
        )}

        {!loading && !error && data && (
          <Stack spacing={2}>
            {data.periods.map((period) => {
              const periodLabel = t(`insights.snapshot.periodLabels.${period.key}`, period.label);
              const positiveDelta = period.deltaNet >= 0;
              const previousMissing = period.previous.txCount === 0;
              const currentRange = period.current.range || formatDateRange(period.current.start, period.current.end);
              const previousRange = period.previous.range || formatDateRange(period.previous.start, period.previous.end);

              return (
                <Card key={period.key} variant="outlined">
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {periodLabel}
                      </Typography>
                      <Chip
                        size="small"
                        color={positiveDelta ? 'success' : 'error'}
                        icon={positiveDelta ? <UpIcon /> : <DownIcon />}
                        label={`${formatDelta(period.deltaNet)} (${formatDeltaPct(period.deltaNetPct)})`}
                      />
                    </Stack>

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      {t('insights.snapshot.modal.currentPeriod')}: {currentRange}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      {t('insights.snapshot.modal.previousPeriod')}: {previousRange}
                    </Typography>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                      <Typography variant="body2">
                        {t('insights.snapshot.metrics.net')}: <strong>{formatCurrency(period.current.net)}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('insights.snapshot.modal.previousNet')}: {formatCurrency(period.previous.net)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('insights.snapshot.metrics.txCount')}: {formatCount(period.current.txCount)}
                      </Typography>
                    </Stack>

                    {previousMissing && (
                      <Alert severity="info" sx={{ mt: 1.5 }}>
                        {t('insights.snapshot.modal.insufficientHistory')}
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Divider />

            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  {t('insights.snapshot.periodLabels.sinceStart')}
                </Typography>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {formatDateRange(data.sinceStart.startDate, data.sinceStart.endDate)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  {t('insights.snapshot.modal.daysTracked', { count: data.sinceStart.daysTracked })}
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
                  <Typography variant="body2">
                    {t('insights.snapshot.metrics.income')}: <strong>{formatCurrency(data.sinceStart.income)}</strong>
                  </Typography>
                  <Typography variant="body2">
                    {t('insights.snapshot.metrics.expenses')}: <strong>{formatCurrency(data.sinceStart.expenses)}</strong>
                  </Typography>
                  <Typography variant="body2">
                    {t('insights.snapshot.metrics.investmentOutflow')}: <strong>{formatCurrency(data.sinceStart.investmentOutflow)}</strong>
                  </Typography>
                  <Typography variant="body2">
                    {t('insights.snapshot.metrics.investmentInflow')}: <strong>{formatCurrency(data.sinceStart.investmentInflow)}</strong>
                  </Typography>
                  <Typography variant="body2">
                    {t('insights.snapshot.metrics.net')}: <strong>{formatCurrency(data.sinceStart.net)}</strong>
                  </Typography>
                  <Typography variant="body2">
                    {t('insights.snapshot.metrics.txCount')}: <strong>{formatCount(data.sinceStart.txCount)}</strong>
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SnapshotProgressModal;
