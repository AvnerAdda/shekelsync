import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import InstitutionBadge from '@renderer/shared/components/InstitutionBadge';
import CategoryIcon from '@renderer/features/breakdown/components/CategoryIcon';
import type { CorrectionTarget } from '@renderer/features/financial-truth/types';

interface ForecastDayDetailsProps {
  day: Record<string, any>;
  predictions: Array<Record<string, any>>;
  formatCurrency: (value: number, options?: any) => string;
  onCorrect: (target: CorrectionTarget) => void;
}

const flows = [
  { metric: 'expenses', categoryType: 'expense', color: 'error.main' },
  { metric: 'income', categoryType: 'income', color: 'success.main' },
  { metric: 'investments', categoryType: 'investment', color: 'info.main' },
] as const;
const finiteNumber = (value: unknown): number | null => value != null && Number.isFinite(Number(value))
  ? Number(value) : null;
// Shift the decimal before rounding so values such as 1.005 round the same
// way as the currency formatter, including negative investment withdrawals.
const cents = (value: number) => {
  const [coefficient, exponent = '0'] = Math.abs(value).toString().split('e');
  return Math.sign(value) * Math.round(Number(`${coefficient}e${Number(exponent) + 2}`));
};

// Prefer the contribution calculated by the model: normalizations and overrides
// can make it differ from the nominal amount times the displayed probability.
function contribution(prediction: Record<string, any>) {
  return finiteNumber(prediction.probabilityWeightedAmount)
    ?? (finiteNumber(prediction.amount) ?? 0) * (finiteNumber(prediction.probability) ?? 0);
}

export default function ForecastDayDetails({ day, predictions, formatCurrency, onCorrect }: ForecastDayDetailsProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'transactionHistory' });
  const { t: tRoot } = useTranslation('translation');
  const money = (value: number) => `${value < 0 ? '-' : ''}${formatCurrency(Math.abs(value), {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
  const groups = flows.map(flow => {
    const rows = predictions.filter(prediction => (prediction.categoryType || 'expense') === flow.categoryType);
    const sum = rows.reduce((total, prediction) => total + contribution(prediction), 0);
    const total = finiteNumber(day[flow.metric]) ?? sum;
    // Older responses may only contain the top five predictions. Account for
    // their missing contributions explicitly instead of implying completeness.
    const remainder = cents(total - sum);
    const displayedSum = rows.reduce((value, prediction) => value + cents(contribution(prediction)), 0);
    const rounding = cents(total) - displayedSum - remainder;
    return { ...flow, rows, total, remainder, rounding };
  }).filter(group => group.rows.length > 0 || group.total !== 0);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('forecast.breakdownExplanation', {
          defaultValue: 'Each amount below is its contribution to the chart total, weighted by probability. Estimated transaction amounts are shown separately.',
        })}
      </Typography>
      <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
        {groups.map(group => (
          <Box component="section" aria-label={t(`legend.${group.metric}`)} key={group.metric} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
              <Typography variant="subtitle2" color={group.color}>{t(`legend.${group.metric}`)}</Typography>
              <Typography variant="subtitle2" color={group.color}>{money(group.total)}</Typography>
            </Box>
            {group.rows.map((prediction, index) => (
              <Box key={prediction.occurrenceId || `${prediction.category}-${index}`} sx={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2,
                py: 1.5, px: 2, bgcolor: 'action.hover', borderRadius: 1, mb: 0.5,
              }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 0.5 }}>
                    {prediction.transactionName || prediction.category_name || prediction.category}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 500 }}>
                      {t('forecast.probability', {
                        percent: ((finiteNumber(prediction.probability) ?? 0) * 100).toFixed(0),
                        defaultValue: `${((finiteNumber(prediction.probability) ?? 0) * 100).toFixed(0)}% probability`,
                      })}
                    </Typography>
                    {(prediction.parent_name || prediction.category_name) && <>
                      <Typography variant="caption" color="text.secondary">•</Typography>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        <CategoryIcon iconName={prediction.category_icon} color={prediction.category_color} size={14} />
                        <Typography variant="caption" sx={{ color: prediction.category_color || 'primary.main', fontWeight: 500 }}>
                          {prediction.parent_name && prediction.category_name
                            ? `${prediction.parent_name} > ${prediction.category_name}`
                            : prediction.category_name || prediction.parent_name}
                        </Typography>
                      </Box>
                    </>}
                    {(prediction.institution?.display_name_he || prediction.vendor) && <>
                      <Typography variant="caption" color="text.secondary">•</Typography>
                      <InstitutionBadge institution={prediction.institution} fallback={prediction.vendor} />
                    </>}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('forecast.estimatedAmount', {
                      amount: money(finiteNumber(prediction.amount) ?? 0),
                      defaultValue: `Estimated transaction: ${money(finiteNumber(prediction.amount) ?? 0)}`,
                    })}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'end' }}>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{money(cents(contribution(prediction)) / 100)}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {t('forecast.contribution', { defaultValue: 'Included in forecast' })}
                  </Typography>
                  {(prediction.patternId || prediction.categoryDefinitionId) && (
                    <Button size="small" variant="text" onClick={() => onCorrect({
                      kind: prediction.patternId ? 'occurrence' : 'category',
                      patternId: prediction.patternId || undefined,
                      occurrenceId: prediction.occurrenceId || undefined,
                      categoryDefinitionId: prediction.categoryDefinitionId || undefined,
                      title: prediction.transactionName || prediction.category_name || prediction.category,
                      amount: Math.abs(Number(prediction.amount) || 0),
                      nextExpectedDate: day.date,
                      capabilities: prediction.correctionCapabilities,
                    })}>
                      {tRoot('financialTruth.notAccurate', { defaultValue: 'Not accurate' })}
                    </Button>
                  )}
                </Box>
              </Box>
            ))}
            {group.remainder !== 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, px: 2, py: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('forecast.remainingForecast', { defaultValue: 'Other forecast contributions' })}
                </Typography>
                <Typography variant="body2">{money(group.remainder / 100)}</Typography>
              </Box>
            )}
            {group.rounding !== 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, px: 2, py: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('forecast.roundingAdjustment', { defaultValue: 'Rounding' })}
                </Typography>
                <Typography variant="caption">{money(group.rounding / 100)}</Typography>
              </Box>
            )}
          </Box>
        ))}
        {groups.length === 0 && <Typography variant="body2" color="text.secondary">
          {t('forecast.noPredictions', { defaultValue: 'No predictions for this date' })}
        </Typography>}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center', fontStyle: 'italic' }}>
        {t('forecast.basedOnPatterns')}
      </Typography>
    </Box>
  );
}
