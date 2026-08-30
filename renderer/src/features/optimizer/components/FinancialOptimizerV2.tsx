import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  Fab,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepButton,
  Stepper,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import BlockIcon from '@mui/icons-material/Block';
import EditIcon from '@mui/icons-material/Edit';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LaunchIcon from '@mui/icons-material/OpenInNew';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DoneIcon from '@mui/icons-material/Done';
import SnoozeIcon from '@mui/icons-material/Snooze';
import HistoryIcon from '@mui/icons-material/History';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';

import { apiClient } from '@renderer/lib/api-client';
import { useChatbotPermissions } from '@app/contexts/ChatbotPermissionsContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import {
  FINANCIAL_TRUTH_CHANGED_EVENT,
  financialTruthChangeAffects,
} from '@renderer/features/financial-truth/types';
import type {
  OptimizerV2Candidate,
  OptimizerV2ReviewFact,
  OptimizerV2ReviewGroup,
  OptimizerV2Run,
  OptimizerV2Scope,
  OptimizerV2ScopeSelection,
  OptimizerV2StatusResponse,
} from '@renderer/types/optimizer';

type OptimizerV2View = 'review' | 'scope' | 'action';

const DRAWER_WIDTH = 560;
const STEPS: Array<{ key: OptimizerV2View; label: string }> = [
  { key: 'review', label: 'Review' },
  { key: 'scope', label: 'Scope' },
  { key: 'action', label: 'Action' },
];
const SCOPE_LABELS: Record<OptimizerV2Scope, string> = {
  general: 'General',
  spending_subscriptions: 'Spending & subscriptions',
  banking_cards: 'Banking & cards',
  cash_deposits: 'Cash & deposits',
  investments_retirement: 'Investments & retirement',
  real_estate_mortgage: 'Real estate & mortgage',
};
const FEEDBACK_REASONS = [
  ['low_value', 'Low value'],
  ['weak_evidence', 'Weak evidence'],
  ['wrong_match', 'Wrong match'],
  ['too_much_effort', 'Too much effort'],
  ['already_done', 'Already done'],
  ['not_relevant', 'Not relevant'],
] as const;

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

const FinancialOptimizerV2: React.FC = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'optimizerV2' });
  const { t: tRoot } = useTranslation('translation');
  const { formatCurrency, maskAmounts, toggleMaskAmounts } = useFinancePrivacy();
  const { hasOpenAiApiKey, openAiApiKey } = useChatbotPermissions();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<OptimizerV2View>('review');
  const [status, setStatus] = useState<OptimizerV2StatusResponse | null>(null);
  const [scope, setScope] = useState<OptimizerV2ScopeSelection>({
    primary: 'general', extras: [], change: 'negotiate_only', effort: 'low', liquidity: 'no_lockup', selectedProviders: [],
  });
  const [loading, setLoading] = useState(false);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [updatingCandidate, setUpdatingCandidate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [snoozeSelections, setSnoozeSelections] = useState<Record<number, '1_week' | '1_month' | '3_months'>>({});
  const [outcomeSelections, setOutcomeSelections] = useState<Record<number, 'none' | 'below_estimate' | 'within_estimate' | 'above_estimate' | 'unknown'>>({});
  const [dismissSelections, setDismissSelections] = useState<Record<number, string>>({});
  const requestSequence = useRef(0);
  const writeInFlight = useRef(false);
  const shouldSendApiKeyInBody = !window.electronAPI?.chatbotSecrets;

  const loadStatus = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<OptimizerV2StatusResponse>('/api/optimizer/v2/status', { cacheMode: 'no-store' });
      if (!response.ok || !response.data) throw new Error('Failed to load Optimizator');
      if (requestId !== requestSequence.current) return;
      setStatus(response.data);
      setScope((current) => current.primary ? current : response.data.defaults);
    } catch (requestError) {
      if (requestId === requestSequence.current) setError(requestError instanceof Error ? requestError.message : 'Something went wrong');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);
  const loadStatusRef = useRef(loadStatus);
  loadStatusRef.current = loadStatus;

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener('openOptimizerDrawer', handleOpen);
    return () => window.removeEventListener('openOptimizerDrawer', handleOpen);
  }, []);

  useEffect(() => {
    if (open) void loadStatusRef.current();
  }, [open]);

  useEffect(() => {
    const handleRefresh = () => { if (open) void loadStatusRef.current(); };
    const handleTruthChange = (event: Event) => {
      if (open && financialTruthChangeAffects(event, ['optimizer'])) void loadStatusRef.current();
    };
    window.addEventListener('dataRefresh', handleRefresh);
    window.addEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, handleTruthChange);
    return () => {
      window.removeEventListener('dataRefresh', handleRefresh);
      window.removeEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, handleTruthChange);
    };
  }, [open]);

  const latestRun = status?.latestRun || null;
  const candidates = latestRun?.candidates || [];
  const reviewReady = Boolean(status?.review.ready);
  const busy = loading || savingGroup !== null || generating || updatingCandidate !== null;

  const updateLocalCandidate = (candidate: OptimizerV2Candidate) => {
    setStatus((current) => current?.latestRun ? {
      ...current,
      latestRun: {
        ...current.latestRun,
        candidates: current.latestRun.candidates
          .map((item) => item.id === candidate.id ? candidate : item)
          .sort((a, b) => b.score - a.score || a.actionId.localeCompare(b.actionId)),
      },
    } : current);
  };

  const resolveReviewGroup = async (group: OptimizerV2ReviewGroup, nextStatus: 'confirmed' | 'excluded') => {
    if (writeInFlight.current) return;
    writeInFlight.current = true;
    setSavingGroup(group.key);
    setError(null);
    try {
      const response = await apiClient.put<{ success: boolean; group: OptimizerV2ReviewGroup }>(
        `/api/optimizer/v2/review-groups/${group.key}`,
        { status: nextStatus, fingerprint: group.fingerprint },
      );
      if (!response.ok || !response.data?.group) {
        const payload = response.data as unknown as { error?: string };
        throw new Error(payload?.error || 'Failed to save review choice');
      }
      setStatus((current) => current ? {
        ...current,
        review: {
          ...current.review,
          groups: current.review.groups.map((item) => item.key === group.key ? response.data.group : item),
          ready: current.review.groups.every((item) => (item.key === group.key ? nextStatus : item.status) !== 'pending'),
          resolvedCount: current.review.groups.filter((item) => (item.key === group.key ? nextStatus : item.status) !== 'pending').length,
        },
      } : current);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Something went wrong');
    } finally {
      writeInFlight.current = false;
      setSavingGroup(null);
    }
  };

  const fixAtSource = (group: OptimizerV2ReviewGroup) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('navigateTo', { detail: group.sourceRoute }));
  };

  const generate = async () => {
    if (!reviewReady || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const response = await apiClient.post<{ success: boolean; run: OptimizerV2Run }>(
        '/api/optimizer/v2/generate',
        {
          scope,
          researchMode: hasOpenAiApiKey ? 'live' : 'offline',
          locale: i18n.resolvedLanguage || i18n.language,
          ...(shouldSendApiKeyInBody ? { openaiApiKey: openAiApiKey.trim() } : {}),
        },
        { timeoutMs: 180_000 },
      );
      if (!response.ok || !response.data?.run) {
        const payload = response.data as unknown as { error?: string };
        throw new Error(payload?.error || 'Failed to generate actions');
      }
      setStatus((current) => current ? { ...current, latestRun: response.data.run } : current);
      setView('action');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  };

  const updateCandidate = async (candidate: OptimizerV2Candidate, payload: Record<string, unknown>) => {
    if (writeInFlight.current) return null;
    writeInFlight.current = true;
    setUpdatingCandidate(candidate.id);
    setError(null);
    try {
      const response = await apiClient.put<{ candidate: OptimizerV2Candidate; verification?: { available: boolean; url?: string } }>(
        `/api/optimizer/v2/recommendations/${candidate.id}/status`,
        payload,
      );
      if (!response.ok || !response.data?.candidate) {
        const body = response.data as unknown as { error?: string };
        throw new Error(body?.error || 'Failed to update action');
      }
      updateLocalCandidate(response.data.candidate);
      return response.data;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Something went wrong');
      return null;
    } finally {
      writeInFlight.current = false;
      setUpdatingCandidate(null);
    }
  };

  const renderFactValue = (item: OptimizerV2ReviewFact): React.ReactNode => {
    if (item.kind === 'currency') return formatCurrency(Number(item.value), { maximumFractionDigits: 0 });
    if (item.sensitive && maskAmounts) return '••••';
    if (item.kind === 'percent') return `${item.value}%`;
    if (item.kind === 'list') return Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? '—');
    if (item.kind === 'category_list' && Array.isArray(item.value)) return (
      <Stack spacing={0.25}>
        {(item.value as Array<{ category: string; monthly: number }>).map((entry) => (
          <Typography key={entry.category} variant="caption">{entry.category}: {formatCurrency(entry.monthly)}/mo</Typography>
        ))}
      </Stack>
    );
    if (item.kind === 'mapping' && item.value && typeof item.value === 'object') {
      return Object.entries(item.value as Record<string, unknown>).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`).join(' · ');
    }
    return String(item.value ?? '—');
  };

  const reviewCard = (group: OptimizerV2ReviewGroup) => (
    <Paper key={group.key} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Tooltip
            describeChild
            placement="top-start"
            title={group.provenance.length ? `Sources: ${group.provenance.join(' · ')}` : ''}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                ...(group.provenance.length ? {
                  cursor: 'help',
                  textDecoration: 'underline dotted',
                  textDecorationColor: 'text.disabled',
                  textUnderlineOffset: '3px',
                } : {}),
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {group.title}
              </Typography>
            </Box>
          </Tooltip>
          <Chip
            size="small"
            color={group.status === 'confirmed' ? 'success' : group.status === 'excluded' ? 'default' : 'warning'}
            label={group.status === 'confirmed' ? 'Confirmed' : group.status === 'excluded' ? 'Excluded' : 'Needs review'}
          />
        </Stack>
        {group.stale && (
          <Alert severity="warning" variant="outlined">This data is {group.freshnessDays} days old. You may continue after reviewing it.</Alert>
        )}
        <Stack spacing={0.75}>
          {group.facts.map((item) => (
            <Stack key={item.key} direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Tooltip
                  describeChild
                  placement="top-start"
                  title={item.source || item.asOf
                    ? [item.source ? `Source: ${item.source}` : null, item.asOf ? `As of ${dateLabel(item.asOf)}` : null].filter(Boolean).join(' · ')
                    : ''}
                >
                  <Box
                    component="span"
                    sx={item.source || item.asOf ? {
                      display: 'inline-flex',
                      cursor: 'help',
                      textDecoration: 'underline dotted',
                      textDecorationColor: 'text.disabled',
                      textUnderlineOffset: '3px',
                    } : { display: 'inline-flex' }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {item.label}
                    </Typography>
                  </Box>
                </Tooltip>
              </Box>
              <Typography component="div" variant="body2" sx={{ fontWeight: 600, textAlign: 'end', maxWidth: '54%', overflowWrap: 'anywhere' }}>
                {renderFactValue(item)}
              </Typography>
            </Stack>
          ))}
        </Stack>
        <Divider />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            size="small" variant={group.status === 'confirmed' ? 'contained' : 'outlined'} color="success"
            startIcon={<CheckIcon />} disabled={busy} onClick={() => void resolveReviewGroup(group, 'confirmed')}
          >Confirm</Button>
          <Button
            size="small" variant={group.status === 'excluded' ? 'contained' : 'outlined'} color="inherit"
            startIcon={<BlockIcon />} disabled={busy} onClick={() => void resolveReviewGroup(group, 'excluded')}
          >Exclude from this run</Button>
          <Button size="small" startIcon={<EditIcon />} disabled={busy} onClick={() => fixAtSource(group)}>
            {tRoot('financialTruth.correctSourceFact', 'Correct source fact')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );

  const toggleExtraScope = (extra: OptimizerV2Scope) => {
    setScope((current) => {
      if (current.primary === 'general' || extra === current.primary) return current;
      const exists = current.extras.includes(extra);
      if (!exists && current.extras.length >= 2) return current;
      return { ...current, extras: exists ? current.extras.filter((item) => item !== extra) : [...current.extras, extra] };
    });
  };

  const toggleProvider = (provider: string) => setScope((current) => ({
    ...current,
    selectedProviders: current.selectedProviders.includes(provider)
      ? current.selectedProviders.filter((item) => item !== provider)
      : [...current.selectedProviders, provider],
  }));

  const formatBenefit = (range: { low: number; high: number }, suffix = '') => {
    if (range.high <= 0) return null;
    return `${formatCurrency(range.low)}–${formatCurrency(range.high)}${suffix}`;
  };

  const candidateContent = (candidate: OptimizerV2Candidate) => {
    const possible = candidate.eligibility.status === 'possible';
    const source = candidate.sourceUrls[0];
    const expiring = candidate.reverifyRequired || Boolean(candidate.validUntil);
    const added = candidate.lifecycleState !== 'candidate' && candidate.lifecycleState !== 'dismissed';
    const feedbackReasons = candidate.feedbackReasons || [];
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2">{candidate.rationale}</Typography>
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          <Chip size="small" label={`Score ${candidate.score.toFixed(1)}/100`} />
          <Chip size="small" color={candidate.eligibility.status === 'matched' ? 'success' : 'warning'} label={candidate.eligibility.status === 'matched' ? 'Matched' : 'Possible match'} />
          <Chip size="small" label={`${candidate.effort} effort`} />
          <Chip size="small" label={`${candidate.confidence} confidence`} />
        </Stack>
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Typography variant="caption" color="text.secondary">Benefit range</Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            {formatBenefit(candidate.benefits.oneTime) && <Typography variant="body2">One-time: {formatBenefit(candidate.benefits.oneTime)}</Typography>}
            {formatBenefit(candidate.benefits.monthly, '/mo') && <Typography variant="body2">Monthly: {formatBenefit(candidate.benefits.monthly, '/mo')}</Typography>}
            {formatBenefit(candidate.benefits.annual, '/yr') && <Typography variant="body2">Annual: {formatBenefit(candidate.benefits.annual, '/yr')}</Typography>}
            {!formatBenefit(candidate.benefits.oneTime) && !formatBenefit(candidate.benefits.monthly) && !formatBenefit(candidate.benefits.annual)
              && <Typography variant="body2">Not quantified until current terms are verified</Typography>}
          </Stack>
        </Paper>
        {candidate.publicTerms && (
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="caption" color="text.secondary">Public offer terms</Typography>
            <Typography variant="body2">
              Fees: {candidate.publicTerms.fees.oneTime || candidate.publicTerms.fees.monthly || candidate.publicTerms.fees.annual
                ? [
                  candidate.publicTerms.fees.oneTime ? `${formatCurrency(candidate.publicTerms.fees.oneTime)} one-time` : null,
                  candidate.publicTerms.fees.monthly ? `${formatCurrency(candidate.publicTerms.fees.monthly)}/mo` : null,
                  candidate.publicTerms.fees.annual ? `${formatCurrency(candidate.publicTerms.fees.annual)}/yr` : null,
                ].filter(Boolean).join(' · ')
                : 'No fee listed in the cited terms'}
            </Typography>
            {candidate.publicTerms.conditions.map((condition) => (
              <Typography key={condition} variant="body2">• {condition}</Typography>
            ))}
          </Paper>
        )}
        {possible && candidate.eligibility.missingConditions.map((condition) => (
          <Stack key={condition.id} spacing={0.5}>
            <Typography variant="body2">{condition.label}</Typography>
            <ToggleButtonGroup
              exclusive size="small" value={candidate.eligibility.answers?.[condition.id] || 'not_sure'}
              onChange={(_event, value: 'yes' | 'no' | 'not_sure' | null) => {
                if (!value) return;
                void updateCandidate(candidate, { status: 'eligibility', answers: { ...candidate.eligibility.answers, [condition.id]: value } });
              }}
              disabled={updatingCandidate === candidate.id}
            >
              <ToggleButton value="yes">Yes</ToggleButton>
              <ToggleButton value="no">No</ToggleButton>
              <ToggleButton value="not_sure">Not sure</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        ))}
        <Box>
          <Typography variant="caption" color="text.secondary">Evidence</Typography>
          {candidate.evidence.map((entry) => <Typography key={entry} variant="body2">• {entry}</Typography>)}
          {candidate.retrievedAt && <Typography variant="caption" sx={{ display: 'block' }}>Retrieved {dateLabel(candidate.retrievedAt)}{candidate.validUntil ? ` · expires ${dateLabel(candidate.validUntil)}` : ''}</Typography>}
          {candidate.sourceVerifiedAt && <Typography variant="caption" sx={{ display: 'block' }}>Verified {dateLabel(candidate.sourceVerifiedAt)}</Typography>}
        </Box>
        {candidate.caveat && <Alert severity="info" variant="outlined">{candidate.caveat}</Alert>}
        <Typography variant="body2"><strong>Next step:</strong> {candidate.nextAction}</Typography>
        {source && (
          <Button
            size="small" variant="text" startIcon={<LaunchIcon />}
            disabled={updatingCandidate === candidate.id}
            onClick={async () => {
              if (expiring) {
                const result = await updateCandidate(candidate, { status: 'verify' });
                if (!result?.verification?.available) {
                  setError('This source is unavailable or the offer has expired. Re-verify with the provider before acting.');
                  return;
                }
                window.open(result.verification.url || source, '_blank', 'noopener,noreferrer');
                return;
              }
              window.open(source, '_blank', 'noopener,noreferrer');
            }}
          >{expiring ? 'Verify source & open' : 'Open source'}</Button>
        )}
        <Divider />
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          {!added && candidate.lifecycleState !== 'dismissed' && (
            <Button variant="contained" startIcon={<PlaylistAddCheckIcon />} disabled={busy || candidate.eligibility.status !== 'matched'} onClick={() => void updateCandidate(candidate, { status: 'added' })}>Add to plan</Button>
          )}
          {candidate.lifecycleState === 'added' && (
            <Button variant="contained" startIcon={<PlayArrowIcon />} disabled={busy} onClick={() => void updateCandidate(candidate, { status: 'started' })}>Start</Button>
          )}
          {added && candidate.lifecycleState !== 'done' && (
            <>
              <FormControl size="small" sx={{ minWidth: 125 }}>
                <InputLabel>Snooze</InputLabel>
                <Select label="Snooze" value={snoozeSelections[candidate.id] || '1_week'} onChange={(event) => setSnoozeSelections((current) => ({ ...current, [candidate.id]: event.target.value as '1_week' | '1_month' | '3_months' }))}>
                  <MenuItem value="1_week">1 week</MenuItem><MenuItem value="1_month">1 month</MenuItem><MenuItem value="3_months">3 months</MenuItem>
                </Select>
              </FormControl>
              <Button startIcon={<SnoozeIcon />} disabled={busy} onClick={() => void updateCandidate(candidate, { status: 'snoozed', snoozePreset: snoozeSelections[candidate.id] || '1_week' })}>Snooze</Button>
              <FormControl size="small" sx={{ minWidth: 165 }}>
                <InputLabel>Outcome</InputLabel>
                <Select label="Outcome" value={outcomeSelections[candidate.id] || 'unknown'} onChange={(event) => setOutcomeSelections((current) => ({ ...current, [candidate.id]: event.target.value as typeof current[number] }))}>
                  <MenuItem value="none">None</MenuItem><MenuItem value="below_estimate">Below estimate</MenuItem><MenuItem value="within_estimate">Within estimate</MenuItem><MenuItem value="above_estimate">Above estimate</MenuItem><MenuItem value="unknown">Unknown</MenuItem>
                </Select>
              </FormControl>
              <Button color="success" startIcon={<DoneIcon />} disabled={busy} onClick={() => void updateCandidate(candidate, { status: 'done', outcomeBand: outcomeSelections[candidate.id] || 'unknown' })}>Done</Button>
            </>
          )}
          {candidate.lifecycleState !== 'dismissed' && candidate.lifecycleState !== 'done' && (
            <>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Dismiss reason</InputLabel>
                <Select label="Dismiss reason" value={dismissSelections[candidate.id] || 'not_relevant'} onChange={(event) => setDismissSelections((current) => ({ ...current, [candidate.id]: event.target.value }))}>
                  {FEEDBACK_REASONS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </Select>
              </FormControl>
              <Button color="inherit" disabled={busy} onClick={() => void updateCandidate(candidate, { status: 'dismissed', dismissReason: dismissSelections[candidate.id] || 'not_relevant' })}>Dismiss</Button>
            </>
          )}
        </Stack>
        <Box>
          <Typography variant="caption" color="text.secondary">Was this useful?</Typography>
          <ToggleButtonGroup
            exclusive size="small" value={candidate.feedbackCode || null}
            onChange={(_event, value) => { if (value) void updateCandidate(candidate, { status: 'feedback', feedbackCode: value, feedbackReasons }); }}
            disabled={busy}
          >
            <ToggleButton value="useful">Useful</ToggleButton><ToggleButton value="not_useful">Not useful</ToggleButton><ToggleButton value="unsure">Unsure</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
            {FEEDBACK_REASONS.map(([value, label]) => (
              <Chip
                key={value} size="small" label={label} clickable color={feedbackReasons.includes(value) ? 'primary' : 'default'}
                onClick={() => {
                  const reasons = feedbackReasons.includes(value) ? feedbackReasons.filter((item) => item !== value) : [...feedbackReasons, value];
                  void updateCandidate(candidate, { status: 'feedback', feedbackCode: candidate.feedbackCode || 'unsure', feedbackReasons: reasons });
                }}
              />
            ))}
          </Stack>
        </Box>
      </Stack>
    );
  };

  const actionCard = (candidate: OptimizerV2Candidate, index: number) => (
    <Accordion key={candidate.id} defaultExpanded={index < 3} disableGutters variant="outlined" sx={{ borderRadius: 1, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{candidate.title}</Typography>
          <Typography variant="caption" color="text.secondary">{SCOPE_LABELS[candidate.scope]}{candidate.provider ? ` · ${candidate.provider}` : ''}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>{candidateContent(candidate)}</AccordionDetails>
    </Accordion>
  );

  const renderReview = () => (
    <Stack spacing={1.5}>
      <Alert severity="info">Confirm or exclude every database summary. “Correct source fact” opens the owning ShekelSync area and never edits data here.</Alert>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption">{status?.review.resolvedCount || 0} of {status?.review.totalCount || 5} groups resolved</Typography>
        <FormControlLabel control={<Switch checked={maskAmounts} onChange={toggleMaskAmounts} />} label="Mask amounts" />
      </Stack>
      <LinearProgress variant="determinate" value={((status?.review.resolvedCount || 0) / Math.max(1, status?.review.totalCount || 5)) * 100} />
      {status?.review.groups.map(reviewCard)}
      <Button variant="contained" disabled={!reviewReady || busy} onClick={() => setView('scope')}>Continue to Scope</Button>
    </Stack>
  );

  const renderScope = () => (
    <Stack spacing={2}>
      <Alert severity="info">Only selected areas drive recommendations. Other confirmed groups are used solely for eligibility, affordability, liquidity, and conflict checks.</Alert>
      <FormControl fullWidth>
        <InputLabel>Primary focus</InputLabel>
        <Select
          label="Primary focus" value={scope.primary}
          onChange={(event) => {
            const primary = event.target.value as OptimizerV2Scope;
            setScope((current) => ({ ...current, primary, extras: primary === 'general' ? [] : current.extras.filter((item) => item !== primary) }));
          }}
        >
          {(status?.scopeOptions || Object.keys(SCOPE_LABELS) as OptimizerV2Scope[]).map((item) => <MenuItem key={item} value={item}>{SCOPE_LABELS[item]}</MenuItem>)}
        </Select>
      </FormControl>
      <Box>
        <Typography variant="subtitle2">Extra areas (up to two)</Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
          {(status?.scopeOptions || []).filter((item) => item !== 'general' && item !== scope.primary).map((item) => (
            <Chip key={item} label={SCOPE_LABELS[item]} clickable disabled={scope.primary === 'general'} color={scope.extras.includes(item) ? 'primary' : 'default'} onClick={() => toggleExtraScope(item)} />
          ))}
        </Stack>
      </Box>
      <FormControl fullWidth>
        <InputLabel>Change willingness</InputLabel>
        <Select label="Change willingness" value={scope.change} onChange={(event) => setScope((current) => ({ ...current, change: event.target.value as OptimizerV2ScopeSelection['change'] }))}>
          <MenuItem value="negotiate_only">Negotiate only</MenuItem><MenuItem value="switch_selected">Switch selected existing providers</MenuItem><MenuItem value="broader_changes">Open to broader changes</MenuItem>
        </Select>
      </FormControl>
      {scope.change === 'switch_selected' && (
        <Box>
          <Typography variant="subtitle2">Providers you would consider switching</Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
            {(status?.providers.all || []).map((provider) => <Chip key={provider} label={provider} clickable color={scope.selectedProviders.includes(provider) ? 'primary' : 'default'} onClick={() => toggleProvider(provider)} />)}
            {!status?.providers.all.length && <Typography variant="caption" color="text.secondary">No providers recorded</Typography>}
          </Stack>
        </Box>
      )}
      <FormControl fullWidth>
        <InputLabel>Effort</InputLabel>
        <Select label="Effort" value={scope.effort} onChange={(event) => setScope((current) => ({ ...current, effort: event.target.value as OptimizerV2ScopeSelection['effort'] }))}>
          <MenuItem value="low">Low</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="high">High</MenuItem>
        </Select>
      </FormControl>
      <FormControl fullWidth>
        <InputLabel>Liquidity</InputLabel>
        <Select label="Liquidity" value={scope.liquidity} onChange={(event) => setScope((current) => ({ ...current, liquidity: event.target.value as OptimizerV2ScopeSelection['liquidity'] }))}>
          <MenuItem value="no_lockup">No lock-up</MenuItem><MenuItem value="up_to_3_months">Up to 3 months</MenuItem><MenuItem value="up_to_12_months">Up to 12 months</MenuItem>
        </Select>
      </FormControl>
      {!hasOpenAiApiKey && <Alert severity="warning">No OpenAI key is available. Generate will still return database-only efficiency actions and official comparison steps.</Alert>}
      <Button variant="contained" size="large" startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />} disabled={busy} onClick={() => void generate()}>
        {generating ? 'Researching opportunities…' : 'Generate actions'}
      </Button>
    </Stack>
  );

  const renderAction = () => (
    <Stack spacing={1.5}>
      {latestRun && (
        <Alert severity={latestRun.researchStatus === 'fallback' ? 'warning' : 'success'}>
          Checked {latestRun.checkedAreas.map((area) => SCOPE_LABELS[area]).join(', ')}. Research status: {latestRun.researchStatus}.
        </Alert>
      )}
      {!candidates.length && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6">No credible actions found</Typography>
          <Typography variant="body2" color="text.secondary">The checked areas are shown above. Nothing expired, ineligible, or unsupported was promoted.</Typography>
        </Paper>
      )}
      {candidates.map(actionCard)}
      <Button startIcon={<HistoryIcon />} onClick={() => setShowHistory((value) => !value)}>{showHistory ? 'Hide history' : 'Show history'}</Button>
      {showHistory && (
        <Stack spacing={1}>
          {(status?.history || []).map((run) => (
            <Paper key={run.id} variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="subtitle2">{SCOPE_LABELS[run.scope.primary]} · {dateLabel(run.generatedAt)}</Typography>
              <Typography variant="caption" color="text.secondary">{run.researchStatus} · {run.checkedAreas.length} areas checked</Typography>
            </Paper>
          ))}
          {!status?.history.length && <Typography variant="body2" color="text.secondary">No previous v2 runs</Typography>}
        </Stack>
      )}
    </Stack>
  );

  const stepIndex = STEPS.findIndex((step) => step.key === view);
  return (
    <>
      <Tooltip title={t('open', 'Open Optimizator')} placement="left">
        <Fab color="secondary" size="medium" onClick={() => setOpen(true)} aria-label="Open Optimizator" sx={{ position: 'fixed', insetInlineEnd: 24, bottom: 92, zIndex: theme.zIndex.speedDial }}>
          <TipsAndUpdatesIcon />
        </Fab>
      </Tooltip>
      <Drawer
        anchor="right" open={open} onClose={() => setOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: DRAWER_WIDTH }, maxWidth: '100vw', bgcolor: alpha(theme.palette.background.default, 0.98) } } }}
      >
        <Stack direction="row" sx={{ p: 2, alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">Optimizator</Typography>
            <Typography variant="caption" color="text.secondary">Review → Scope → Action</Typography>
          </Box>
          <Stack direction="row">
            <IconButton aria-label="Refresh Optimizator" onClick={() => void loadStatus()} disabled={busy}><RefreshIcon /></IconButton>
            <IconButton aria-label="Close Optimizator" onClick={() => setOpen(false)}><CloseIcon /></IconButton>
          </Stack>
        </Stack>
        <Divider />
        <Stepper nonLinear activeStep={stepIndex} sx={{ px: 2, py: 1.5 }}>
          {STEPS.map((step, index) => (
            <Step key={step.key} completed={index === 0 ? reviewReady : index === 1 ? Boolean(latestRun) : false}>
              <StepButton
                onClick={() => setView(step.key)}
                disabled={(step.key === 'scope' && !reviewReady) || (step.key === 'action' && !latestRun)}
              >{step.label}</StepButton>
            </Step>
          ))}
        </Stepper>
        <Divider />
        <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
          {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
          {loading && !status ? <Stack sx={{ py: 8, alignItems: 'center' }}><CircularProgress /></Stack> : (
            view === 'review' ? renderReview() : view === 'scope' ? renderScope() : renderAction()
          )}
        </Box>
      </Drawer>
    </>
  );
};

export default FinancialOptimizerV2;
