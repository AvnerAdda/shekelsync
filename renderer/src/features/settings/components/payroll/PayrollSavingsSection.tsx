import React, { useCallback, useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SavingsIcon from '@mui/icons-material/Savings';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useDeleteConfirmation } from '@renderer/shared/hooks/useDeleteConfirmation';
import { PayrollMember, PayrollMemberView, PayrollSetup, formatIsoDate } from './payroll-model';
import SalaryDialog from './SalaryDialog';

interface PayrollSavingsSectionProps {
  /** Live (possibly unsaved) marital status from the profile form. */
  isMarried: boolean;
  selfName?: string | null;
  spouseName?: string | null;
}

const PayrollSavingsSection: React.FC<PayrollSavingsSectionProps> = ({ isMarried, selfName, spouseName }) => {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'settings.payroll' });
  const { formatCurrency } = useFinancePrivacy();
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation();
  const [setup, setSetup] = useState<PayrollSetup | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editingMember, setEditingMember] = useState<PayrollMember | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<PayrollSetup>('/api/payroll');
      if (!response.ok) throw new Error(response.statusText);
      setSetup(response.data);
      setLoadError(false);
    } catch (error) {
      console.error('Error loading payroll setup:', error);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const memberLabels: Record<PayrollMember, string> = {
    self: selfName?.trim() || t('members.self'),
    spouse: spouseName?.trim() || t('members.spouse'),
  };

  const replaceMember = (view: PayrollMemberView) => {
    setSetup((current) => current && {
      ...current,
      members: current.members.map((entry) => (entry.member === view.member ? view : entry)),
    });
  };

  const handleRemove = async (member: PayrollMember) => {
    if (!await confirmDelete(memberLabels[member], t('card.removeBody'))) return;
    const response = await apiClient.delete<PayrollMemberView>(`/api/payroll/${member}`);
    if (response.ok) {
      replaceMember(response.data);
    } else {
      void load();
    }
  };

  const formatAmount = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });
  const accountName = (accountId: number | null) =>
    setup?.accounts.find((account) => account.id === accountId)?.account_name ?? t('card.noAccount');

  const visibleMembers = (setup?.members ?? []).filter((view) => view.member === 'self' || isMarried);
  const editingView = setup?.members.find((view) => view.member === editingMember) ?? null;

  return (
    <Accordion data-testid="payroll-savings-section">
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SavingsIcon fontSize="small" />
          <Typography variant="h6">{t('title')}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {t('intro')}
        </Typography>
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{t('loadError')}</Alert>}
        {!setup && !loadError && <CircularProgress size={24} />}
        {setup && (
          <Grid container spacing={2}>
            {visibleMembers.map((view) => {
              const employment = view.employment;
              const activePlans = view.plans.filter((plan) => plan.is_active === 1);
              const studyFund = activePlans.find((plan) => plan.kind === 'keren_hishtalmut' && plan.withdrawable_from);
              return (
                <Grid size={{ xs: 12, md: 6 }} key={view.member}>
                  <Card variant="outlined" data-testid={`payroll-card-${view.member}`} sx={{ height: '100%' }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="h6" component="div">{memberLabels[view.member]}</Typography>
                        {employment?.employer_name && (
                          <Chip label={employment.employer_name} size="small" />
                        )}
                        {employment && employment.is_active !== 1 && (
                          <Chip label={t('card.paused')} size="small" color="warning" />
                        )}
                      </Box>
                      {!employment ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('card.notSetUp')}</Typography>
                      ) : (
                        <>
                          {employment.gross_monthly != null && (
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              {t('card.gross', { amount: formatAmount(employment.gross_monthly) })}
                            </Typography>
                          )}
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                            {view.breakdown.items.map((item) => {
                              const plan = activePlans.find((entry) => entry.kind === item.kind);
                              return (
                                <Chip
                                  key={item.kind}
                                  size="small"
                                  variant="outlined"
                                  label={`${t(`kinds.${item.kind}`)}: ${formatAmount(item.total)} → ${accountName(plan?.account_id ?? null)}`}
                                />
                              );
                            })}
                          </Box>
                          {studyFund?.withdrawable_from && (
                            <Chip
                              size="small"
                              data-testid={`payroll-withdrawable-${view.member}`}
                              color={studyFund.is_withdrawable ? 'success' : 'default'}
                              sx={{ mb: 1 }}
                              label={t(studyFund.is_withdrawable ? 'card.withdrawableSince' : 'card.withdrawableFrom', {
                                date: formatIsoDate(studyFund.withdrawable_from, i18n.language),
                              })}
                            />
                          )}
                          {view.breakdown.totals.total > 0 && (
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              {t('card.monthlyTotal', {
                                total: formatAmount(view.breakdown.totals.total),
                                employer: formatAmount(view.breakdown.totals.employer),
                              })}
                            </Typography>
                          )}
                          {!employment.salary_match_pattern && (
                            <Alert severity="warning" sx={{ mt: 1 }}>{t('card.noSalaryLink')}</Alert>
                          )}
                        </>
                      )}
                    </CardContent>
                    <CardActions>
                      <Button size="small" onClick={() => setEditingMember(view.member)}>
                        {employment ? t('card.edit') : t('card.setUp')}
                      </Button>
                      {employment && (
                        <Button size="small" color="error" onClick={() => void handleRemove(view.member)}>
                          {t('card.remove')}
                        </Button>
                      )}
                    </CardActions>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}
        {setup && editingView && (
          <SalaryDialog
            open
            view={editingView}
            setup={setup}
            memberLabel={memberLabels[editingView.member]}
            memberLabels={memberLabels}
            onClose={() => setEditingMember(null)}
            onSaved={(view) => {
              replaceMember(view);
              setEditingMember(null);
            }}
          />
        )}
        {deleteConfirmationDialog}
      </AccordionDetails>
    </Accordion>
  );
};

export default PayrollSavingsSection;
