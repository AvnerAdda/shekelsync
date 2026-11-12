import React, { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import { apiClient, invalidateApiCache } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { RhythmCheck } from './types';
import { categoryLabel, formatDay, toAppLocale } from './rhythm-format';

interface Props {
  checks: RhythmCheck[];
  onRepaired: () => void;
}

/** Data problems that would make the curves wrong, each with what to do about it. */
const RhythmChecks: React.FC<Props> = ({ checks, onRepaired }) => {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.rhythm.compare.checks' });
  const { formatCurrency } = useFinancePrivacy();
  const locale = toAppLocale(i18n.language);
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState(false);
  const money = (value: number) => formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });
  const category = (value: Parameters<typeof categoryLabel>[0]) => categoryLabel(value, locale, t('uncategorized'));

  if (checks.length === 0) return null;

  const repair = async () => {
    setRepairing(true);
    setRepairError(false);
    try {
      const response = await apiClient.post('/api/analytics/rhythm-comparison/repair-types', {});
      if (!response.ok) throw new Error('repair_failed');
      invalidateApiCache();
      onRepaired();
    } catch (err) {
      console.error('Failed to repair transaction types:', err);
      setRepairError(true);
    } finally {
      setRepairing(false);
    }
  };

  return (
    <Accordion
      defaultExpanded
      disableGutters
      sx={{ bgcolor: 'transparent', boxShadow: 'none', border: 1, borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{t('title', { count: checks.length })}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('subtitle')}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {checks.map((check) => {
          if (check.type === 'type_mismatch') {
            return (
              <Alert
                key="type_mismatch"
                severity="warning"
                action={(
                  <Button color="inherit" size="small" onClick={repair} disabled={repairing} startIcon={repairing ? <CircularProgress size={14} /> : undefined}>
                    {t('typeMismatch.fix')}
                  </Button>
                )}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('typeMismatch.title', { count: check.count })}</Typography>
                <Typography variant="caption" component="div">{t('typeMismatch.body')}</Typography>
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {check.transactions.slice(0, 5).map((txn) => (
                    <li key={`${txn.vendor}-${txn.identifier}`}>
                      <Typography variant="caption">
                        {t('typeMismatch.item', {
                          date: formatDay(txn.date, i18n.language),
                          name: txn.name,
                          amount: money(txn.amount),
                          category: category({ name: txn.categoryName, nameEn: txn.categoryNameEn, nameFr: txn.categoryNameFr }),
                          categoryType: t(`types.${txn.categoryType}`),
                        })}
                      </Typography>
                    </li>
                  ))}
                </Box>
                {repairError && <Typography variant="caption" sx={{ color: 'error.main' }}>{t('typeMismatch.failed')}</Typography>}
              </Alert>
            );
          }
          if (check.type === 'stale_account') {
            return (
              <Alert key={`stale-${check.vendor}-${check.nickname}`} severity="info">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {check.lastSuccess
                    ? t(check.lastStatus === 'failed' ? 'stale.titleFailed' : 'stale.title', {
                      account: check.nickname || check.vendor, date: formatDay(check.lastSuccess, i18n.language), count: check.days ?? 0,
                    })
                    : t('stale.never', { account: check.nickname || check.vendor })}
                </Typography>
                <Typography variant="caption" component="div">{t('stale.body')}</Typography>
              </Alert>
            );
          }
          return (
            <Alert key={`drift-${check.vendor}-${check.identifier}`} severity="info">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('drift.title', { merchant: check.merchant, category: category(check.category) })}
              </Typography>
              <Typography variant="caption" component="div">
                {t('drift.body', {
                  date: formatDay(check.date, i18n.language),
                  amount: money(check.amount),
                  usual: category(check.usualCategory),
                  count: check.usualCategory.count,
                })}
              </Typography>
            </Alert>
          );
        })}
      </AccordionDetails>
    </Accordion>
  );
};

export default RhythmChecks;
