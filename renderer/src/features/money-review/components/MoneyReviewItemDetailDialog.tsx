import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import DataObjectIcon from '@mui/icons-material/DataObject';
import InsightsIcon from '@mui/icons-material/Insights';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { buildMoneyReviewInsight } from '../money-review-insights';
import type {
  MoneyReviewAction,
  MoneyReviewGroup,
  MoneyReviewItem,
  MoneyReviewStatus,
  SnoozePreset,
} from '../types';
import MoneyReviewItemActions from './MoneyReviewItemActions';
import FinancialCorrectionDialog from '@renderer/features/financial-truth/FinancialCorrectionDialog';
import type { CorrectionTarget } from '@renderer/features/financial-truth/types';
import { useFinancialTruth } from '@renderer/features/financial-truth/useFinancialTruth';

const GROUP_ICONS: Record<MoneyReviewGroup, React.ReactNode> = {
  data: <DataObjectIcon />,
  cash: <ShieldOutlinedIcon />,
  improve: <AutoAwesomeIcon />,
};

const GROUP_COLORS: Record<MoneyReviewGroup, 'info' | 'warning' | 'secondary'> = {
  data: 'info',
  cash: 'warning',
  improve: 'secondary',
};

interface MoneyReviewItemDetailDialogProps {
  open: boolean;
  item: MoneyReviewItem | null;
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onPrimaryAction: (item: MoneyReviewItem, action: MoneyReviewAction) => Promise<void>;
  onUpdateStatus: (
    item: MoneyReviewItem,
    status: MoneyReviewStatus,
    snoozePreset?: SnoozePreset,
  ) => Promise<boolean>;
}

const MoneyReviewItemDetailDialog: React.FC<MoneyReviewItemDetailDialogProps> = ({
  open,
  item,
  loading,
  busy,
  onClose,
  onPrimaryAction,
  onUpdateStatus,
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'moneyReview' });
  const { t: tRoot } = useTranslation('translation');
  const { formatCurrency } = useFinancePrivacy();
  const insight = useMemo(() => item ? buildMoneyReviewInsight(item) : null, [item]);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const truth = useFinancialTruth();
  const patternId = Number(item?.metadata?.patternId);
  const metadataData = item?.metadata?.data && typeof item.metadata.data === 'object'
    ? item.metadata.data as Record<string, unknown>
    : {};
  const categoryDefinitionId = Number(metadataData.category_definition_id || metadataData.categoryDefinitionId);
  const returnCorrectionId = item?.metadata?.source === 'financial_truth' ? Number(item.metadata?.correctionId) : null;

  const formatValue = (value: number | string, format: 'currency' | 'number' | 'text' = 'text') => {
    if (format === 'currency') return formatCurrency(Number(value));
    if (format === 'number' && typeof value === 'number') {
      return new Intl.NumberFormat(i18n?.language || 'en', { maximumFractionDigits: 1 }).format(value);
    }
    return String(value);
  };

  const comparisonMax = insight?.comparison
    ? Math.max(1, insight.comparison.firstValue, insight.comparison.secondValue)
    : 1;

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={fullScreen}
      aria-labelledby="money-review-item-title"
      slotProps={{
        paper: {
          sx: {
            borderRadius: { xs: 0, sm: 4 },
            bgcolor: 'background.default',
          },
        },
      }}
    >
      {loading ? (
        <Box sx={{ p: { xs: 2.5, sm: 4 } }} aria-label={t('detail.loading')}>
          <Skeleton width="55%" height={42} />
          <Skeleton variant="rounded" height={120} sx={{ mt: 2, borderRadius: 3 }} />
          <Skeleton variant="rounded" height={170} sx={{ mt: 2, borderRadius: 3 }} />
        </Box>
      ) : !item || !insight ? (
        <Box sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center' }}>
          <Typography id="money-review-item-title" component="h2" variant="h6" sx={{ fontWeight: 800 }}>
            {t('detail.unavailableTitle')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>
            {t('detail.unavailableDescription')}
          </Typography>
          <IconButton onClick={onClose} aria-label={t('detail.close')} sx={{ mt: 2 }}>
            <CloseIcon />
          </IconButton>
        </Box>
      ) : (
        <>
          <DialogTitle component="div" sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.75 }, pb: 1.5, pr: 7 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Box
                aria-hidden="true"
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 42,
                  height: 42,
                  flexShrink: 0,
                  borderRadius: 2.5,
                  color: `${GROUP_COLORS[item.group]}.main`,
                  bgcolor: alpha(theme.palette[GROUP_COLORS[item.group]].main, 0.11),
                }}
              >
                {GROUP_ICONS[item.group]}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip size="small" label={t(`groups.${item.group}.title`)} sx={{ height: 23 }} />
                  <Chip
                    size="small"
                    variant="outlined"
                    color={item.severity === 'critical' ? 'error' : item.severity === 'high' ? 'warning' : 'default'}
                    label={t(`priority.${item.severity}`)}
                    sx={{ height: 23 }}
                  />
                </Stack>
                <Typography id="money-review-item-title" component="h2" variant="h5" sx={{ mt: 0.75, fontWeight: 850, lineHeight: 1.25 }}>
                  {item.title}
                </Typography>
              </Box>
            </Stack>
            <IconButton
              onClick={onClose}
              aria-label={t('detail.close')}
              sx={{ position: 'absolute', insetInlineEnd: 16, top: 16 }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>

          <DialogContent sx={{ px: { xs: 2, sm: 3 }, pb: 2.5 }}>
            <Typography color="text.secondary" sx={{ lineHeight: 1.6, maxWidth: 720 }}>
              {item.description}
            </Typography>

            <Paper
              elevation={0}
              sx={{
                mt: 2.5,
                p: 2,
                borderRadius: 3,
                border: '1px solid',
                borderColor: alpha(theme.palette.primary.main, 0.16),
                bgcolor: alpha(theme.palette.primary.main, 0.045),
              }}
            >
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                <InsightsIcon color="primary" />
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t('detail.whyTitle')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, lineHeight: 1.55 }}>
                    {t(insight.explanation)}
                  </Typography>
                </Box>
              </Stack>
            </Paper>

            {insight.comparison && (
              <Box component="section" aria-labelledby="money-review-comparison-title" sx={{ mt: 3 }}>
                <Typography id="money-review-comparison-title" variant="subtitle1" sx={{ fontWeight: 800 }}>
                  {t('detail.comparisonTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {t('detail.comparisonDescription')}
                </Typography>
                <Paper
                  role="img"
                  aria-label={t('detail.comparisonAria', {
                    first: t(insight.comparison.firstLabel),
                    firstValue: formatValue(insight.comparison.firstValue, insight.comparison.format),
                    second: t(insight.comparison.secondLabel),
                    secondValue: formatValue(insight.comparison.secondValue, insight.comparison.format),
                  })}
                  elevation={0}
                  variant="outlined"
                  sx={{ mt: 1.5, p: 2, borderRadius: 3 }}
                >
                  {[
                    { label: insight.comparison.firstLabel, value: insight.comparison.firstValue, color: theme.palette.primary.main },
                    { label: insight.comparison.secondLabel, value: insight.comparison.secondValue, color: theme.palette.grey[500] },
                  ].map((entry) => (
                    <Box key={entry.label} sx={{ '& + &': { mt: 1.75 } }}>
                      <Stack direction="row" sx={{ mb: 0.65, justifyContent: 'space-between', gap: 2 }}>
                        <Typography variant="caption" color="text.secondary">{t(entry.label)}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {formatValue(entry.value, insight.comparison!.format)}
                        </Typography>
                      </Stack>
                      <Box sx={{ height: 10, borderRadius: 5, bgcolor: alpha(entry.color, 0.12), overflow: 'hidden' }}>
                        <Box sx={{ width: `${Math.max(4, (entry.value / comparisonMax) * 100)}%`, height: '100%', borderRadius: 5, bgcolor: entry.color }} />
                      </Box>
                    </Box>
                  ))}
                </Paper>
              </Box>
            )}

            {insight.metrics.length > 0 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: `repeat(${Math.min(3, insight.metrics.length)}, 1fr)` },
                  gap: 1.25,
                  mt: 2.5,
                }}
              >
                {insight.metrics.map((entry) => (
                  <Paper key={entry.label} elevation={0} variant="outlined" sx={{ p: 1.5, borderRadius: 2.5 }}>
                    <Typography variant="caption" color="text.secondary">{t(entry.label)}</Typography>
                    <Typography sx={{ mt: 0.25, fontWeight: 850, overflowWrap: 'anywhere' }}>
                      {formatValue(entry.value, entry.format)}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            )}

            <Box sx={{ mt: 3 }}>
              <Stack direction="row" sx={{ mb: 0.75, alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t('detail.priorityTitle')}</Typography>
                <Typography variant="caption" color="text.secondary">{item.priority}/100</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, item.priority))}
                aria-label={t('detail.priorityAria', { score: item.priority })}
                sx={{ height: 8, borderRadius: 4 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8, lineHeight: 1.5 }}>
                {t('detail.priorityDescription')}
              </Typography>
            </Box>

            <Divider sx={{ mt: 2.5, mb: 1.5 }} />
            <Typography variant="caption" color="text.secondary">{t(insight.source)}</Typography>
          </DialogContent>

          <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ width: '100%' }}>
              {((Number.isSafeInteger(patternId) && patternId > 0) || (Number.isSafeInteger(categoryDefinitionId) && categoryDefinitionId > 0)) && (
                <Button
                  size="small"
                  color="warning"
                  onClick={() => setCorrectionTarget({
                    kind: patternId > 0 ? 'pattern' : 'category',
                    patternId: patternId > 0 ? patternId : undefined,
                    categoryDefinitionId: categoryDefinitionId > 0 ? categoryDefinitionId : undefined,
                    title: item.title,
                    amount: Number(metadataData.detected_amount || metadataData.projected_total || metadataData.projectedTotal) || item.potentialImpact,
                    nextExpectedDate: String(metadataData.next_expected_date || metadataData.nextExpectedDate || '') || undefined,
                    capabilities: patternId > 0 ? ['suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern'] : ['set_category_expectation'],
                  })}
                  sx={{ mb: 1 }}
                >
                  {tRoot('financialTruth.notAccurate', { defaultValue: 'Not accurate' })}
                </Button>
              )}
              {Number.isSafeInteger(returnCorrectionId) && Number(returnCorrectionId) > 0 && (
                <Button
                  size="small"
                  variant="contained"
                  disabled={truth.busy}
                  onClick={() => void truth.revert(Number(returnCorrectionId)).then(() => onClose())}
                  sx={{ mb: 1, ml: 1 }}
                >
                  {tRoot('financialTruth.restorePrediction', { defaultValue: 'Restore prediction' })}
                </Button>
              )}
              <MoneyReviewItemActions
                item={item}
                busy={busy}
                onPrimaryAction={onPrimaryAction}
                onUpdateStatus={onUpdateStatus}
                align="end"
              />
            </Box>
          </DialogActions>
        </>
      )}
    </Dialog>
    <FinancialCorrectionDialog
      open={Boolean(correctionTarget)}
      target={correctionTarget}
      sourceFeature="money_review"
      sourceKey={item?.sourceKey}
      onClose={() => setCorrectionTarget(null)}
      onApplied={() => onClose()}
    />
    </>
  );
};

export default MoneyReviewItemDetailDialog;
