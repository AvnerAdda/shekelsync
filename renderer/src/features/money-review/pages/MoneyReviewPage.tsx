import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Typography,
  Tooltip,
  alpha,
  useTheme,
} from '@mui/material';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import RefreshIcon from '@mui/icons-material/Refresh';
import SavingsIcon from '@mui/icons-material/Savings';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import LoadingState from '@renderer/components/LoadingState';
import LockedPagePlaceholder from '@renderer/shared/empty-state/LockedPagePlaceholder';
import { resolveOnboardingGate } from '@renderer/features/layout/components/onboarding-gate';
import MoneyReviewCard from '../components/MoneyReviewCard';
import MoneyReviewItemDetailDialog from '../components/MoneyReviewItemDetailDialog';
import { useMoneyReview } from '../hooks/useMoneyReview';
import { filterMoneyReviewItems, type MoneyReviewFilter } from '../review-helpers';
import type { MoneyReviewGroup, MoneyReviewResponse } from '../types';
import FinancialCorrectionsDialog from '@renderer/features/financial-truth/FinancialCorrectionsDialog';

type MoneyReviewGroupFilter = 'all' | MoneyReviewGroup;

const GROUP_ACCENTS: Record<MoneyReviewGroup, 'info.main' | 'warning.main' | 'secondary.main'> = {
  data: 'info.main',
  cash: 'warning.main',
  improve: 'secondary.main',
};

interface MoneyReviewPageProps {
  presentation?: 'page' | 'dialog';
  initialResponse?: MoneyReviewResponse | null;
  onClose?: () => void;
  onReviewChanged?: () => void;
}

const MoneyReviewPage: React.FC<MoneyReviewPageProps> = ({
  presentation = 'page',
  initialResponse = null,
  onClose,
  onReviewChanged,
}) => {
  const theme = useTheme();
  const isDialog = presentation === 'dialog';
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'moneyReview' });
  const { t: tRoot } = useTranslation('translation');
  const { formatCurrency } = useFinancePrivacy();
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const gate = resolveOnboardingGate(onboardingStatus, getPageAccessStatus, 'review');
  const [filter, setFilter] = useState<MoneyReviewFilter>('open');
  const [groupFilter, setGroupFilter] = useState<MoneyReviewGroupFilter>('all');
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<number | null>(null);
  const {
    response,
    loading,
    refreshing,
    error,
    updatingId,
    loadReview,
    updateStatus,
    performPrimaryAction,
  } = useMoneyReview({
    enabled: !gate.shouldBlockPageData,
    initialResponse,
    onExternalAction: isDialog ? onClose : undefined,
    onReviewChanged,
  });

  const statusItems = useMemo(
    () => filterMoneyReviewItems(response.items, filter),
    [filter, response.items],
  );
  const groupCounts = useMemo(() => statusItems.reduce<Record<MoneyReviewGroup, number>>(
    (counts, item) => ({ ...counts, [item.group]: counts[item.group] + 1 }),
    { data: 0, cash: 0, improve: 0 },
  ), [statusItems]);
  const visibleItems = useMemo(
    () => groupFilter === 'all'
      ? statusItems
      : statusItems.filter((item) => item.group === groupFilter),
    [groupFilter, statusItems],
  );
  const groupedItems = useMemo(() => (
    (['data', 'cash', 'improve'] as MoneyReviewGroup[])
      .map((group) => ({ group, items: visibleItems.filter((item) => item.group === group) }))
      .filter((entry) => entry.items.length > 0)
  ), [visibleItems]);
  const nextItem = useMemo(
    () => response.items.find((item) => ['active', 'accepted'].includes(item.status)) || null,
    [response.items],
  );
  const detailItem = useMemo(
    () => response.items.find((item) => item.id === detailItemId) || null,
    [detailItemId, response.items],
  );
  const generatedTime = useMemo(() => {
    if (!response.generatedAt) return '';
    const generatedAt = new Date(response.generatedAt);
    if (Number.isNaN(generatedAt.getTime())) return '';
    return new Intl.DateTimeFormat(i18n?.language || 'en', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(generatedAt);
  }, [i18n?.language, response.generatedAt]);
  const forecastAccuracy = response.forecastAccuracy;
  const forecastAccuracyLabel = forecastAccuracy
    ? t(`forecastAccuracy.${forecastAccuracy.readiness}`, {
      count: forecastAccuracy.observedDays,
      mape: forecastAccuracy.expenseMape == null ? '—' : Math.round(forecastAccuracy.expenseMape),
    })
    : null;
  const forecastAccuracyDetails = forecastAccuracy
    ? t('forecastAccuracy.details', {
      samples: forecastAccuracy.sampleCount,
      mae: forecastAccuracy.expenseMae == null ? '—' : formatCurrency(forecastAccuracy.expenseMae),
      coverage: forecastAccuracy.intervalCoverage == null ? '—' : `${Math.round(forecastAccuracy.intervalCoverage)}%`,
    })
    : '';

  const handleFilterChange = (_event: React.SyntheticEvent, value: MoneyReviewFilter) => {
    setFilter(value);
    setGroupFilter('all');
  };

  const handleReviewNext = useCallback(() => {
    if (!nextItem) return;
    setFilter('open');
    setGroupFilter('all');
    window.setTimeout(() => {
      const card = document.getElementById(`money-review-item-${nextItem.id}`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.focus({ preventScroll: true });
    }, 0);
  }, [nextItem]);

  if (gate.showLoading) return <LoadingState />;
  if (gate.isLocked) {
    return <LockedPagePlaceholder page="review" onboardingStatus={onboardingStatus} />;
  }

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', px: isDialog ? { xs: 1.5, sm: 2.5 } : { xs: 2, md: 4 }, py: isDialog ? { xs: 1.5, sm: 2.5 } : { xs: 2.5, md: 4 } }}>
      <Paper
        elevation={0}
        sx={{
          position: 'relative',
          overflow: 'hidden',
          p: isDialog ? { xs: 1.75, sm: 2.25 } : { xs: 2.25, md: 3 },
          mb: isDialog ? 2 : 3,
          borderRadius: isDialog ? 3 : 4,
          border: '1px solid',
          borderColor: alpha(theme.palette.primary.main, 0.18),
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.13)} 0%, ${alpha(theme.palette.background.paper, 0.96)} 52%, ${alpha(theme.palette.success.main, 0.08)} 100%)`,
          '&::after': {
            content: '""',
            position: 'absolute',
            width: 260,
            height: 260,
            insetInlineEnd: -120,
            top: -150,
            borderRadius: '50%',
            bgcolor: alpha(theme.palette.primary.main, 0.06),
            pointerEvents: 'none',
          },
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={isDialog ? 1.5 : 2.5}
          sx={{ position: 'relative', zIndex: 1, justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
        >
          <Stack direction="row" spacing={isDialog ? 1.25 : 2} sx={{ alignItems: 'flex-start' }}>
            <Box
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: isDialog ? 38 : 44,
                height: isDialog ? 38 : 44,
                flexShrink: 0,
                borderRadius: 3,
                color: 'primary.contrastText',
                background: `linear-gradient(145deg, ${theme.palette.primary.main}, ${theme.palette.success.dark})`,
                boxShadow: `0 10px 24px ${alpha(theme.palette.primary.main, 0.28)}`,
              }}
            >
              <AssignmentTurnedInIcon fontSize={isDialog ? 'small' : 'medium'} />
            </Box>
            <Box>
              {!isDialog && (
                <Typography variant="overline" color="primary.main" sx={{ fontWeight: 850, letterSpacing: '0.09em' }}>
                  {t('eyebrow')}
                </Typography>
              )}
              <Typography id="money-review-title" variant={isDialog ? 'h5' : 'h4'} component="h1" sx={{ fontWeight: 850, fontSize: isDialog ? { xs: '1.25rem', sm: '1.5rem' } : { xs: '1.75rem', md: '2rem' }, letterSpacing: '-0.025em' }}>
                {t('title')}
              </Typography>
              {!isDialog && (
                <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 720, lineHeight: 1.5 }}>
                  {t('subtitle')}
                </Typography>
              )}
            </Box>
          </Stack>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', alignSelf: { xs: 'stretch', md: 'flex-start' } }}>
            {forecastAccuracy && forecastAccuracyLabel && (
              <Tooltip title={forecastAccuracyDetails}>
                <Chip
                  size="small"
                  icon={<QueryStatsIcon />}
                  label={forecastAccuracyLabel}
                  color={forecastAccuracy.readiness === 'established'
                    ? (forecastAccuracy.expenseMape != null && forecastAccuracy.expenseMape > 35 ? 'warning' : 'success')
                    : forecastAccuracy.readiness === 'provisional' ? 'info' : 'default'}
                  variant="outlined"
                />
              </Tooltip>
            )}
            {generatedTime && (
              <Typography variant="caption" color="text.secondary" sx={{ flex: { xs: 1, md: 'initial' } }}>
                {t('updatedAt', { time: generatedTime })}
              </Typography>
            )}
            <Button
              variant="text"
              size="small"
              onClick={() => setCorrectionsOpen(true)}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {tRoot('financialTruth.correctionsTitle', { defaultValue: 'Your corrections' })}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={refreshing ? <CircularProgress size={15} /> : <RefreshIcon />}
              onClick={() => void loadReview(true)}
              disabled={refreshing}
              sx={{ bgcolor: alpha(theme.palette.background.paper, 0.62), whiteSpace: 'nowrap' }}
            >
              {t('actions.refresh')}
            </Button>
            {isDialog && (
              <Tooltip title={t('actions.close')}>
                <IconButton onClick={onClose} aria-label={t('actions.close')} size="small">
                  <CloseIcon />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>

        <Box
          sx={{
            position: 'relative',
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1.25fr 1fr', md: '1.35fr 1fr 1.15fr' },
            gap: isDialog ? 1 : 1.5,
            mt: isDialog ? 1.75 : 2.5,
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: isDialog ? 1.25 : 1.75,
              borderRadius: 3,
              color: 'primary.contrastText',
              bgcolor: 'primary.main',
              backgroundImage: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.success.dark})`,
            }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant={isDialog ? 'h5' : 'h4'} sx={{ fontWeight: 900, lineHeight: 1 }}>{response.summary.open}</Typography>
                <Typography variant="body2" sx={{ mt: 0.6, opacity: 0.86 }}>{t('summary.open')}</Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                color="inherit"
                endIcon={<ArrowForwardIcon sx={{ transform: theme.direction === 'rtl' ? 'scaleX(-1)' : 'none' }} />}
                disabled={!nextItem}
                onClick={handleReviewNext}
                sx={{ color: 'primary.main', bgcolor: 'common.white', whiteSpace: 'nowrap', '&:hover': { bgcolor: alpha(theme.palette.common.white, 0.9) } }}
              >
                {t('actions.reviewNext')}
              </Button>
            </Stack>
          </Paper>

          <Paper elevation={0} variant="outlined" sx={{ p: isDialog ? 1.25 : 1.75, borderRadius: 3, bgcolor: alpha(theme.palette.background.paper, 0.72) }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 2, color: 'info.main', bgcolor: alpha(theme.palette.info.main, 0.1) }}>
                <ScheduleIcon fontSize="small" />
              </Box>
              <Box>
                <Typography variant={isDialog ? 'h6' : 'h5'} sx={{ fontWeight: 850, lineHeight: 1 }}>{response.summary.estimatedMinutes}</Typography>
                <Typography variant="caption" color="text.secondary">{t('summary.minutes')}</Typography>
              </Box>
            </Stack>
          </Paper>

          <Paper elevation={0} variant="outlined" sx={{ p: isDialog ? 1.25 : 1.75, borderRadius: 3, bgcolor: alpha(theme.palette.background.paper, 0.72), gridColumn: { sm: 'span 2', md: 'auto' } }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 2, color: 'success.main', bgcolor: alpha(theme.palette.success.main, 0.1) }}>
                <SavingsIcon fontSize="small" />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant={isDialog ? 'h6' : 'h5'} sx={{ fontWeight: 850, lineHeight: 1, overflowWrap: 'anywhere' }}>
                  {formatCurrency(response.summary.potentialImpact)}
                </Typography>
                <Typography variant="caption" color="text.secondary">{t('summary.impact')}</Typography>
              </Box>
            </Stack>
          </Paper>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" action={<Button onClick={() => void loadReview()}>{t('actions.retry')}</Button>} sx={{ mb: 3, borderRadius: 2.5 }}>
          {error}
        </Alert>
      )}

      <Paper elevation={0} variant="outlined" sx={{ borderRadius: 3, mb: 3, overflow: 'hidden' }}>
        <Tabs
          value={filter}
          onChange={handleFilterChange}
          aria-label={t('tabs.label')}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{
            minHeight: 54,
            borderBottom: '1px solid',
            borderColor: 'divider',
            '& .MuiTab-root': { minHeight: 54, minWidth: { xs: 132, sm: 160 }, flex: { sm: 1 } },
          }}
        >
          <Tab value="open" label={t('tabs.open', { count: response.summary.open })} />
          <Tab value="snoozed" label={t('tabs.snoozed', { count: response.summary.snoozed })} />
          <Tab value="completed" label={t('tabs.completed', { count: response.summary.completed })} />
        </Tabs>

        {!loading && statusItems.length > 0 && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ px: 2, py: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              role="group"
              aria-label={t('filters.label')}
              sx={{ flexWrap: 'wrap' }}
            >
              <Chip
                clickable
                label={t('filters.all', { count: statusItems.length })}
                color={groupFilter === 'all' ? 'primary' : 'default'}
                variant={groupFilter === 'all' ? 'filled' : 'outlined'}
                aria-pressed={groupFilter === 'all'}
                onClick={() => setGroupFilter('all')}
              />
              {(['data', 'cash', 'improve'] as MoneyReviewGroup[]).map((group) => (
                <Chip
                  key={group}
                  clickable
                  disabled={groupCounts[group] === 0}
                  label={t('filters.group', { name: t(`groups.${group}.title`), count: groupCounts[group] })}
                  color={groupFilter === group ? 'primary' : 'default'}
                  variant={groupFilter === group ? 'filled' : 'outlined'}
                  aria-pressed={groupFilter === group}
                  onClick={() => setGroupFilter(group)}
                />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {t('filters.showing', { count: visibleItems.length })}
            </Typography>
          </Stack>
        )}
      </Paper>

      {loading ? (
        <Stack spacing={2} aria-label={t('loading')}>
          {[1, 2, 3].map((value) => <Skeleton key={value} variant="rounded" height={168} sx={{ borderRadius: 3 }} />)}
        </Stack>
      ) : visibleItems.length === 0 ? (
        <Paper elevation={0} variant="outlined" sx={{ p: { xs: 4, sm: 6 }, textAlign: 'center', borderRadius: 4 }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 68, height: 68, mx: 'auto', borderRadius: '50%', color: 'success.main', bgcolor: alpha(theme.palette.success.main, 0.1) }}>
            <DoneAllIcon sx={{ fontSize: 38 }} />
          </Box>
          <Typography variant="h6" sx={{ mt: 2, fontWeight: 800 }}>
            {t(`empty.${statusItems.length > 0 ? 'filtered' : filter}.title`)}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t(`empty.${statusItems.length > 0 ? 'filtered' : filter}.description`)}
          </Typography>
          <Button
            variant="outlined"
            startIcon={statusItems.length > 0 ? undefined : <RefreshIcon />}
            onClick={() => statusItems.length > 0 ? setGroupFilter('all') : void loadReview(true)}
            sx={{ mt: 2.5 }}
          >
            {statusItems.length > 0 ? t('actions.clearFilter') : t('actions.refresh')}
          </Button>
        </Paper>
      ) : (
        <Stack spacing={4.5}>
          {groupedItems.map(({ group, items }) => (
            <Box component="section" key={group} aria-labelledby={`money-review-group-${group}`}>
              <Stack direction="row" spacing={1.25} sx={{ mb: 0.75, alignItems: 'center' }}>
                <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: GROUP_ACCENTS[group] }} />
                <Typography id={`money-review-group-${group}`} component="h2" variant="h6" sx={{ fontWeight: 850 }}>
                  {t(`groups.${group}.title`)}
                </Typography>
                <Chip size="small" label={items.length} sx={{ height: 22 }} />
                <Divider sx={{ flex: 1 }} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.25, maxWidth: 720 }}>
                {t(`groups.${group}.description`)}
              </Typography>
              <Stack spacing={1.75}>
                {items.map((item) => (
                  <MoneyReviewCard
                    key={item.id}
                    item={item}
                    position={visibleItems.indexOf(item) + 1}
                    isNext={item.id === nextItem?.id && filter === 'open'}
                    busy={updatingId === item.id}
                    onPrimaryAction={performPrimaryAction}
                    onUpdateStatus={updateStatus}
                    onOpenDetails={(item) => setDetailItemId(item.id)}
                  />
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {!isDialog && (
        <>
          <Divider sx={{ mt: 4.5, mb: 2 }} />
          <Typography component="p" variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            {t('privacy')}
          </Typography>
        </>
      )}
      <FinancialCorrectionsDialog open={correctionsOpen} onClose={() => setCorrectionsOpen(false)} />
      <MoneyReviewItemDetailDialog
        open={detailItemId !== null}
        item={detailItem}
        loading={false}
        busy={detailItem?.id === updatingId}
        onClose={() => setDetailItemId(null)}
        onPrimaryAction={performPrimaryAction}
        onUpdateStatus={updateStatus}
      />
    </Box>
  );
};

export default MoneyReviewPage;
