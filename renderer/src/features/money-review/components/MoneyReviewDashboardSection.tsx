import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Dialog,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DataObjectIcon from '@mui/icons-material/DataObject';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { onStartupReady, scheduleStartupIdleWork } from '@renderer/app/startup/startup-readiness';
import { useMoneyReview } from '../hooks/useMoneyReview';
import type { MoneyReviewGroup, MoneyReviewItem } from '../types';
import MoneyReviewItemDetailDialog from './MoneyReviewItemDetailDialog';
import { buildMoneyReviewTimeScopeLabel } from '../time-scope';

const MoneyReviewPage = lazy(() => import('../pages/MoneyReviewPage'));

const GROUP_ICONS: Record<MoneyReviewGroup, React.ReactNode> = {
  data: <DataObjectIcon fontSize="small" />,
  cash: <ShieldOutlinedIcon fontSize="small" />,
  improve: <AutoAwesomeIcon fontSize="small" />,
};

const GROUP_COLORS: Record<MoneyReviewGroup, 'info' | 'warning' | 'secondary'> = {
  data: 'info',
  cash: 'warning',
  improve: 'secondary',
};

const isOpenItem = (item: MoneyReviewItem) => ['active', 'accepted'].includes(item.status);

const MoneyReviewDashboardSection: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'moneyReview' });
  const { formatCurrency } = useFinancePrivacy();
  const [searchParams, setSearchParams] = useSearchParams();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [reviewEnabled, setReviewEnabled] = useState(false);

  useEffect(() => {
    let cancelIdleLoad = () => {};
    const unsubscribeFromStartup = onStartupReady(() => {
      cancelIdleLoad = scheduleStartupIdleWork(
        () => setReviewEnabled(true),
        { timeoutMs: 1_500, fallbackDelayMs: 300 },
      );
    });

    return () => {
      unsubscribeFromStartup();
      cancelIdleLoad();
    };
  }, []);

  const reviewMode = searchParams.get('moneyReview');
  const requestedItemId = Number(searchParams.get('reviewItem'));
  const selectedItemId = Number.isFinite(requestedItemId) && requestedItemId > 0
    ? requestedItemId
    : null;
  const itemDialogOpen = reviewMode === 'item'
    || (reviewMode === 'open' && selectedItemId !== null);
  const reviewAllOpen = reviewMode === 'all'
    || (reviewMode === 'open' && selectedItemId === null);

  const openReviewAll = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('moneyReview', 'all');
    nextParams.delete('reviewItem');
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const openReviewItem = useCallback((itemId: number) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('moneyReview', 'item');
    nextParams.set('reviewItem', String(itemId));
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const closeReview = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('moneyReview');
    nextParams.delete('reviewItem');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const {
    response,
    loading,
    error,
    updatingId,
    loadReview,
    updateStatus,
    performPrimaryAction,
  } = useMoneyReview({ enabled: reviewEnabled, onExternalAction: closeReview });
  const reviewLoading = !reviewEnabled || loading;

  const openItems = useMemo(
    () => response.items.filter(isOpenItem),
    [response.items],
  );
  const selectedItem = useMemo(
    () => response.items.find((item) => item.id === selectedItemId) || null,
    [response.items, selectedItemId],
  );

  const scrollCards = (direction: -1 | 1) => {
    const visualDirection = theme.direction === 'rtl' ? direction * -1 : direction;
    scrollerRef.current?.scrollBy({ left: visualDirection * 320, behavior: 'smooth' });
  };

  return (
    <Box component="section" aria-labelledby="money-review-dashboard-title" sx={{ mb: 4 }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 1.5, minHeight: 40, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
          <Box
            aria-hidden="true"
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: 2.25,
              color: 'primary.main',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
            }}
          >
            <AssignmentTurnedInIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography id="money-review-dashboard-title" component="h2" variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              {t('title')}
            </Typography>
            {(reviewLoading || !error) && (
              <Typography variant="caption" color="text.secondary">
                {reviewLoading
                  ? t('loading')
                  : t('dashboard.summary', {
                      count: response.summary.open,
                      minutes: response.summary.estimatedMinutes,
                    })}
              </Typography>
            )}
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {!isMobile && openItems.length > 1 && (
            <>
              <Tooltip title={t('dashboard.previous')}>
                <IconButton size="small" onClick={() => scrollCards(-1)} aria-label={t('dashboard.previous')}>
                  <ArrowBackIcon fontSize="small" sx={{ transform: theme.direction === 'rtl' ? 'scaleX(-1)' : 'none' }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('dashboard.next')}>
                <IconButton size="small" onClick={() => scrollCards(1)} aria-label={t('dashboard.next')}>
                  <ArrowForwardIcon fontSize="small" sx={{ transform: theme.direction === 'rtl' ? 'scaleX(-1)' : 'none' }} />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Button
            size="small"
            endIcon={<ArrowForwardIcon fontSize="small" sx={{ transform: theme.direction === 'rtl' ? 'scaleX(-1)' : 'none' }} />}
            onClick={openReviewAll}
          >
            {t('dashboard.reviewAll')}
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Alert
          severity="warning"
          variant="outlined"
          action={<Button size="small" onClick={() => void loadReview()}>{t('actions.retry')}</Button>}
          sx={{ borderRadius: 3 }}
        >
          {t('dashboard.loadError')}
        </Alert>
      ) : reviewLoading ? (
        <Stack direction="row" spacing={1.5} sx={{ overflow: 'hidden' }} aria-label={t('loading')}>
          {[1, 2, 3].map((value) => (
            <Skeleton key={value} variant="rounded" width={290} height={148} sx={{ flexShrink: 0, borderRadius: 3 }} />
          ))}
        </Stack>
      ) : openItems.length === 0 ? (
        <Paper
          elevation={0}
          variant="outlined"
          sx={{ px: 2, py: 1.5, borderRadius: 3, bgcolor: alpha(theme.palette.success.main, 0.035) }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <DoneAllIcon color="success" />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 750 }}>{t('dashboard.caughtUp')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('dashboard.caughtUpDescription')}</Typography>
            </Box>
          </Stack>
        </Paper>
      ) : (
        <Box
          ref={scrollerRef}
          data-testid="money-review-carousel"
          sx={{
            display: 'flex',
            gap: 1.5,
            mx: { xs: -2, sm: 0 },
            px: { xs: 2, sm: 0 },
            pb: 1,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {openItems.map((item, index) => {
            const palette = theme.palette[GROUP_COLORS[item.group]];
            const minutes = item.group === 'data' ? 1 : 2;
            const timeScopeLabel = buildMoneyReviewTimeScopeLabel(item, i18n?.language || 'en');
            return (
              <Card
                key={item.id}
                elevation={0}
                variant="outlined"
                sx={{
                  flex: '0 0 min(290px, calc(100vw - 64px))',
                  scrollSnapAlign: 'start',
                  borderRadius: 3,
                  overflow: 'hidden',
                  borderColor: index === 0 ? alpha(theme.palette.primary.main, 0.38) : 'divider',
                  transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    borderColor: alpha(theme.palette.primary.main, 0.42),
                    boxShadow: `0 10px 24px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.22 : 0.07)}`,
                  },
                  '@media (prefers-reduced-motion: reduce)': {
                    transition: 'none',
                    '&:hover': { transform: 'none' },
                  },
                }}
              >
                <CardActionArea
                  onClick={() => openReviewItem(item.id)}
                  aria-label={t('dashboard.openItem', { title: item.title })}
                  sx={{ height: '100%', p: 1.75, alignItems: 'stretch' }}
                >
                  <Stack spacing={1.25} sx={{ height: '100%' }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Box
                        aria-hidden="true"
                        sx={{
                          display: 'grid',
                          placeItems: 'center',
                          width: 30,
                          height: 30,
                          flexShrink: 0,
                          borderRadius: 2,
                          color: palette.main,
                          bgcolor: alpha(palette.main, 0.11),
                        }}
                      >
                        {GROUP_ICONS[item.group]}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, fontWeight: 700 }}>
                        {t(`groups.${item.group}.title`)}
                      </Typography>
                      {index === 0 && <Chip size="small" color="primary" label={t('item.nextUp')} sx={{ height: 22 }} />}
                    </Stack>

                    <Box sx={{ flex: 1 }}>
                      <Typography
                        variant="subtitle2"
                        sx={{
                          fontWeight: 800,
                          lineHeight: 1.35,
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          overflow: 'hidden',
                        }}
                      >
                        {item.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          mt: 0.5,
                          lineHeight: 1.45,
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          overflow: 'hidden',
                        }}
                      >
                        {item.description}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                        <ScheduleIcon sx={{ fontSize: 14 }} />
                        {t('dashboard.minutes', { count: minutes })}
                      </Typography>
                      {timeScopeLabel && (
                        <Typography variant="caption" color="text.secondary">
                          {t(timeScopeLabel.key, timeScopeLabel.values)}
                        </Typography>
                      )}
                      {item.potentialImpact > 0 && (
                        <Typography variant="caption" color="success.main" sx={{ fontWeight: 800 }}>
                          {t('dashboard.impact', { amount: formatCurrency(item.potentialImpact) })}
                        </Typography>
                      )}
                    </Stack>
                  </Stack>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      )}

      <MoneyReviewItemDetailDialog
        open={itemDialogOpen}
        item={selectedItem}
        loading={reviewLoading}
        busy={selectedItem?.id === updatingId}
        onClose={closeReview}
        onPrimaryAction={performPrimaryAction}
        onUpdateStatus={updateStatus}
      />

      <Dialog
        open={reviewAllOpen}
        onClose={closeReview}
        fullWidth
        maxWidth="lg"
        fullScreen={isMobile}
        aria-labelledby="money-review-title"
        slotProps={{
          paper: {
            sx: {
              maxHeight: { sm: '88vh' },
              borderRadius: { xs: 0, sm: 4 },
              bgcolor: 'background.default',
            },
          },
        }}
      >
        <Suspense fallback={<Box sx={{ p: 4 }}><Skeleton variant="rounded" height={360} /></Box>}>
          <MoneyReviewPage
            presentation="dialog"
            initialResponse={!reviewLoading && !error ? response : null}
            onClose={closeReview}
            onReviewChanged={() => void loadReview(true)}
          />
        </Suspense>
      </Dialog>
    </Box>
  );
};

export default MoneyReviewDashboardSection;
