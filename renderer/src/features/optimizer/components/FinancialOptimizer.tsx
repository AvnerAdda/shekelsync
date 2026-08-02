import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  Fab,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
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
import HistoryIcon from '@mui/icons-material/History';
import LaunchIcon from '@mui/icons-material/OpenInNew';
import SnoozeIcon from '@mui/icons-material/Snooze';
import { useTranslation } from 'react-i18next';

import { apiClient } from '@renderer/lib/api-client';
import { useChatbotPermissions, MODEL_TIERS } from '@app/contexts/ChatbotPermissionsContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { maskFinancialText } from '@renderer/shared/utils/finance-privacy';
import type {
  OptimizerFact,
  OptimizerHistoryResponse,
  OptimizerHistoryRun,
  OptimizerQuestion,
  OptimizerRecommendation,
  OptimizerStatusResponse,
} from '@renderer/types/optimizer';

type OptimizerView = 'review' | 'quiz' | 'plan' | 'history';
type FollowThroughAction = 'done' | 'snoozed';

const DRAWER_WIDTH = 460;
const MAX_REALIZED_MONTHLY_SAVINGS = 1_000_000;

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

function parseOptimizerDate(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return new Date(normalized);
}

const FinancialOptimizer: React.FC = () => {
  const theme = useTheme();
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
  const [history, setHistory] = useState<OptimizerHistoryRun[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [followThroughRecommendation, setFollowThroughRecommendation] = useState<OptimizerRecommendation | null>(null);
  const [followThroughAction, setFollowThroughAction] = useState<FollowThroughAction>('done');
  const [realizedSavingsDraft, setRealizedSavingsDraft] = useState('');
  const [followThroughNote, setFollowThroughNote] = useState('');
  const statusRequestSequence = useRef(0);
  const historyRequestSequence = useRef(0);
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

  const loadHistory = useCallback(async () => {
    const requestId = historyRequestSequence.current + 1;
    historyRequestSequence.current = requestId;
    setHistoryLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<OptimizerHistoryResponse>('/api/optimizer/history?limit=20');
      if (!response.ok || !response.data) {
        throw new Error(t('errors.history', 'Failed to load plan history'));
      }
      if (requestId === historyRequestSequence.current) {
        setHistory(Array.isArray(response.data.runs) ? response.data.runs : []);
      }
    } catch (requestError) {
      if (requestId === historyRequestSequence.current) {
        setError(requestError instanceof Error ? requestError.message : t('errors.generic', 'Something went wrong'));
      }
    } finally {
      if (requestId === historyRequestSequence.current) setHistoryLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open && view === 'history' && history === null) {
      void loadHistory();
    }
  }, [history, loadHistory, open, view]);

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
  const estimatedMonthlyImpact = activeRecommendations.reduce(
    (total, recommendation) => total + Math.max(0, recommendation.estimatedMonthlyImpact),
    0,
  );
  const progress = status?.progress;
  const completionPercent = progress && progress.totalQuestions > 0
    ? Math.round((progress.resolvedQuestions / progress.totalQuestions) * 100)
    : 0;
  const showInitialLoading = loading && !status;
  const mutationBusy = loading || savingKey !== null || updatingRecommendationId !== null || generating;

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
    const payload = responseData as { error?: string } | null;
    setError(payload?.error || fallback);
  };

  const applySavedFact = (savedFact: OptimizerFact): void => {
    setStatus((current) => {
      if (!current) return current;

      const alreadyPresent = current.facts.some((fact) => fact.factKey === savedFact.factKey);
      const facts = alreadyPresent
        ? current.facts.map((fact) => (fact.factKey === savedFact.factKey ? savedFact : fact))
        : [...current.facts, savedFact];
      const wasUnresolved = current.questions.some((question) => question.factKey === savedFact.factKey);
      const questions = current.questions.filter((question) => question.factKey !== savedFact.factKey);

      return {
        ...current,
        facts,
        questions,
        missingFields: current.missingFields.filter((factKey) => factKey !== savedFact.factKey),
        progress: wasUnresolved
          ? {
            ...current.progress,
            resolvedQuestions: current.progress.resolvedQuestions + 1,
            unresolvedQuestions: Math.max(0, current.progress.unresolvedQuestions - 1),
          }
          : current.progress,
        isStale: current.isStale || current.latestRun !== null,
      };
    });
    setFactDrafts((current) => ({ ...current, [savedFact.factKey]: getFactInputValue(savedFact) }));
    setQuestionDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([factKey]) => factKey !== savedFact.factKey),
    ));
  };

  const applyUpdatedRecommendation = (recommendation: OptimizerRecommendation): void => {
    setStatus((current) => current ? {
      ...current,
      recommendations: current.recommendations.map((item) => (
        item.id === recommendation.id ? recommendation : item
      )),
    } : current);
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
      const responsePayload = response.data as { facts?: OptimizerFact[] } | null;
      const savedFact = responsePayload?.facts?.find((item) => item.factKey === fact.factKey);
      if (savedFact) {
        applySavedFact(savedFact);
      } else {
        await loadStatus();
      }
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
      setHistory(null);
      setView('plan');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('errors.generic', 'Something went wrong'));
    } finally {
      setGenerating(false);
    }
  };

  const updateRecommendationStatus = async (
    recommendation: OptimizerRecommendation,
    nextStatus: OptimizerRecommendation['status'] | 'snoozed',
    details: { userNote?: string; realizedMonthlySavings?: number } = {},
  ): Promise<boolean> => {
    if (writeInFlight.current) return false;
    writeInFlight.current = true;
    setUpdatingRecommendationId(recommendation.id);
    setError(null);
    try {
      const response = await apiClient.put(`/api/optimizer/recommendations/${recommendation.id}/status`, {
        status: nextStatus,
        ...details,
      });
      if (!response.ok) {
        handleWriteError(response.data, t('errors.recommendationStatus', 'Failed to update recommendation'));
        return false;
      }
      const responsePayload = response.data as { recommendation?: OptimizerRecommendation } | null;
      if (responsePayload?.recommendation) {
        applyUpdatedRecommendation(responsePayload.recommendation);
      } else {
        await loadStatus();
      }
      setHistory(null);
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('errors.generic', 'Something went wrong'));
      return false;
    } finally {
      writeInFlight.current = false;
      setUpdatingRecommendationId(null);
    }
  };

  const openFollowThrough = (recommendation: OptimizerRecommendation, action: FollowThroughAction): void => {
    setFollowThroughRecommendation(recommendation);
    setFollowThroughAction(action);
    setRealizedSavingsDraft(recommendation.realizedMonthlySavings === null
      || recommendation.realizedMonthlySavings === undefined
      ? ''
      : String(recommendation.realizedMonthlySavings));
    setFollowThroughNote(recommendation.userNote || '');
  };

  const closeFollowThrough = (): void => {
    if (updatingRecommendationId !== null) return;
    setFollowThroughRecommendation(null);
  };

  const submitFollowThrough = async (): Promise<void> => {
    if (!followThroughRecommendation) return;
    const trimmedSavings = realizedSavingsDraft.trim();
    const realizedMonthlySavings = trimmedSavings === '' ? undefined : Number(trimmedSavings);
    if (
      followThroughAction === 'done'
      && realizedMonthlySavings !== undefined
      && (
        !Number.isFinite(realizedMonthlySavings)
        || realizedMonthlySavings < 0
        || realizedMonthlySavings > MAX_REALIZED_MONTHLY_SAVINGS
      )
    ) {
      setError(t('errors.invalidSavings', 'Enter a savings amount between 0 and 1,000,000.'));
      return;
    }

    const updated = await updateRecommendationStatus(followThroughRecommendation, followThroughAction, {
      ...(followThroughNote.trim() ? { userNote: followThroughNote.trim() } : {}),
      ...(followThroughAction === 'done' && realizedMonthlySavings !== undefined
        ? { realizedMonthlySavings }
        : {}),
    });
    if (updated) setFollowThroughRecommendation(null);
  };

  const openRecommendationArea = (recommendation: OptimizerRecommendation): void => {
    const targetBySection: Record<string, { path: string; search?: string; hash?: string }> = {
      subscriptions: { path: '/analysis', search: '?tab=subscriptions' },
      banking: { path: '/settings', hash: '#sync' },
      housing: { path: '/analysis', search: '?tab=actions' },
      food: { path: '/analysis', search: '?tab=budget' },
      insurance: { path: '/analysis', search: '?tab=actions' },
      utilities: { path: '/analysis', search: '?tab=budget' },
      transportation: { path: '/analysis', search: '?tab=budget' },
      taxes: { path: '/analysis', search: '?tab=actions' },
      constraints: { path: '/analysis', search: '?tab=actions' },
      general: { path: '/analysis', search: '?tab=actions' },
    };
    setOpen(false);
    window.dispatchEvent(new CustomEvent('navigateTo', {
      detail: targetBySection[recommendation.section] || targetBySection.general,
    }));
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

  const renderRecommendation = (recommendation: OptimizerRecommendation) => {
    const snoozedUntil = recommendation.snoozedUntil ? parseOptimizerDate(recommendation.snoozedUntil) : null;
    const isSnoozed = Boolean(snoozedUntil && snoozedUntil.getTime() > Date.now());

    return (
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
            label={isSnoozed
              ? t('statuses.snoozed', 'Snoozed')
              : t(`statuses.${recommendation.status}`, { defaultValue: recommendation.status })}
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
        {recommendation.userNote && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            <strong>{t('note', 'Note')}:</strong> {displayPlanText(recommendation.userNote)}
          </Typography>
        )}
        {recommendation.realizedMonthlySavings !== null
          && recommendation.realizedMonthlySavings !== undefined && (
          <Chip
            size="small"
            color="success"
            variant="outlined"
            label={`${t('realizedSavings', 'Realized')}: ${formatCurrency(recommendation.realizedMonthlySavings)}`}
            sx={{ alignSelf: 'flex-start' }}
          />
        )}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            size="small"
            startIcon={<LaunchIcon />}
            onClick={() => openRecommendationArea(recommendation)}
          >
            {t('actions.openArea', 'Open area')}
          </Button>
          <Button
            size="small"
            startIcon={<DoneIcon />}
            disabled={mutationBusy || recommendation.status === 'done'}
            onClick={() => openFollowThrough(recommendation, 'done')}
          >
            {t('actions.done', 'Done')}
          </Button>
          {recommendation.status === 'active' && (isSnoozed ? (
            <Button
              size="small"
              startIcon={<RefreshIcon />}
              disabled={mutationBusy}
              onClick={() => void updateRecommendationStatus(recommendation, 'active')}
            >
              {t('actions.reactivate', 'Reactivate')}
            </Button>
          ) : (
            <Button
              size="small"
              startIcon={<SnoozeIcon />}
              disabled={mutationBusy}
              onClick={() => openFollowThrough(recommendation, 'snoozed')}
            >
              {t('actions.snooze', 'Snooze')}
            </Button>
          ))}
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
  };

  return (
    <>
      <Tooltip title={t('fabTooltip', 'Open Optimizator')}>
        <Fab
          color="secondary"
          variant="circular"
          aria-label={t('title', 'Optimizator')}
          onClick={() => setOpen(true)}
          sx={{
            position: 'fixed',
            bottom: 92,
            right: 24,
            zIndex: (muiTheme) => muiTheme.zIndex.drawer + 2,
            boxShadow: `0 8px 28px ${alpha(theme.palette.secondary.main, 0.35)}`,
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: open ? 'none' : 'inline-flex',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              transform: 'scale(1.1) rotate(-5deg)',
              boxShadow: `0 12px 36px ${alpha(theme.palette.secondary.main, 0.5)}`,
            },
          }}
        >
          <TipsAndUpdatesIcon />
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

        {progress && (
          <Box sx={{ px: 2, pt: 1.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                {t('progress.label', 'Profile readiness')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('progress.value', {
                  resolved: progress.resolvedQuestions,
                  total: progress.totalQuestions,
                  defaultValue: '{{resolved}} of {{total}} answered',
                })}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={completionPercent}
              aria-label={t('progress.label', 'Profile readiness')}
              sx={{ height: 6, borderRadius: 999 }}
            />
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
              {progress.unresolvedQuestions > 0
                ? t('progress.remaining', {
                  count: progress.unresolvedQuestions,
                  defaultValue: '{{count}} unanswered questions remaining',
                })
                : t('progress.ready', 'Ready to generate a tailored plan')}
            </Typography>
          </Box>
        )}

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
          <Button role="tab" aria-selected={view === 'history'} size="small" variant={view === 'history' ? 'contained' : 'outlined'} onClick={() => setView('history')}>
            {t('tabs.history', 'History')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t('actions.refresh', 'Refresh')}>
            <span>
              <IconButton size="small" aria-label={t('actions.refresh', 'Refresh')} disabled={loading} onClick={loadStatus}>
                {loading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {showInitialLoading && (
            <Stack
              sx={{
                alignItems: "center",
                py: 4
              }}>
              <CircularProgress size={28} />
            </Stack>
          )}

          {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

          {!showInitialLoading && view === 'review' && (
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

          {!showInitialLoading && view === 'quiz' && (
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

          {!showInitialLoading && view === 'plan' && (
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
              {progress && progress.unresolvedQuestions > 0 && (
                <Alert
                  severity="warning"
                  action={(
                    <Button color="inherit" size="small" onClick={() => setView('quiz')}>
                      {t('actions.answerQuestions', 'Answer')}
                    </Button>
                  )}
                >
                  {t('progress.planWarning', {
                    count: progress.unresolvedQuestions,
                    defaultValue: '{{count}} unanswered questions remain. More answers can improve your plan.',
                  })}
                </Alert>
              )}
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
              {activeRecommendations.length > 0 && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: alpha(theme.palette.success.main, 0.06),
                    borderColor: alpha(theme.palette.success.main, 0.25),
                  }}
                >
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('estimatedMonthlyImpact', 'Active estimated monthly impact')}
                  </Typography>
                  <Typography variant="h6" color="success.main" sx={{ fontWeight: 700 }}>
                    {formatCurrency(estimatedMonthlyImpact, { showSign: true })}
                  </Typography>
                </Paper>
              )}
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

          {!showInitialLoading && view === 'history' && (
            <Stack spacing={2} role="tabpanel">
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {t('history.title', 'Plan history')}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('history.subtitle', 'Compare estimated and realized impact across generated plans.')}
                  </Typography>
                </Box>
                <IconButton
                  aria-label={t('actions.refreshHistory', 'Refresh history')}
                  disabled={historyLoading}
                  onClick={() => void loadHistory()}
                >
                  {historyLoading ? <CircularProgress size={18} /> : <HistoryIcon />}
                </IconButton>
              </Stack>

              {historyLoading && history === null && (
                <Stack sx={{ alignItems: 'center', py: 3 }}>
                  <CircularProgress size={28} />
                </Stack>
              )}

              {!historyLoading && history?.length === 0 && (
                <Alert severity="info">{t('history.empty', 'No generated plans yet.')}</Alert>
              )}

              {history?.map((run, index) => {
                const previousRun = history[index + 1];
                const impactChange = previousRun
                  ? run.estimatedMonthlyImpact - previousRun.estimatedMonthlyImpact
                  : null;
                return (
                  <Paper key={run.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                    <Stack spacing={1}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box>
                          <Typography variant="subtitle2">
                            {parseOptimizerDate(run.generatedAt).toLocaleString(i18n.resolvedLanguage || i18n.language)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {run.model || t('history.unknownModel', 'Unknown model')}
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={run.status === 'complete'
                            ? t('history.complete', 'Complete')
                            : t('history.failed', 'Failed')}
                          color={run.status === 'complete' ? 'success' : 'error'}
                          variant="outlined"
                        />
                      </Stack>
                      {run.status === 'failed' ? (
                        <Typography variant="body2" color="error.main">
                          {run.errorMessage || t('history.failedMessage', 'Plan generation failed.')}
                        </Typography>
                      ) : (
                        <>
                          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            <Chip size="small" label={t('history.actionsCount', {
                              count: run.recommendationCount,
                              defaultValue: '{{count}} actions',
                            })} />
                            <Chip size="small" variant="outlined" label={t('history.doneCount', {
                              count: run.doneCount,
                              defaultValue: '{{count}} done',
                            })} />
                          </Stack>
                          <Stack direction="row" spacing={3}>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {t('history.estimated', 'Estimated / month')}
                              </Typography>
                              <Typography variant="subtitle2">
                                {formatCurrency(run.estimatedMonthlyImpact, { showSign: true })}
                              </Typography>
                            </Box>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {t('history.realized', 'Realized / month')}
                              </Typography>
                              <Typography variant="subtitle2" color="success.main">
                                {formatCurrency(run.realizedMonthlySavings, { showSign: true })}
                              </Typography>
                            </Box>
                          </Stack>
                          {impactChange !== null && (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {t('history.changeFromPrevious', 'Estimated change from previous plan')}: {' '}
                              {formatCurrency(impactChange, { showSign: true })}
                            </Typography>
                          )}
                        </>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Box>
      </Drawer>
      <Dialog open={followThroughRecommendation !== null} onClose={closeFollowThrough} fullWidth maxWidth="xs">
        <DialogTitle>
          {followThroughAction === 'done'
            ? t('followThrough.completeTitle', 'Complete action')
            : t('followThrough.snoozeTitle', 'Snooze for 7 days')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {displayPlanText(followThroughRecommendation?.title || null)}
            </Typography>
            {followThroughAction === 'done' && (
              <TextField
                label={t('followThrough.realizedSavings', 'Actual monthly savings')}
                type="number"
                value={realizedSavingsDraft}
                onChange={(event) => setRealizedSavingsDraft(event.target.value)}
                slotProps={{ htmlInput: { min: 0, max: MAX_REALIZED_MONTHLY_SAVINGS, inputMode: 'decimal' } }}
                helperText={t('followThrough.realizedSavingsHelp', 'Optional. Use the amount you actually saved each month.')}
                fullWidth
              />
            )}
            <TextField
              label={t('followThrough.note', 'Note')}
              value={followThroughNote}
              onChange={(event) => setFollowThroughNote(event.target.value)}
              multiline
              minRows={3}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeFollowThrough} disabled={updatingRecommendationId !== null}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitFollowThrough()}
            disabled={updatingRecommendationId !== null}
            startIcon={followThroughAction === 'done' ? <DoneIcon /> : <SnoozeIcon />}
          >
            {followThroughAction === 'done'
              ? t('actions.saveOutcome', 'Save outcome')
              : t('actions.snooze', 'Snooze')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default FinancialOptimizer;
