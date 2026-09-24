import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Divider, InputAdornment,
  LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { apiClient } from '@/lib/api-client';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from '../../financial-truth/types';
import { usePlanningData } from '../hooks/usePlanningData';
import { PLANNING_CHANGED_EVENT } from '../types';
import type { CashScenario, ScenarioPreview } from '../types';
import { newChangeDraft, scenarioDraft, scenarioInput, tomorrowKey } from '../utils/planning-drafts';
import type { ChangeDraft, ScenarioDraft } from '../utils/planning-drafts';

const HORIZON_DAYS = 180;

export default function ScenariosPanel() {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'planning' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { data, loading, error, refresh, saveScenario, deleteScenario } = usePlanningData();
  const [editor, setEditor] = useState<{ scenario: CashScenario | null; draft: ScenarioDraft } | null>(null);
  const [deleting, setDeleting] = useState<CashScenario | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScenarioPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const previewSequence = useRef(0);
  const previewController = useRef<AbortController | null>(null);

  const invalidatePreview = useCallback(() => {
    previewSequence.current += 1;
    previewController.current?.abort();
    previewController.current = null;
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(false);
  }, []);

  useEffect(() => {
    const events = [PLANNING_CHANGED_EVENT, FINANCIAL_TRUTH_CHANGED_EVENT, 'dataRefresh', 'focus'];
    events.forEach((event) => window.addEventListener(event, invalidatePreview));
    return () => {
      previewSequence.current += 1;
      previewController.current?.abort();
      events.forEach((event) => window.removeEventListener(event, invalidatePreview));
    };
  }, [invalidatePreview]);

  const requestPreview = async (draft: ScenarioDraft) => {
    invalidatePreview();
    const input = scenarioInput(draft);
    if (!input) {
      setActionError(t('scenarios.validation'));
      return;
    }
    setActionError(null);
    const request = previewSequence.current;
    const controller = new AbortController();
    previewController.current = controller;
    setPreviewLoading(true);
    try {
      const response = await apiClient.post<ScenarioPreview>('/api/planning/scenarios/preview', {
        ...input, horizon_days: HORIZON_DAYS,
      }, { signal: controller.signal });
      if (!response.ok || !response.data?.baseline || !response.data?.scenario || !response.data?.comparison) {
        throw new Error('Unable to compare scenario');
      }
      if (request === previewSequence.current) setPreview(response.data);
    } catch {
      if (request === previewSequence.current) setPreviewError(true);
    } finally {
      if (request === previewSequence.current) {
        setPreviewLoading(false);
        previewController.current = null;
      }
    }
  };

  const openEditor = (scenario: CashScenario | null, compare = false) => {
    invalidatePreview();
    setActionError(null);
    const draft = scenarioDraft(scenario);
    setEditor({ scenario, draft });
    if (compare) void requestPreview(draft);
  };

  const closeEditor = () => {
    if (saving) return;
    invalidatePreview();
    setEditor(null);
  };

  const updateDraft = (update: (draft: ScenarioDraft) => ScenarioDraft) => {
    invalidatePreview();
    setActionError(null);
    setEditor((current) => current ? { ...current, draft: update(current.draft) } : null);
  };

  const updateChange = (id: string, field: keyof ChangeDraft, value: string) => {
    updateDraft((draft) => ({
      ...draft,
      changes: draft.changes.map((change) => change.id === id ? { ...change, [field]: value } : change),
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor || saving) return;
    const input = scenarioInput(editor.draft);
    if (!input) {
      setActionError(t('scenarios.validation'));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await saveScenario(input, editor.scenario?.id);
      invalidatePreview();
      setEditor(null);
    } catch {
      setActionError(t('shared.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await deleteScenario(deleting.id);
      setDeleting(null);
    } catch {
      setActionError(t('shared.deleteError'));
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(i18n.resolvedLanguage || i18n.language);
  const currency = (value: number | null | undefined, showSign = false) => typeof value === 'number' && Number.isFinite(value)
    ? formatCurrency(value, { showSign }) : '—';
  const scenarios = data?.scenarios ?? [];
  const ready = preview?.baseline.status === 'ready' && preview.scenario.status === 'ready';
  const metrics = preview ? [
    { key: 'available', baseline: preview.baseline.available_spend, scenario: preview.scenario.available_spend, delta: preview.comparison.available_spend_delta },
    { key: 'ending', baseline: preview.baseline.ending_balance, scenario: preview.scenario.ending_balance, delta: preview.comparison.end_balance_delta },
    { key: 'lowest', baseline: preview.baseline.lowest_balance, scenario: preview.scenario.lowest_balance, delta: preview.comparison.lowest_balance_delta },
  ] : [];

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
            <Box>
              <Typography component="h2" variant="h6">{t('scenarios.title')}</Typography>
              <Typography variant="body2" color="text.secondary">{t('scenarios.subtitle')}</Typography>
            </Box>
            <Button variant="outlined" startIcon={<AddIcon />} disabled={saving} onClick={() => openEditor(null)} sx={{ flexShrink: 0 }}>{t('scenarios.add')}</Button>
          </Stack>
          {error && <Alert severity="error" action={<Button color="inherit" onClick={() => void refresh()}>{t('shared.retry')}</Button>}>{t('shared.loadError')}</Alert>}
          {loading && <LinearProgress aria-label={t('shared.loading')} />}
          {!loading && !error && scenarios.length === 0 && (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <CompareArrowsIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
              <Typography sx={{ fontWeight: 600 }}>{t('scenarios.emptyTitle')}</Typography>
              <Typography variant="body2" color="text.secondary">{t('scenarios.emptyBody')}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            {scenarios.map((scenario) => (
              <Card key={scenario.id} variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Stack spacing={1.5}>
                    <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{scenario.name}</Typography>
                    {scenario.changes.map((change) => (
                      <Stack key={change.id} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{change.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t(`scenarios.changeDates.${change.frequency}`, { date: dateLabel(change.date) })}
                            {change.frequency === 'monthly' && change.end_date ? ` · ${t('scenarios.until', { date: dateLabel(change.end_date) })}` : ''}
                          </Typography>
                        </Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{currency(change.amount, true)}</Typography>
                      </Stack>
                    ))}
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Button size="small" disabled={saving} aria-label={t('scenarios.compareNamed', { name: scenario.name })} onClick={() => openEditor(scenario, true)}>{t('scenarios.compare')}</Button>
                      <Button size="small" disabled={saving} aria-label={t('scenarios.editNamed', { name: scenario.name })} onClick={() => openEditor(scenario)}>{t('shared.edit')}</Button>
                      <Button size="small" disabled={saving} color="error" aria-label={t('scenarios.deleteNamed', { name: scenario.name })} onClick={() => { setActionError(null); setDeleting(scenario); }}>{t('shared.delete')}</Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Stack>
      </CardContent>

      <Dialog open={Boolean(editor)} onClose={closeEditor} fullWidth maxWidth="md" aria-labelledby="scenario-editor-title">
        <Box component="form" onSubmit={submit} noValidate sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <DialogTitle id="scenario-editor-title">{t(editor?.scenario ? 'scenarios.edit' : 'scenarios.add')}</DialogTitle>
          <DialogContent>
            {editor && <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Alert severity="info">{t('scenarios.simulationNote')}</Alert>
              {actionError && <Alert severity="error">{actionError}</Alert>}
              <TextField label={t('scenarios.name')} value={editor.draft.name} onChange={(event) => updateDraft((draft) => ({ ...draft, name: event.target.value }))} required fullWidth disabled={saving} slotProps={{ htmlInput: { maxLength: 120 } }} />
              <Typography variant="body2" color="text.secondary">{t('scenarios.signedHelp')}</Typography>
              {editor.draft.changes.map((change, index) => (
                <Box key={change.id} component="fieldset" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, m: 0, minWidth: 0 }}>
                  <Typography component="legend" variant="subtitle2" sx={{ px: 1 }}>{t('scenarios.changeNumber', { number: index + 1 })}</Typography>
                  <Stack spacing={2}>
                    <TextField label={t('scenarios.description')} value={change.label} onChange={(event) => updateChange(change.id, 'label', event.target.value)} required disabled={saving} fullWidth slotProps={{ htmlInput: { maxLength: 120 } }} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField label={t('scenarios.amount')} type={maskAmounts ? 'password' : 'number'} value={change.amount} onChange={(event) => updateChange(change.id, 'amount', event.target.value)} required disabled={saving} fullWidth autoComplete="off" slotProps={{ htmlInput: { min: -1e9, max: 1e9, step: '0.01', inputMode: 'decimal' }, input: { startAdornment: <InputAdornment position="start">₪</InputAdornment> } }} />
                      <TextField select label={t('scenarios.frequency')} value={change.frequency} onChange={(event) => updateChange(change.id, 'frequency', event.target.value)} disabled={saving} fullWidth>
                        <MenuItem value="one_time">{t('scenarios.frequencies.one_time')}</MenuItem>
                        <MenuItem value="monthly">{t('scenarios.frequencies.monthly')}</MenuItem>
                      </TextField>
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField label={t(change.frequency === 'one_time' ? 'scenarios.date' : 'scenarios.startDate')} type="date" value={change.date} onChange={(event) => updateChange(change.id, 'date', event.target.value)} required disabled={saving} fullWidth slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: change.frequency === 'one_time' ? tomorrowKey() : '2000-01-01', max: '2200-12-31' } }} helperText={t(change.frequency === 'one_time' ? 'scenarios.dateHelp' : 'scenarios.monthlyHelp')} />
                      {change.frequency === 'monthly' && <TextField label={t('scenarios.endDate')} type="date" value={change.end_date || ''} onChange={(event) => updateChange(change.id, 'end_date', event.target.value)} disabled={saving} fullWidth slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: change.date, max: '2200-12-31' } }} helperText={t('scenarios.endDateHelp')} />}
                    </Stack>
                    <Button size="small" color="error" disabled={saving || editor.draft.changes.length === 1} sx={{ alignSelf: 'flex-start' }} aria-label={t('scenarios.removeNumber', { number: index + 1 })} onClick={() => updateDraft((draft) => ({ ...draft, changes: draft.changes.filter((entry) => entry.id !== change.id) }))}>{t('scenarios.removeChange')}</Button>
                  </Stack>
                </Box>
              ))}
              <Button startIcon={<AddIcon />} disabled={saving || editor.draft.changes.length >= 24} onClick={() => updateDraft((draft) => ({ ...draft, changes: [...draft.changes, newChangeDraft()] }))} sx={{ alignSelf: 'flex-start' }}>{t('scenarios.addChange')}</Button>
              <Divider />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
                <Box>
                  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>{t('scenarios.previewTitle', { days: HORIZON_DAYS })}</Typography>
                  <Typography variant="body2" color="text.secondary">{t('scenarios.horizonHelp', { days: HORIZON_DAYS })}</Typography>
                </Box>
                <Button variant="outlined" disabled={saving || previewLoading} startIcon={previewLoading ? <CircularProgress size={16} color="inherit" /> : <CompareArrowsIcon />} onClick={() => void requestPreview(editor.draft)} sx={{ flexShrink: 0 }}>{t('scenarios.compare')}</Button>
              </Stack>
              {previewLoading && <LinearProgress aria-label={t('scenarios.comparing')} />}
              {previewError && <Alert severity="error">{t('scenarios.previewError')}</Alert>}
              {!preview && !previewLoading && !previewError && <Typography variant="body2" color="text.secondary">{t('scenarios.previewPrompt')}</Typography>}
              {preview && !ready && <Alert severity="info">
                <Typography sx={{ fontWeight: 600 }}>{t('scenarios.incomplete')}</Typography>
                {preview.baseline.reasons.map((reason) => <Typography key={reason.code} variant="body2">{t(`spendability.reasons.${reason.code}`, { defaultValue: reason.message })}</Typography>)}
              </Alert>}
              {preview && ready && <Stack spacing={2} aria-live="polite">
                <TableContainer>
                  <Table size="small" aria-label={t('scenarios.comparisonTable')}>
                    <TableHead><TableRow>
                      <TableCell>{t('scenarios.measure')}</TableCell>
                      <TableCell align="right">{t('scenarios.baseline')}</TableCell>
                      <TableCell align="right">{t('scenarios.scenario')}</TableCell>
                      <TableCell align="right">{t('scenarios.difference')}</TableCell>
                    </TableRow></TableHead>
                    <TableBody>{metrics.map((metric) => <TableRow key={metric.key}>
                      <TableCell component="th" scope="row">{t(`scenarios.metrics.${metric.key}`)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(metric.baseline)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(metric.scenario)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: metric.delta === null || metric.delta === 0 ? 'text.primary' : metric.delta < 0 ? 'warning.main' : 'success.main' }}>{currency(metric.delta, true)}</TableCell>
                    </TableRow>)}</TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary">{t('scenarios.availableHelp')}</Typography>
                {preview.scenario.lowest_balance !== null && preview.scenario.lowest_balance < 0 && <Alert severity="warning">{t('scenarios.shortfall', { amount: currency(Math.abs(preview.scenario.lowest_balance)) })}</Alert>}
                <Typography component="h4" variant="subtitle2">{t('scenarios.monthlyTitle')}</Typography>
                <TableContainer>
                  <Table size="small" aria-label={t('scenarios.monthlyTitle')}>
                    <TableHead><TableRow>
                      <TableCell>{t('scenarios.month')}</TableCell>
                      <TableCell align="right">{t('scenarios.baseline')}</TableCell>
                      <TableCell align="right">{t('scenarios.scenario')}</TableCell>
                      <TableCell align="right">{t('scenarios.difference')}</TableCell>
                    </TableRow></TableHead>
                    <TableBody>{preview.scenario.monthly.map((month) => {
                      const baseline = preview.baseline.monthly.find((entry) => entry.month === month.month)?.ending_balance;
                      const delta = typeof baseline === 'number' && month.ending_balance !== null ? month.ending_balance - baseline : null;
                      return <TableRow key={month.month}>
                        <TableCell component="th" scope="row">{new Date(`${month.month}-01T12:00:00`).toLocaleDateString(i18n.resolvedLanguage || i18n.language, { month: 'short', year: 'numeric' })}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(baseline)}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(month.ending_balance)}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(delta, true)}</TableCell>
                      </TableRow>;
                    })}</TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary">{t('scenarios.projectionHelp', { date: dateLabel(preview.baseline.as_of_date) })}</Typography>
              </Stack>}
            </Stack>}
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={closeEditor}>{t('shared.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>{t('scenarios.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => { if (!saving) setDeleting(null); }} maxWidth="xs" fullWidth aria-labelledby="scenario-delete-title">
        <DialogTitle id="scenario-delete-title">{t('scenarios.deleteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('scenarios.deleteBody', { name: deleting?.name })}</DialogContentText>
          {actionError && <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setDeleting(null)}>{t('shared.cancel')}</Button>
          <Button disabled={saving} color="error" variant="contained" onClick={() => void confirmDelete()}>{t('shared.delete')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
