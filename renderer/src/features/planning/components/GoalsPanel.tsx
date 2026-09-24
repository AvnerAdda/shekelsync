import React, { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  InputAdornment, LinearProgress, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { usePlanningData } from '../hooks/usePlanningData';
import { goalDraft, goalInput, localDateKey } from '../utils/planning-drafts';
import type { GoalDraft } from '../utils/planning-drafts';
import type { SavingsGoal } from '../types';

export default function GoalsPanel() {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'planning' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { data, loading, error, refresh, saveGoal, deleteGoal } = usePlanningData();
  const [editor, setEditor] = useState<{ goal: SavingsGoal | null; draft: GoalDraft } | null>(null);
  const [deleting, setDeleting] = useState<SavingsGoal | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const goals = data?.goals ?? [];
  const todayString = localDateKey();

  const openEditor = (goal: SavingsGoal | null) => {
    setActionError(null);
    setEditor({ goal, draft: goalDraft(goal) });
  };
  const updateDraft = (field: keyof GoalDraft, value: string) => {
    setEditor((current) => current ? { ...current, draft: { ...current.draft, [field]: value } } : null);
    setActionError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor || saving) return;
    const { draft, goal } = editor;
    const input = goalInput(draft);
    if (!input) {
      setActionError(t('goals.validation'));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await saveGoal(input, goal?.id);
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
      await deleteGoal(deleting.id);
      setDeleting(null);
    } catch {
      setActionError(t('shared.deleteError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
            <Box>
              <Typography component="h2" variant="h6">{t('goals.title')}</Typography>
              <Typography variant="body2" color="text.secondary">{t('goals.subtitle')}</Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} disabled={saving} onClick={() => openEditor(null)} sx={{ flexShrink: 0 }}>{t('goals.add')}</Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">{t('goals.allocationNote')}</Typography>
          {error && <Alert severity="error" action={<Button color="inherit" onClick={() => void refresh()}>{t('shared.retry')}</Button>}>{t('shared.loadError')}</Alert>}
          {loading && <LinearProgress aria-label={t('shared.loading')} />}
          {!loading && !error && goals.length === 0 && (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <SavingsOutlinedIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
              <Typography sx={{ fontWeight: 600 }}>{t('goals.emptyTitle')}</Typography>
              <Typography variant="body2" color="text.secondary">{t('goals.emptyBody')}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            {goals.map((goal) => {
              const progress = Math.min(100, Math.max(0, goal.saved_amount / goal.target_amount * 100));
              const status = goal.remaining_amount <= 0 ? 'complete'
                : goal.target_date && goal.target_date < todayString ? 'overdue'
                  : goal.on_track === true ? 'onTrack' : goal.on_track === false ? 'behind' : 'flexible';
              const dateLabel = goal.target_date
                ? new Date(`${goal.target_date}T12:00:00`).toLocaleDateString(i18n.resolvedLanguage || i18n.language)
                : t('goals.noDeadline');
              return (
                <Card key={goal.id} variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent>
                    <Stack spacing={1.5}>
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{goal.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{dateLabel}</Typography>
                        </Box>
                        <Chip size="small" label={t(`goals.status.${status}`)} color={status === 'complete' || status === 'onTrack' ? 'success' : status === 'overdue' || status === 'behind' ? 'warning' : 'default'} />
                      </Stack>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>{t('goals.progress', { saved: formatCurrency(goal.saved_amount), target: formatCurrency(goal.target_amount) })}</Typography>
                      <LinearProgress variant="determinate" value={progress} aria-label={t('goals.progressLabel', { name: goal.name })} sx={{ height: 6, borderRadius: 3 }} />
                      <Box>
                        <Typography variant="body2">{t('goals.plannedContribution', { amount: formatCurrency(goal.monthly_contribution) })}</Typography>
                        {goal.required_monthly_contribution !== null && goal.remaining_amount > 0 && <Typography variant="body2" color={status === 'behind' || status === 'overdue' ? 'warning.main' : 'text.secondary'}>{t('goals.requiredContribution', { amount: formatCurrency(goal.required_monthly_contribution) })}</Typography>}
                        {goal.months_until_target === 0 && goal.remaining_amount > 0 && <Typography variant="body2" color="warning.main">{t('goals.noContributionDates')}</Typography>}
                        <Typography variant="caption" color="text.secondary">{t(`goals.locationDescription.${goal.reserve_location}`)}</Typography>
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" aria-label={t('goals.editNamed', { name: goal.name })} onClick={() => openEditor(goal)}>{t('shared.edit')}</Button>
                        <Button size="small" color="error" aria-label={t('goals.deleteNamed', { name: goal.name })} onClick={() => { setActionError(null); setDeleting(goal); }}>{t('shared.delete')}</Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        </Stack>
      </CardContent>

      <Dialog open={Boolean(editor)} onClose={() => { if (!saving) setEditor(null); }} fullWidth maxWidth="sm" aria-labelledby="goal-editor-title">
        <Box component="form" onSubmit={submit} noValidate sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <DialogTitle id="goal-editor-title">{t(editor?.goal ? 'goals.edit' : 'goals.add')}</DialogTitle>
          <DialogContent>
            {editor && <Stack spacing={2} sx={{ pt: 1 }}>
              {actionError && <Alert severity="error">{actionError}</Alert>}
              <TextField label={t('goals.name')} value={editor.draft.name} onChange={(event) => updateDraft('name', event.target.value)} required fullWidth disabled={saving} slotProps={{ htmlInput: { maxLength: 120 } }} />
              {(['target_amount', 'saved_amount', 'monthly_contribution'] as const).map((field) => (
                <TextField key={field} label={t(`goals.fields.${field}`)} type={maskAmounts ? 'password' : 'number'} value={editor.draft[field]} onChange={(event) => updateDraft(field, event.target.value)} required fullWidth disabled={saving} autoComplete="off" helperText={field === 'monthly_contribution' ? t('goals.contributionSchedule') : undefined} slotProps={{ htmlInput: { min: field === 'target_amount' ? 0.01 : 0, max: 1e9, step: '0.01', inputMode: 'decimal' }, input: { startAdornment: <InputAdornment position="start">₪</InputAdornment> } }} />
              ))}
              <TextField label={t('goals.deadline')} type="date" value={editor.draft.target_date} onChange={(event) => updateDraft('target_date', event.target.value)} fullWidth disabled={saving} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: '2000-01-01', max: '2200-12-31' } }} helperText={t('goals.deadlineHelp')} />
              <TextField select label={t('goals.location')} value={editor.draft.reserve_location} onChange={(event) => updateDraft('reserve_location', event.target.value)} fullWidth disabled={saving} helperText={t(`goals.locationDescription.${editor.draft.reserve_location}`)}>
                <MenuItem value="included_cash">{t('goals.locations.included_cash')}</MenuItem>
                <MenuItem value="external">{t('goals.locations.external')}</MenuItem>
              </TextField>
              <Alert severity="info">{t('goals.allocationNote')}</Alert>
            </Stack>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditor(null)} disabled={saving}>{t('shared.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>{t('shared.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => { if (!saving) setDeleting(null); }} maxWidth="xs" fullWidth aria-labelledby="goal-delete-title">
        <DialogTitle id="goal-delete-title">{t('goals.deleteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('goals.deleteBody', { name: deleting?.name })}</DialogContentText>
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
