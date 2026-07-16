import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  Fab,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import EditIcon from '@mui/icons-material/Edit';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DoneIcon from '@mui/icons-material/Done';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';

import { apiClient } from '@renderer/lib/api-client';
import { useChatbotPermissions, MODEL_TIERS } from '@app/contexts/ChatbotPermissionsContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';
import { maskFinancialText } from '@renderer/shared/utils/finance-privacy';
import type {
  OptimizerFact,
  OptimizerQuestion,
  OptimizerRecommendation,
  OptimizerStatusResponse,
} from '@renderer/types/optimizer';

type OptimizerView = 'review' | 'quiz' | 'plan';

const DRAWER_WIDTH = 460;

const FACT_TRANSLATION_KEYS: Record<string, string> = {
  'start.location': 'location',
  'household.size': 'householdSize',
  'income.monthly_take_home': 'monthlyIncome',
  'expenses.fixed_monthly': 'fixedExpenses',
  'expenses.variable_monthly': 'variableExpenses',
  'expenses.monthly_total': 'totalExpenses',
  'pain.top_expenses': 'topExpenses',
  'goals.urgent_goal': 'urgentGoal',
  'preferences.hassle_tolerance': 'hassleTolerance',
  'banking.cash_balance': 'cashBalance',
  'housing.status': 'housingStatus',
  'subscriptions.monthly_total': 'subscriptionsTotal',
  'constraints.providers_refuse_leave': 'protectedProviders',
  'constraints.quality_minimums': 'qualityMinimums',
};

function getFactInputValue(fact: OptimizerFact): string {
  if (typeof fact.value === 'number') return String(fact.value);
  if (typeof fact.value === 'string') return fact.value;
  return fact.valueText || '';
}

function parseQuestionValue(question: OptimizerQuestion, value: string): unknown {
  if (question.inputType === 'number' || question.inputType === 'currency') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value.trim();
}

function parseFactValue(fact: OptimizerFact, value: string): unknown {
  return parseQuestionValue({
    factKey: fact.factKey,
    section: fact.section,
    label: fact.label,
    prompt: fact.label,
    inputType: fact.inputType,
    options: fact.options,
  }, value);
}

const FinancialOptimizer: React.FC = () => {
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'optimizer' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const {
    hasOpenAiApiKey: hasStoredOpenAiApiKey,
    openAiApiKey,
    chatModelTier,
  } = useChatbotPermissions();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<OptimizerView>('review');
  const [status, setStatus] = useState<OptimizerStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [updatingRecommendationId, setUpdatingRecommendationId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingFactKey, setEditingFactKey] = useState<string | null>(null);
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>(undefined);
  const statusRequestSequence = useRef(0);
  const writeInFlight = useRef(false);

  const hasOpenAiApiKey = hasStoredOpenAiApiKey || openAiApiKey.trim().length > 0;
  const shouldSendApiKeyInBody = !window.electronAPI?.chatbotSecrets;

  const loadStatus = useCallback(async () => {
    const requestId = statusRequestSequence.current + 1;
    statusRequestSequence.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<OptimizerStatusResponse>('/api/optimizer/status');
      if (!response.ok || !response.data) {
        throw new Error(t('errors.status', 'Failed to load Optimizator'));
      }
      if (requestId !== statusRequestSequence.current) return;
      setStatus(response.data);
      setFactDrafts(Object.fromEntries(
        response.data.facts.map((fact) => [fact.factKey, getFactInputValue(fact)]),
      ));
      setQuestionDrafts((prev) => Object.fromEntries(
        response.data.questions
          .filter((question) => prev[question.factKey] !== undefined)
          .map((question) => [question.factKey, prev[question.factKey]]),
      ));
    } catch (requestError) {
      if (requestId === statusRequestSequence.current) {
        setError(requestError instanceof Error ? requestError.message : t('errors.generic', 'Something went wrong'));
      }
    } finally {
      if (requestId === statusRequestSequence.current) {
        setLoading(false);
      }
    }
  }, [t]);
  const loadStatusRef = useRef(loadStatus);
  loadStatusRef.current = loadStatus;

  useEffect(() => {
    const handleOpenOptimizer = () => setOpen(true);
    window.addEventListener('openOptimizerDrawer', handleOpenOptimizer);
    return () => window.removeEventListener('openOptimizerDrawer', handleOpenOptimizer);
  }, []);

  useEffect(() => {
    if (open) {
      void loadStatusRef.current();
    }
  }, [open]);

  useEffect(() => {
    const handleDataRefresh = () => {
      if (open) void loadStatusRef.current();
    };
    window.addEventListener('dataRefresh', handleDataRefresh);
    return () => window.removeEventListener('dataRefresh', handleDataRefresh);
  }, [open]);

  const factsBySection = useMemo(() => {
    const grouped = new Map<string, OptimizerFact[]>();
    (status?.facts || []).forEach((fact) => {
      const items = grouped.get(fact.section) || [];
      items.push(fact);
      grouped.set(fact.section, items);
    });
    return Array.from(grouped.entries());
  }, [status?.facts]);

  const recommendations = status?.recommendations || [];
  const activeRecommendations = recommendations.filter((recommendation) => recommendation.status === 'active');
  const mutationBusy = savingKey !== null || updatingRecommendationId !== null || generating;

  const getSectionLabel = (section: string): string => (
    t(`sections.${section}`, { defaultValue: section })
  );

  const getFactLabel = (factKey: string, fallback: string): string => {
    const translationKey = FACT_TRANSLATION_KEYS[factKey];
    return translationKey
      ? t(`facts.${translationKey}.label`, { defaultValue: fallback })
      : fallback;
  };

  const getQuestionPrompt = (question: OptimizerQuestion): string => {
    const translationKey = FACT_TRANSLATION_KEYS[question.factKey];
    return translationKey
      ? t(`facts.${translationKey}.prompt`, { defaultValue: question.prompt })
      : question.prompt;
  };

  const getFactDisplayValue = (fact: OptimizerFact): string => {
    if (fact.inputType === 'currency') {
      const amount = typeof fact.value === 'number' ? fact.value : Number(fact.value);
      if (Number.isFinite(amount)) return formatCurrency(amount);
    }
    const value = fact.valueText || t('unknown', 'Unknown');
    return maskAmounts ? maskFinancialText(value) : value;
  };

  const displayPlanText = (value: string | null): string | null => {
    if (!value) return value;
    return maskAmounts ? maskFinancialText(value) : value;
  };

  const handleWriteError = (responseData: unknown, fallback: string): void => {
    const licenseCheck = isLicenseReadOnlyError(responseData);
    if (licenseCheck.isReadOnly) {
      setLicenseAlertReason(licenseCheck.reason);
      setLicenseAlertOpen(true);
      return;
    }
    const payload = responseData as { error?: string } | null;
    setError(payload?.error || fallback);
  };

  const saveFact = async (
    fact: Pick<OptimizerFact, 'factKey' | 'section' | 'label' | 'value' | 'valueText' | 'evidence' | 'confidence' | 'persisted'>,
    statusValue: OptimizerFact['status'],
  ) => {
    if (writeInFlight.current) return;
    writeInFlight.current = true;
    setSavingKey(fact.factKey);
    setError(null);
    try {
      const response = await apiClient.put('/api/optimizer/facts', {
        facts: [{
          factKey: fact.factKey,
          section: fact.section,
          label: fact.label,
          value: statusValue === 'unknown' || statusValue === 'skipped' ? null : fact.value,
          valueText: statusValue === 'unknown' || statusValue === 'skipped' ? null : fact.valueText,
          status: statusValue,
          source: statusValue === 'confirmed' && !fact.persisted ? 'detected_confirmed' : 'user',
          confidence: statusValue === 'confirmed' ? fact.confidence ?? 0.8 : 1,
          evidence: fact.evidence || null,
        }],
      });
      if (!response.ok) {
        handleWriteError(response.data, t('errors.save', 'Failed to save answer'));
        return;
      }
      await loadStatus();
      setEditingFactKey(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('errors.generic', 'Something went wrong'));
    } finally {
      writeInFlight.current = false;
      setSavingKey(null);
    }
  };

  const saveEditedFact = async (fact: OptimizerFact) => {
    const draft = factDrafts[fact.factKey] || '';
    if (draft.trim().length === 0) {
      setError(t('errors.emptyAnswer', 'Enter an answer, skip it, or mark it unknown.'));
      return;
    }
    const value = parseFactValue(fact, draft);
    if (value === null) {
      setError(t('errors.invalidNumber', 'Enter a valid number.'));
      return;
    }
    await saveFact({
      factKey: fact.factKey,
      section: fact.section,
      label: fact.label,
      value,
      valueText: draft,
      evidence: fact.evidence,
      confidence: 1,
    }, 'edited');
  };

  const saveQuestionAnswer = async (question: OptimizerQuestion, answerStatus: 'edited' | 'skipped' | 'unknown') => {
    const draft = questionDrafts[question.factKey] || '';
    if (answerStatus === 'edited' && draft.trim().length === 0) {
      setError(t('errors.emptyAnswer', 'Enter an answer, skip it, or mark it unknown.'));
      return;
    }
    const parsedValue = parseQuestionValue(question, draft);
    if (answerStatus === 'edited' && parsedValue === null) {
      setError(t('errors.invalidNumber', 'Enter a valid number.'));
      return;
    }
    await saveFact({
      factKey: question.factKey,
      section: question.section,
      label: question.label,
      value: parsedValue,
      valueText: draft,
      evidence: null,
      confidence: 1,
    }, answerStatus);
  };

  const generatePlan = async () => {
    if (!hasOpenAiApiKey) {
      setError(t('errors.missingApiKey', 'Add an OpenAI API key in Settings before generating a plan.'));
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const response = await apiClient.post('/api/optimizer/generate', {
        model: MODEL_TIERS[chatModelTier].model,
        locale: i18n.resolvedLanguage || i18n.language,
        ...(shouldSendApiKeyInBody ? { openaiApiKey: openAiApiKey.trim() } : {}),
      });
      if (!response.ok) {
        handleWriteError(response.data, t('errors.generate', 'Failed to generate plan'));
        return;
      }
      await loadStatus();
      setView('plan');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('errors.generic', 'Something went wrong'));
    } finally {
      setGenerating(false);
    }
  };

  const updateRecommendationStatus = async (
    recommendation: OptimizerRecommendation,
    nextStatus: OptimizerRecommendation['status'],
  ) => {
    if (writeInFlight.current) return;
    writeInFlight.current = true;
    setUpdatingRecommendationId(recommendation.id);
    setError(null);
    try {
      const response = await apiClient.put(`/api/optimizer/recommendations/${recommendation.id}/status`, {
        status: nextStatus,
      });
      if (!response.ok) {
        handleWriteError(response.data, t('errors.recommendationStatus', 'Failed to update recommendation'));
        return;
      }
      await loadStatus();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('errors.generic', 'Something went wrong'));
    } finally {
      writeInFlight.current = false;
      setUpdatingRecommendationId(null);
    }
  };

  const renderFactCard = (fact: OptimizerFact) => {
    const isEditing = editingFactKey === fact.factKey;
    const translatedLabel = getFactLabel(fact.factKey, fact.label);

    return (
      <Paper
        key={fact.factKey}
        variant="outlined"
        sx={{ p: 1.5, borderRadius: 1, bgcolor: alpha(theme.palette.background.paper, 0.9) }}
      >
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "flex-start",
              justifyContent: "space-between"
            }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2">{translatedLabel}</Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  overflowWrap: 'anywhere'
                }}>
                {getFactDisplayValue(fact)}
              </Typography>
            </Box>
            <Chip
              size="small"
              label={t(`statuses.${fact.status}`, { defaultValue: fact.status })}
              color={fact.status === 'confirmed' || fact.status === 'edited' ? 'success' : 'default'}
              variant="outlined"
            />
          </Stack>

          {isEditing && (fact.inputType === 'select' ? (
            <FormControl size="small" fullWidth>
              <InputLabel id={`optimizer-fact-${fact.factKey}-label`}>{t('answer', 'Answer')}</InputLabel>
              <Select
                labelId={`optimizer-fact-${fact.factKey}-label`}
                label={t('answer', 'Answer')}
                value={factDrafts[fact.factKey] ?? getFactInputValue(fact)}
                onChange={(event) => setFactDrafts((prev) => ({ ...prev, [fact.factKey]: String(event.target.value) }))}
              >
                {(fact.options || []).map((option) => (
                  <MenuItem key={option} value={option}>{t(`options.${option}`, { defaultValue: option })}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <TextField
              size="small"
              label={translatedLabel}
              type={maskAmounts && fact.inputType === 'currency'
                ? 'password'
                : fact.inputType === 'number' || fact.inputType === 'currency' ? 'number' : 'text'}
              value={factDrafts[fact.factKey] ?? getFactInputValue(fact)}
              onChange={(event) => setFactDrafts((prev) => ({ ...prev, [fact.factKey]: event.target.value }))}
              fullWidth
            />
          ))}

          <Stack direction="row" spacing={1} useFlexGap sx={{
            flexWrap: "wrap"
          }}>
            {fact.status === 'detected' && fact.value !== null && fact.value !== undefined && (
              <Button
                size="small"
                startIcon={<CheckIcon />}
                disabled={mutationBusy}
                onClick={() => saveFact(fact, 'confirmed')}
              >
                {t('actions.confirm', 'Confirm')}
              </Button>
            )}
            {isEditing ? (
              <Button size="small" startIcon={<CheckIcon />} disabled={mutationBusy} onClick={() => saveEditedFact(fact)}>
                {t('actions.save', 'Save')}
              </Button>
            ) : (
              <Button
                size="small"
                startIcon={<EditIcon />}
                disabled={mutationBusy}
                onClick={() => {
                  setFactDrafts((prev) => ({ ...prev, [fact.factKey]: getFactInputValue(fact) }));
                  setEditingFactKey(fact.factKey);
                }}
              >
                {t('actions.edit', 'Edit')}
              </Button>
            )}
            <Button
              size="small"
              startIcon={<HelpOutlineIcon />}
              disabled={mutationBusy}
              onClick={() => saveFact({ ...fact, value: null, valueText: null }, 'unknown')}
            >
              {t('actions.unknown', 'Unknown')}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    );
  };

  const renderQuestion = (question: OptimizerQuestion) => (
    <Paper key={question.factKey} variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
      <Stack spacing={1.25}>
        <Typography variant="subtitle2">{getFactLabel(question.factKey, question.label)}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>{getQuestionPrompt(question)}</Typography>
        {question.inputType === 'select' ? (
          <FormControl size="small" fullWidth>
            <InputLabel id={`optimizer-question-${question.factKey}-label`}>{t('answer', 'Answer')}</InputLabel>
            <Select
              labelId={`optimizer-question-${question.factKey}-label`}
              label={t('answer', 'Answer')}
              value={questionDrafts[question.factKey] || ''}
              onChange={(event) => setQuestionDrafts((prev) => ({ ...prev, [question.factKey]: String(event.target.value) }))}
            >
              {(question.options || []).map((option) => (
                <MenuItem key={option} value={option}>{t(`options.${option}`, { defaultValue: option })}</MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : (
          <TextField
            size="small"
            label={t('answer', 'Answer')}
            type={maskAmounts && question.inputType === 'currency'
              ? 'password'
              : question.inputType === 'number' || question.inputType === 'currency' ? 'number' : 'text'}
            value={questionDrafts[question.factKey] || ''}
            onChange={(event) => setQuestionDrafts((prev) => ({ ...prev, [question.factKey]: event.target.value }))}
            fullWidth
          />
        )}
        <Stack direction="row" spacing={1} useFlexGap sx={{
          flexWrap: "wrap"
        }}>
          <Button
            size="small"
            variant="contained"
            disabled={mutationBusy}
            onClick={() => saveQuestionAnswer(question, 'edited')}
          >
            {t('actions.save', 'Save')}
          </Button>
          <Button size="small" disabled={mutationBusy} onClick={() => saveQuestionAnswer(question, 'unknown')}>
            {t('actions.unknown', 'Unknown')}
          </Button>
          <Button size="small" disabled={mutationBusy} onClick={() => saveQuestionAnswer(question, 'skipped')}>
            {t('actions.skip', 'Skip')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );

  const renderRecommendation = (recommendation: OptimizerRecommendation) => (
    <Paper key={recommendation.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
      <Stack spacing={1}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            justifyContent: "space-between",
            alignItems: "flex-start"
          }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{
              fontWeight: 700
            }}>{displayPlanText(recommendation.title)}</Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{displayPlanText(recommendation.rationale)}</Typography>
          </Box>
          <Chip
            size="small"
            label={formatCurrency(recommendation.estimatedMonthlyImpact, { showSign: true })}
            color={recommendation.estimatedMonthlyImpact > 0 ? 'success' : 'default'}
          />
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap sx={{
          flexWrap: "wrap"
        }}>
          <Chip size="small" label={getSectionLabel(recommendation.section)} variant="outlined" />
          <Chip
            size="small"
            label={`${t('hassle', 'Hassle')}: ${t(`hassleLevels.${recommendation.hassleLevel}`, { defaultValue: recommendation.hassleLevel })}`}
            variant="outlined"
          />
          <Chip size="small" label={`${Math.round(recommendation.confidence * 100)}%`} variant="outlined" />
          <Chip
            size="small"
            label={t(`statuses.${recommendation.status}`, { defaultValue: recommendation.status })}
            color={recommendation.status === 'active' ? 'primary' : 'default'}
            variant="outlined"
          />
        </Stack>
        {recommendation.evidence.length > 0 && (
          <Stack spacing={0.5}>
            {recommendation.evidence.slice(0, 3).map((item) => (
              <Typography key={item} variant="caption" sx={{
                color: "text.secondary"
              }}>- {displayPlanText(item)}</Typography>
            ))}
          </Stack>
        )}
        {recommendation.nextAction && (
          <Typography variant="body2"><strong>{t('nextAction', 'Next')}:</strong> {displayPlanText(recommendation.nextAction)}</Typography>
        )}
        {recommendation.caveat && (
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>{displayPlanText(recommendation.caveat)}</Typography>
        )}
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            startIcon={<DoneIcon />}
            disabled={mutationBusy || recommendation.status === 'done'}
            onClick={() => updateRecommendationStatus(recommendation, 'done')}
          >
            {t('actions.done', 'Done')}
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<DeleteOutlineIcon />}
            disabled={mutationBusy || recommendation.status === 'dismissed'}
            onClick={() => updateRecommendationStatus(recommendation, 'dismissed')}
          >
            {t('actions.dismiss', 'Dismiss')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );

  return (
    <>
      <Tooltip title={t('fabTooltip', 'Open Optimizator')}>
        <Fab
          color="secondary"
          variant={isSmall ? 'circular' : 'extended'}
          aria-label={t('title', 'Optimizator')}
          onClick={() => setOpen(true)}
          sx={{
            position: 'fixed',
            bottom: 92,
            right: 24,
            zIndex: (muiTheme) => muiTheme.zIndex.drawer + 2,
            boxShadow: `0 8px 28px ${alpha(theme.palette.secondary.main, 0.35)}`,
            gap: 1,
            display: open ? 'none' : 'inline-flex',
          }}
        >
          <TipsAndUpdatesIcon />
          {!isSmall && <span>{t('title', 'Optimizator')}</span>}
        </Fab>
      </Tooltip>
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        sx={{ zIndex: (muiTheme) => muiTheme.zIndex.drawer + 3 }}
        slotProps={{
          paper: {
            'aria-labelledby': 'optimizer-drawer-title',
            sx: {
              width: { xs: '100%', sm: DRAWER_WIDTH },
              maxWidth: '100%',
              zIndex: (muiTheme) => muiTheme.zIndex.drawer + 3,
              display: 'flex',
              flexDirection: 'column',
            },
          }
        }}
      >
        <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Stack
            direction="row"
            spacing={2}
            sx={{
              alignItems: "center",
              justifyContent: "space-between"
            }}>
            <Stack direction="row" spacing={1.5} sx={{
              alignItems: "center"
            }}>
              <TipsAndUpdatesIcon color="secondary" />
              <Box>
                <Typography id="optimizer-drawer-title" variant="h6">{t('title', 'Optimizator')}</Typography>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>
                  {t('subtitle', 'Confirm profile facts and generate practical savings actions.')}
                </Typography>
              </Box>
            </Stack>
            <IconButton onClick={() => setOpen(false)} size="small" aria-label={t('actions.close', 'Close')}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        <Stack
          direction="row"
          spacing={1}
          role="tablist"
          aria-label={t('tabs.ariaLabel', 'Optimizator views')}
          sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}
        >
          <Button role="tab" aria-selected={view === 'review'} size="small" variant={view === 'review' ? 'contained' : 'outlined'} onClick={() => setView('review')}>
            {t('tabs.review', 'Review')}
          </Button>
          <Button role="tab" aria-selected={view === 'quiz'} size="small" variant={view === 'quiz' ? 'contained' : 'outlined'} onClick={() => setView('quiz')}>
            {t('tabs.quiz', 'Questions')}
          </Button>
          <Button role="tab" aria-selected={view === 'plan'} size="small" variant={view === 'plan' ? 'contained' : 'outlined'} onClick={() => setView('plan')}>
            {t('tabs.plan', 'Plan')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t('actions.refresh', 'Refresh')}>
            <span>
              <IconButton size="small" aria-label={t('actions.refresh', 'Refresh')} disabled={loading} onClick={loadStatus}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {loading && (
            <Stack
              sx={{
                alignItems: "center",
                py: 4
              }}>
              <CircularProgress size={28} />
            </Stack>
          )}

          {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

          {!loading && view === 'review' && (
            <Stack spacing={2} role="tabpanel">
              <Alert severity="info">
                {t('reviewIntro', 'Review detected facts first. Confirm what is right, edit what is wrong, or mark unknown.')}
              </Alert>
              {factsBySection.length === 0 ? (
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {t('emptyFacts', 'No detected facts yet. Start with the questions.')}
                </Typography>
              ) : factsBySection.map(([section, facts]) => (
                <Stack key={section} spacing={1}>
                  <Typography variant="overline" sx={{
                    color: "text.secondary"
                  }}>{getSectionLabel(section)}</Typography>
                  {facts.map(renderFactCard)}
                </Stack>
              ))}
              <Divider />
              <Button variant="contained" onClick={() => setView('quiz')}>
                {t('actions.goToQuestions', 'Answer missing questions')}
              </Button>
            </Stack>
          )}

          {!loading && view === 'quiz' && (
            <Stack spacing={2} role="tabpanel">
              <Alert severity="info">
                {t('quizIntro', 'Short first-run quiz. Every question can be skipped or marked unknown.')}
              </Alert>
              {status?.questions.length ? (
                status.questions.map(renderQuestion)
              ) : (
                <Alert severity="success">{t('quizComplete', 'All essential questions are resolved.')}</Alert>
              )}
              <Button variant="contained" startIcon={<AutoAwesomeIcon />} onClick={() => setView('plan')}>
                {t('actions.goToPlan', 'Go to action plan')}
              </Button>
            </Stack>
          )}

          {!loading && view === 'plan' && (
            <Stack spacing={2} role="tabpanel">
              {!hasOpenAiApiKey && (
                <Alert severity="warning">
                  {t('missingApiKey', 'Add an OpenAI API key in Settings before generating a plan.')}
                </Alert>
              )}
              {status?.isStale && (
                <Alert severity="info">
                  {t('stale', 'Your profile answers changed after the latest plan. Generate a fresh plan.')}
                </Alert>
              )}
              <Alert severity="info">
                {t('privacyNotice', 'Generating sends the reviewed profile facts to OpenAI using your configured API key.')}
              </Alert>
              <Button
                variant="contained"
                startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                disabled={mutationBusy || !hasOpenAiApiKey}
                onClick={generatePlan}
              >
                {recommendations.length > 0
                  ? t('actions.regenerate', 'Regenerate plan')
                  : t('actions.generate', 'Generate action plan')}
              </Button>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                {t('activeCount', {
                  count: activeRecommendations.length,
                  defaultValue: '{{count}} active actions',
                })}
              </Typography>
              {recommendations.length === 0 ? (
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {t('emptyPlan', 'No action plan yet. Generate one after reviewing facts and answering the short quiz.')}
                </Typography>
              ) : (
                recommendations.map(renderRecommendation)
              )}
            </Stack>
          )}
        </Box>
      </Drawer>
      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </>
  );
};

export default FinancialOptimizer;
