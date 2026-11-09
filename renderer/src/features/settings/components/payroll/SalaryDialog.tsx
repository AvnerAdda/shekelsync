import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import {
  ContributionPlan,
  PayrollMember,
  PayrollMemberView,
  PayrollSetup,
  PlanKind,
  SalaryCandidate,
  SalaryMatchRule,
  buildDraftPlans,
  candidateMatchesRule,
  computeContributionBreakdown,
  computePlanContribution,
  sortAccountsForPlan,
} from './payroll-model';

const NO_DEPOSIT = '';
const CURRENT_RULE = '__current__';

interface SalaryDialogProps {
  open: boolean;
  view: PayrollMemberView;
  setup: PayrollSetup;
  memberLabel: string;
  memberLabels: Record<PayrollMember, string>;
  onClose: () => void;
  onSaved: (view: PayrollMemberView) => void;
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const SalaryDialog: React.FC<SalaryDialogProps> = ({
  open,
  view,
  setup,
  memberLabel,
  memberLabels,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation('translation', { keyPrefix: 'settings.payroll' });
  const { formatCurrency } = useFinancePrivacy();
  const employment = view.employment;

  const [employerName, setEmployerName] = useState('');
  const [grossInput, setGrossInput] = useState('');
  const [depositKey, setDepositKey] = useState(NO_DEPOSIT);
  const [plans, setPlans] = useState<ContributionPlan[]>([]);
  const [candidates, setCandidates] = useState<SalaryCandidate[]>([]);
  const [candidatesState, setCandidatesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset the draft every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setEmployerName(employment?.employer_name ?? '');
    setGrossInput(employment?.gross_monthly != null ? String(employment.gross_monthly) : '');
    setDepositKey(employment?.salary_match_pattern ? CURRENT_RULE : NO_DEPOSIT);
    setPlans(buildDraftPlans(view.plans, setup.defaults.plans, setup.accounts, setup.defaults.preferredAccountTypes));
    setSaveError(null);
  }, [open, employment, view.plans, setup]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setCandidatesState('loading');
    apiClient.get<{ candidates: SalaryCandidate[] }>('/api/payroll/salary-candidates')
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(response.statusText);
        const list = response.data?.candidates ?? [];
        setCandidates(list);
        setCandidatesState('ready');
        setDepositKey((current) => {
          if (current === CURRENT_RULE && employment) {
            return list.find((candidate) => candidateMatchesRule(candidate, employment))?.key ?? CURRENT_RULE;
          }
          if (current === NO_DEPOSIT && !employment) {
            // New setup: suggest the first salary-looking deposit nobody claims yet.
            return list.find((candidate) => candidate.looksLikeSalary && !candidate.claimedBy)?.key ?? NO_DEPOSIT;
          }
          return current;
        });
      })
      .catch(() => {
        if (!cancelled) setCandidatesState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, employment]);

  const gross = parseOptionalNumber(grossInput);
  const grossInvalid = grossInput.trim() !== '' && (gross === null || gross < 0);
  const breakdown = useMemo(() => computeContributionBreakdown(gross, plans), [gross, plans]);
  const missingAccount = plans.some((plan) => plan.is_active === 1 && plan.account_id === null);

  const selectedRule: SalaryMatchRule = useMemo(() => {
    if (depositKey === CURRENT_RULE && employment) {
      return {
        salary_match_pattern: employment.salary_match_pattern,
        salary_match_vendor: employment.salary_match_vendor,
        salary_match_account_number: employment.salary_match_account_number,
      };
    }
    const candidate = candidates.find((item) => item.key === depositKey);
    return candidate?.match ?? {
      salary_match_pattern: null,
      salary_match_vendor: null,
      salary_match_account_number: null,
    };
  }, [candidates, depositKey, employment]);

  const updatePlan = (kind: PlanKind, patch: Partial<ContributionPlan>) => {
    setPlans((current) => current.map((plan) => (plan.kind === kind ? { ...plan, ...patch } : plan)));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await apiClient.put<PayrollMemberView & { error?: string }>(`/api/payroll/${view.member}`, {
        employer_name: employerName,
        gross_monthly: gross,
        ...selectedRule,
        is_active: 1,
        plans: plans.map(({ id: _id, ...plan }) => plan),
      });
      if (!response.ok) {
        throw new Error(response.data?.error || response.statusText);
      }
      onSaved(response.data);
    } catch (error) {
      setSaveError(t('dialog.saveError', { message: error instanceof Error ? error.message : '' }));
    } finally {
      setSaving(false);
    }
  };

  const formatAmount = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });

  const renderCandidateLabel = (candidate: SalaryCandidate) => {
    const source = candidate.vendorNickname || candidate.vendor;
    const parts = [
      candidate.name,
      source,
      formatAmount(candidate.medianAmount),
      t('dialog.depositMonths', { count: candidate.monthCount }),
    ];
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('dialog.title', { name: memberLabel })}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t('dialog.employer')}
              fullWidth
              value={employerName}
              onChange={(event) => setEmployerName(event.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t('dialog.gross')}
              fullWidth
              type="number"
              value={grossInput}
              error={grossInvalid}
              onChange={(event) => setGrossInput(event.target.value)}
              helperText={t('dialog.grossHelper')}
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">₪</InputAdornment> },
                htmlInput: { min: 0, step: 100 },
              }}
            />
          </Grid>
        </Grid>

        <FormControl fullWidth sx={{ mb: 1 }}>
          <InputLabel id="payroll-deposit-label">{t('dialog.deposit')}</InputLabel>
          <Select
            labelId="payroll-deposit-label"
            label={t('dialog.deposit')}
            value={depositKey}
            onChange={(event) => setDepositKey(String(event.target.value))}
            endAdornment={candidatesState === 'loading' ? <CircularProgress size={18} sx={{ mr: 3 }} /> : undefined}
          >
            <MenuItem value={NO_DEPOSIT}>{t('dialog.depositNone')}</MenuItem>
            {depositKey === CURRENT_RULE && employment?.salary_match_pattern && (
              <MenuItem value={CURRENT_RULE}>
                {t('dialog.depositCurrent', { pattern: employment.salary_match_pattern })}
              </MenuItem>
            )}
            {candidates.map((candidate) => {
              const claimedByOther = candidate.claimedBy && candidate.claimedBy !== view.member;
              return (
                <MenuItem key={candidate.key} value={candidate.key} disabled={Boolean(claimedByOther)}>
                  {renderCandidateLabel(candidate)}
                  {claimedByOther && (
                    <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                      ({t('dialog.depositClaimed', { member: memberLabels[candidate.claimedBy as PayrollMember] })})
                    </Typography>
                  )}
                </MenuItem>
              );
            })}
          </Select>
          <FormHelperText>
            {candidatesState === 'error'
              ? t('dialog.candidatesError')
              : candidatesState === 'ready' && candidates.length === 0
                ? t('dialog.candidatesEmpty')
                : t('dialog.depositHelper')}
          </FormHelperText>
        </FormControl>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('dialog.plansTitle')}</Typography>

        <Stack spacing={2}>
          {plans.map((plan) => {
            const contribution = computePlanContribution(gross, plan);
            const accounts = sortAccountsForPlan(setup.accounts, setup.defaults.preferredAccountTypes[plan.kind]);
            const active = plan.is_active === 1;
            return (
              <Box
                key={plan.kind}
                data-testid={`payroll-plan-${plan.kind}`}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={active}
                        onChange={(event) => updatePlan(plan.kind, { is_active: event.target.checked ? 1 : 0 })}
                      />
                    )}
                    label={t(`kinds.${plan.kind}`)}
                  />
                  {active && (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {t('dialog.planMonthly', { total: formatAmount(contribution.total) })}
                    </Typography>
                  )}
                </Box>
                {active && (
                  <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                    <Grid size={{ xs: 12, sm: plan.kind === 'keren_hishtalmut' ? 12 : 6 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel id={`payroll-account-${plan.kind}`}>{t('dialog.account')}</InputLabel>
                        <Select
                          labelId={`payroll-account-${plan.kind}`}
                          label={t('dialog.account')}
                          value={plan.account_id ?? ''}
                          onChange={(event) => {
                            const value = event.target.value as number | '';
                            updatePlan(plan.kind, { account_id: value === '' ? null : Number(value) });
                          }}
                        >
                          <MenuItem value="">{t('dialog.accountNone')}</MenuItem>
                          {accounts.map((account) => (
                            <MenuItem key={account.id} value={account.id}>
                              {account.account_name}{account.institution ? ` · ${account.institution}` : ''}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {plan.kind !== 'severance' && (
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <TextField
                          label={t('dialog.employeePct')}
                          size="small"
                          type="number"
                          fullWidth
                          value={plan.employee_pct}
                          onChange={(event) => updatePlan(plan.kind, { employee_pct: parseOptionalNumber(event.target.value) ?? 0 })}
                          slotProps={{ htmlInput: { min: 0, max: 100, step: 0.5 } }}
                        />
                      </Grid>
                    )}
                    <Grid size={{ xs: 6, sm: plan.kind === 'severance' ? 6 : 3 }}>
                      <TextField
                        label={t('dialog.employerPct')}
                        size="small"
                        type="number"
                        fullWidth
                        value={plan.employer_pct}
                        onChange={(event) => updatePlan(plan.kind, { employer_pct: parseOptionalNumber(event.target.value) ?? 0 })}
                        slotProps={{ htmlInput: { min: 0, max: 100, step: 0.01 } }}
                      />
                    </Grid>
                    {plan.kind === 'keren_hishtalmut' && (
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label={t('dialog.salaryCap')}
                          size="small"
                          type="number"
                          fullWidth
                          value={plan.salary_cap ?? ''}
                          onChange={(event) => updatePlan(plan.kind, { salary_cap: parseOptionalNumber(event.target.value) })}
                          helperText={t('dialog.salaryCapHelper')}
                          slotProps={{ htmlInput: { min: 0, step: 1 } }}
                        />
                      </Grid>
                    )}
                    <Grid size={{ xs: 12, sm: plan.kind === 'keren_hishtalmut' ? 6 : 12 }}>
                      <TextField
                        label={t('dialog.startDate')}
                        size="small"
                        type="date"
                        fullWidth
                        value={plan.start_date ?? ''}
                        onChange={(event) => updatePlan(plan.kind, { start_date: event.target.value || null })}
                        slotProps={{ inputLabel: { shrink: true } }}
                      />
                    </Grid>
                  </Grid>
                )}
              </Box>
            );
          })}
        </Stack>

        {missingAccount && (
          <Alert severity="warning" sx={{ mt: 2 }}>{t('dialog.noAccountWarning')}</Alert>
        )}
        <Alert severity="info" sx={{ mt: 2 }} data-testid="payroll-preview">
          {t('dialog.preview', {
            total: formatAmount(breakdown.totals.total),
            employee: formatAmount(breakdown.totals.employee),
            employer: formatAmount(breakdown.totals.employer),
          })}
        </Alert>
        <Typography variant="caption" component="p" sx={{ mt: 1, color: 'text.secondary' }}>
          {t('estimateNote')}
        </Typography>
        {saveError && <Alert severity="error" sx={{ mt: 2 }}>{saveError}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('dialog.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || grossInvalid || gross === null}
        >
          {saving ? t('dialog.saving') : t('dialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SalaryDialog;
