import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancialTruth } from './useFinancialTruth';
import type { FinancialCorrection } from './types';

interface Props { open: boolean; onClose: () => void }

const FinancialCorrectionsDialog: React.FC<Props> = ({ open, onClose }) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { t } = useTranslation();
  const truth = useFinancialTruth();
  const [status, setStatus] = useState<'active' | 'reverted'>('active');
  const [items, setItems] = useState<FinancialCorrection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<{ success: boolean; corrections: FinancialCorrection[] }>(
        `/api/financial-truth/corrections?status=${status}`,
        { cacheMode: 'no-store' },
      );
      if (!response.ok || !response.data?.success) throw new Error('Could not load corrections');
      setItems(response.data.corrections || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load corrections');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { if (open) void load(); }, [load, open]);

  const restore = async (id: number) => {
    await truth.revert(id);
    await load();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle>{t('financialTruth.correctionsTitle', 'Your corrections')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {t('financialTruth.correctionsDescription', 'These choices are used by forecasts, subscriptions, alerts, and financial guidance.')}
        </Typography>
        <Tabs value={status} onChange={(_, value) => setStatus(value)} sx={{ mt: 1 }}>
          <Tab value="active" label={t('financialTruth.active', 'Active')} />
          <Tab value="reverted" label={t('financialTruth.restored', 'Restored')} />
        </Tabs>
        {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 5 }}><CircularProgress size={28} /></Box> : error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : items.length === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>{t('financialTruth.noCorrections', 'No corrections in this view.')}</Alert>
        ) : (
          <List disablePadding sx={{ mt: 1 }}>
            {items.map((item) => (
              <ListItem key={item.id} divider alignItems="flex-start" secondaryAction={status === 'active' ? (
                <Button size="small" disabled={truth.busy} onClick={() => void restore(item.id)}>{t('financialTruth.restore', 'Restore')}</Button>
              ) : undefined}>
                <Box sx={{ pr: status === 'active' ? 8 : 0 }}>
                  <Typography variant="body1">{item.targetLabel || 'Financial prediction'}</Typography>
                  <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{t(`financialTruth.historyActions.${item.action}`, item.action)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('financialTruth.sourceScope', 'Source: {{source}} · Scope: {{scope}}', {
                        source: item.sourceFeature,
                        scope: t(`financialTruth.scopes.${item.scope}`, item.scope),
                      })}
                      {item.effectiveDate
                        ? ` · ${t('financialTruth.effectiveFrom', 'Effective {{date}}', { date: item.effectiveDate })}`
                        : ''}
                    </Typography>
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                      {(item.affectedDomains || []).slice(0, 4).map((domain) => <Chip key={domain} size="small" variant="outlined" label={domain} />)}
                    </Stack>
                  </Stack>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>{t('actions.close', 'Close')}</Button></DialogActions>
    </Dialog>
  );
};

export default FinancialCorrectionsDialog;
