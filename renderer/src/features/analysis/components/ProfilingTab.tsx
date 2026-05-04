import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Link,
  Stack,
  Tab,
  Tabs,
  Typography,
  useTheme,
} from '@mui/material';
import {
  AutoAwesome as GenerateIcon,
  OpenInNew as OpenInNewIcon,
  Psychology as ProfilingIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useChatbotPermissions } from '@app/contexts/ChatbotPermissionsContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { apiClient } from '@renderer/lib/api-client';

type ProfilingBand =
  | 'well_below_average'
  | 'below_average'
  | 'near_average'
  | 'above_average'
  | 'well_above_average';

type ComparatorStatus = 'matched' | 'fallback' | 'skipped';

interface ProfilingComparator {
  key: string;
  label: string;
  score: number;
  weight: number;
  weighted: boolean;
  status: ComparatorStatus;
  actualValue: number | null;
  benchmarkValue: number | null;
  delta: number | null;
  ratio: number | null;
  note: string;
  sourceId: string;
  mappingSource?: string | null;
  ageGroup?: string | null;
}

interface ObservedMetrics {
  startDate: string;
  endDate: string;
  totalIncome: number;
  totalExpenses: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySavings: number;
  transactionCount: number;
}

interface ProfilingAssessment {
  generatedAt: string;
  benchmarkVersion: string;
  score: number;
  band: ProfilingBand;
  confidence: number;
  comparators: ProfilingComparator[];
  metrics: {
    age: number | null;
    maritalStatus: string | null;
    location: string | null;
    mappedLocation: string | null;
    householdSize: number;
    childrenCount: number;
    occupation: string | null;
    industry: string | null;
    primaryMonthlyIncome: number;
    spouseMonthlyIncome: number;
    declaredHouseholdIncome: number;
    observedLast3Months: ObservedMetrics;
    officialBenchmarks: {
      nationalAverageSalary: number;
      householdGrossIncome: number;
      householdMoneyExpenditure: number;
      localityGrossIncome: number | null;
      occupationGrossIncome: number | null;
    };
  };
  narrative: {
    headline: string;
    summary: string;
    strengths: string[];
    risks: string[];
    actions: string[];
    caveats: string[];
    locale?: string;
  };
  sources: Array<{
    id: string;
    title: string;
    url: string;
    effectiveDate: string;
  }>;
}

interface ProfilingStatusResponse {
  missingFields: string[];
  isStale: boolean;
  staleReasons: string[];
  assessment: ProfilingAssessment | null;
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }
  return fallback;
}

function getAlertSeverity(score: number): 'success' | 'info' | 'warning' {
  if (score >= 60) {
    return 'success';
  }
  if (score >= 45) {
    return 'info';
  }
  return 'warning';
}

type NarrativeTabKey = 'summary' | 'strengths' | 'risks' | 'actions' | 'caveats';

const ProfilingTab: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.profiling' });
  const { hasOpenAiApiKey: hasStoredOpenAiApiKey, openAiApiKey } = useChatbotPermissions();
  const { formatCurrency } = useFinancePrivacy();

  const [status, setStatus] = useState<ProfilingStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrativeTab, setNarrativeTab] = useState<NarrativeTabKey>('summary');

  const loadStatus = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<ProfilingStatusResponse>('/api/analytics/profiling');
      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(
            response.data,
            i18n.t('analysisPage.profiling.errors.statusLoadFailed'),
          ),
        );
      }
      setStatus(response.data);
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : i18n.t('analysisPage.profiling.errors.generic');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    // Re-run only when the visible locale changes.
    // The fetch itself does not depend on changing function identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  const generateProfiling = async (force = false) => {
    const apiKey = openAiApiKey.trim();
    const hasConfiguredApiKey = hasStoredOpenAiApiKey || apiKey.length > 0;
    if (!hasConfiguredApiKey) {
      setError(i18n.t('analysisPage.profiling.errors.missingApiKey'));
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const shouldSendApiKeyInBody = !window.electronAPI?.chatbotSecrets;
      const payload: { openaiApiKey?: string; force?: boolean } = {
        ...(force ? { force: true } : {}),
        ...(shouldSendApiKeyInBody ? { openaiApiKey: apiKey } : {}),
      };
      const response = await apiClient.post<
        ProfilingStatusResponse,
        { openaiApiKey?: string; force?: boolean }
      >('/api/analytics/profiling/generate', payload);

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(
            response.data,
            i18n.t('analysisPage.profiling.errors.generateFailed'),
          ),
        );
      }

      setStatus(response.data);
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : i18n.t('analysisPage.profiling.errors.generic');
      setError(message);
    } finally {
      setGenerating(false);
    }
  };

  const assessment = status?.assessment ?? null;
  const missingFields = status?.missingFields ?? [];
  const staleReasons = status?.staleReasons ?? [];
  const isStale = Boolean(status?.isStale);
  const hasApiKey = hasStoredOpenAiApiKey || openAiApiKey.trim().length > 0;
  const hasIncompleteProfile = missingFields.length > 0;
  const canRefresh = hasApiKey && !hasIncompleteProfile && !generating;

  const scoreChipColor = useMemo(() => getAlertSeverity(assessment?.score ?? 50), [assessment?.score]);

  useEffect(() => {
    setNarrativeTab('summary');
  }, [assessment?.generatedAt]);

  const openSettingsSection = (hash: 'chatbot' | 'profile') => {
    navigate(`/settings#${hash}`);
  };

  const renderMissingFields = (fields: string[]) => (
    <Stack spacing={1.25} sx={{ mt: 2 }}>
      {fields.map((field) => (
        <Chip
          key={field}
          label={t(`fields.${field}`)}
          variant="outlined"
          sx={{ justifyContent: 'flex-start', maxWidth: 'fit-content' }}
        />
      ))}
    </Stack>
  );

  const renderStaleAction = () => {
    if (!isStale) {
      return null;
    }

    if (!hasApiKey) {
      return (
        <Button
          variant="outlined"
          startIcon={<SettingsIcon />}
          onClick={() => openSettingsSection('chatbot')}
        >
          {t('openSettings')}
        </Button>
      );
    }

    if (hasIncompleteProfile) {
      return (
        <Button
          variant="outlined"
          startIcon={<SettingsIcon />}
          onClick={() => openSettingsSection('profile')}
        >
          {t('completeProfile')}
        </Button>
      );
    }

    return (
      <Button
        variant="contained"
        startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
        onClick={() => void generateProfiling(true)}
        disabled={!canRefresh}
      >
        {t('refresh')}
      </Button>
    );
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return i18n.t('analysisPage.profiling.unknownValue');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.language || 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const renderMetricRow = (label: string, value: string) => (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} textAlign="right">
        {value}
      </Typography>
    </Stack>
  );

  const renderNarrativeItems = (items: string[], emptyLabel: string) => {
    if (items.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      );
    }

    return (
      <Stack spacing={1}>
        {items.map((item) => (
          <Typography key={item} variant="body2">
            • {item}
          </Typography>
        ))}
      </Stack>
    );
  };

  const getComparatorTrackBackground = (score: number) => {
    const severity = getAlertSeverity(score);

    if (severity === 'success') {
      return `linear-gradient(90deg, ${alpha(theme.palette.info.main, 0.25)} 0%, ${alpha(theme.palette.success.main, 0.45)} 100%)`;
    }

    if (severity === 'info') {
      return `linear-gradient(90deg, ${alpha(theme.palette.warning.main, 0.22)} 0%, ${alpha(theme.palette.info.main, 0.4)} 100%)`;
    }

    return `linear-gradient(90deg, ${alpha(theme.palette.error.main, 0.24)} 0%, ${alpha(theme.palette.warning.main, 0.35)} 100%)`;
  };

  if (loading && !status) {
    return (
      <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress aria-label={t('loading')} />
      </Box>
    );
  }

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ mb: 3 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <ProfilingIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>
              {t('title')}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>

        {assessment && !isStale && hasApiKey && !hasIncompleteProfile && (
          <Button
            variant="outlined"
            startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            onClick={() => void generateProfiling(true)}
            disabled={generating}
          >
            {t('refresh')}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
          {!assessment && (
            <Button size="small" onClick={() => void loadStatus()} sx={{ ml: 1.5 }}>
              {t('retry')}
            </Button>
          )}
        </Alert>
      )}

      {!assessment && !hasApiKey && (
        <Card
          elevation={0}
          sx={{
            borderRadius: 4,
            border: '1px solid',
            borderColor: alpha(theme.palette.warning.main, 0.18),
            bgcolor: alpha(theme.palette.warning.main, 0.04),
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              {t('missingKeyTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('missingKeyDescription')}
            </Typography>
            <Button
              variant="contained"
              startIcon={<SettingsIcon />}
              onClick={() => openSettingsSection('chatbot')}
              sx={{ mt: 3 }}
            >
              {t('openSettings')}
            </Button>
          </CardContent>
        </Card>
      )}

      {!assessment && hasApiKey && hasIncompleteProfile && (
        <Card
          elevation={0}
          sx={{
            borderRadius: 4,
            border: '1px solid',
            borderColor: alpha(theme.palette.info.main, 0.18),
            bgcolor: alpha(theme.palette.info.main, 0.04),
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              {t('incompleteTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('incompleteDescription')}
            </Typography>
            {renderMissingFields(missingFields)}
            <Button
              variant="contained"
              startIcon={<SettingsIcon />}
              onClick={() => openSettingsSection('profile')}
              sx={{ mt: 3 }}
            >
              {t('completeProfile')}
            </Button>
          </CardContent>
        </Card>
      )}

      {!assessment && hasApiKey && !hasIncompleteProfile && (
        <Card
          elevation={0}
          sx={{
            borderRadius: 4,
            border: '1px solid',
            borderColor: alpha(theme.palette.primary.main, 0.15),
            bgcolor: alpha(theme.palette.primary.main, 0.03),
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              {t('emptyTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('emptyDescription')}
            </Typography>
            <Button
              variant="contained"
              startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <GenerateIcon />}
              onClick={() => void generateProfiling(false)}
              disabled={generating}
              sx={{ mt: 3 }}
            >
              {t('generate')}
            </Button>
          </CardContent>
        </Card>
      )}

      {assessment && (
        <Stack spacing={3}>
          {isStale && (
            <Alert severity="warning" action={renderStaleAction()} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" fontWeight={700}>
                {t('staleTitle')}
              </Typography>
              <Typography variant="body2">
                {t('staleDescription')}
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {staleReasons.map((reason) => (
                  <Typography key={reason} variant="caption" color="text.secondary">
                    {t(`staleReasons.${reason}`)}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Card
                elevation={0}
                sx={{
                  height: '100%',
                  borderRadius: 4,
                  border: '1px solid',
                  borderColor: alpha(theme.palette.primary.main, 0.14),
                  background: `linear-gradient(160deg, ${alpha(theme.palette.primary.main, 0.12)}, ${alpha(theme.palette.background.paper, 0.94)})`,
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        {t('scoreLabel')}
                      </Typography>
                      <Typography variant="h2" fontWeight={800} sx={{ lineHeight: 1 }}>
                        {assessment.score}
                      </Typography>
                    </Box>
                    <Chip
                      color={scoreChipColor}
                      label={t(`band.${assessment.band}`)}
                      sx={{ fontWeight: 700 }}
                    />
                  </Stack>

                  <Divider sx={{ my: 2 }} />

                  <Stack spacing={1.25}>
                    {renderMetricRow(t('confidenceLabel'), `${Math.round(assessment.confidence * 100)}%`)}
                    {renderMetricRow(t('generatedAt'), formatDateTime(assessment.generatedAt))}
                    {renderMetricRow(t('benchmarkVersion'), assessment.benchmarkVersion)}
                    {renderMetricRow(
                      t('statusLabel'),
                      isStale ? t('status.stale') : t('status.current'),
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 8 }}>
              <Card elevation={0} sx={{ height: '100%', borderRadius: 4 }}>
                <CardContent sx={{ p: 0 }}>
                  <Box sx={{ px: 3, pt: 3, pb: 1.5 }}>
                    <Typography variant="h6" fontWeight={700} gutterBottom>
                      {assessment.narrative.headline}
                    </Typography>
                  </Box>

                  <Tabs
                    value={narrativeTab}
                    onChange={(_event, newValue: NarrativeTabKey) => setNarrativeTab(newValue)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                      px: 2,
                      borderBottom: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
                      '& .MuiTab-root': {
                        textTransform: 'none',
                        fontWeight: 600,
                        minHeight: 44,
                      },
                    }}
                  >
                    <Tab label={t('summaryTitle')} value="summary" />
                    <Tab label={t('strengthsTitle')} value="strengths" />
                    <Tab label={t('risksTitle')} value="risks" />
                    <Tab label={t('actionsTitle')} value="actions" />
                    <Tab label={t('caveatsTitle')} value="caveats" />
                  </Tabs>

                  <Box sx={{ p: 3, minHeight: 212 }}>
                    {narrativeTab === 'summary' && (
                      <Typography variant="body1" color="text.secondary">
                        {assessment.narrative.summary}
                      </Typography>
                    )}

                    {narrativeTab === 'strengths' && renderNarrativeItems(
                      assessment.narrative.strengths,
                      t('noItems'),
                    )}

                    {narrativeTab === 'risks' && renderNarrativeItems(
                      assessment.narrative.risks,
                      t('noItems'),
                    )}

                    {narrativeTab === 'actions' && renderNarrativeItems(
                      assessment.narrative.actions,
                      t('noItems'),
                    )}

                    {narrativeTab === 'caveats' && renderNarrativeItems(
                      assessment.narrative.caveats,
                      t('noCaveats'),
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Card elevation={0} sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                {t('comparatorTitle')}
              </Typography>
              <Stack spacing={2}>
                {assessment.comparators.map((comparator) => (
                  <Card
                    key={comparator.key}
                    variant="outlined"
                    sx={{
                      borderRadius: 3,
                      borderColor: alpha(theme.palette.divider, 0.12),
                    }}
                  >
                    <CardContent sx={{ p: 2.5 }}>
                      <Stack spacing={1.5}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          justifyContent="space-between"
                          alignItems={{ xs: 'flex-start', sm: 'center' }}
                          spacing={1}
                        >
                          <Box>
                            <Typography variant="subtitle2" fontWeight={700}>
                              {t(`comparatorLabels.${comparator.key}`)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {t(`status.${comparator.status}`)}
                              {comparator.weighted
                                ? ` • ${t('weightLabel', { value: Math.round(comparator.weight * 100) })}`
                                : ` • ${t('supportingOnly')}`}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            color={getAlertSeverity(comparator.score)}
                            label={`${comparator.score}/100`}
                          />
                        </Stack>

                        <Box>
                          <Box
                            sx={{
                              position: 'relative',
                              height: 14,
                              borderRadius: 999,
                              overflow: 'hidden',
                              bgcolor: alpha(theme.palette.divider, 0.12),
                              background: getComparatorTrackBackground(comparator.score),
                            }}
                          >
                            <Box
                              sx={{
                                position: 'absolute',
                                left: `${Math.max(0, Math.min(100, comparator.score))}%`,
                                top: '50%',
                                width: 18,
                                height: 18,
                                borderRadius: '50%',
                                transform: 'translate(-50%, -50%)',
                                bgcolor: theme.palette.background.paper,
                                border: `3px solid ${theme.palette[getAlertSeverity(comparator.score)].main}`,
                                boxShadow: `0 0 0 3px ${alpha(theme.palette.background.paper, 0.85)}`,
                              }}
                            />
                          </Box>

                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            sx={{ mt: 0.75, px: 0.25 }}
                          >
                            {['0', '50', '100'].map((mark) => (
                              <Typography key={mark} variant="caption" color="text.secondary">
                                {mark}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>

                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${t('actualValue')}: ${
                              comparator.actualValue === null
                                ? t('unknownValue')
                                : formatCurrency(comparator.actualValue, { absolute: true, maximumFractionDigits: 0 })
                            }`}
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${t('benchmarkValue')}: ${
                              comparator.benchmarkValue === null
                                ? t('unknownValue')
                                : formatCurrency(comparator.benchmarkValue, { absolute: true, maximumFractionDigits: 0 })
                            }`}
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${t('ratioLabel')}: ${
                              comparator.ratio === null ? t('unknownValue') : `${comparator.ratio.toFixed(2)}x`
                            }`}
                          />
                        </Stack>

                        <Typography variant="body2" color="text.secondary">
                          {comparator.note}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </CardContent>
          </Card>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card elevation={0} sx={{ borderRadius: 4, height: '100%' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    {t('metricsTitle')}
                  </Typography>
                  <Stack spacing={1.25}>
                    {renderMetricRow(
                      t('metrics.householdIncome'),
                      formatCurrency(assessment.metrics.declaredHouseholdIncome, { absolute: true, maximumFractionDigits: 0 }),
                    )}
                    {renderMetricRow(
                      t('metrics.primaryIncome'),
                      formatCurrency(assessment.metrics.primaryMonthlyIncome, { absolute: true, maximumFractionDigits: 0 }),
                    )}
                    {renderMetricRow(
                      t('metrics.spouseIncome'),
                      formatCurrency(assessment.metrics.spouseMonthlyIncome, { absolute: true, maximumFractionDigits: 0 }),
                    )}
                    {renderMetricRow(
                      t('metrics.monthlyExpenses'),
                      formatCurrency(assessment.metrics.observedLast3Months.monthlyExpenses, { absolute: true, maximumFractionDigits: 0 }),
                    )}
                    {renderMetricRow(
                      t('metrics.monthlySavings'),
                      formatCurrency(assessment.metrics.observedLast3Months.monthlySavings, { maximumFractionDigits: 0 }),
                    )}
                    {renderMetricRow(
                      t('metrics.location'),
                      assessment.metrics.mappedLocation || assessment.metrics.location || t('unknownValue'),
                    )}
                    {renderMetricRow(
                      t('metrics.householdSize'),
                      t('metrics.householdSizeValue', {
                        count: assessment.metrics.householdSize,
                        children: assessment.metrics.childrenCount,
                      }),
                    )}
                    {renderMetricRow(
                      t('metrics.occupation'),
                      assessment.metrics.occupation || assessment.metrics.industry || t('unknownValue'),
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Card elevation={0} sx={{ borderRadius: 4, height: '100%' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    {t('sourcesTitle')}
                  </Typography>
                  <Stack spacing={1.5}>
                    {assessment.sources.map((source) => (
                      <Box key={source.id}>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {source.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          {t('sourceCaption', { date: formatDateTime(source.effectiveDate) })}
                        </Typography>
                        <Link
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          underline="hover"
                          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                        >
                          {t('sourceLink')}
                          <OpenInNewIcon sx={{ fontSize: 16 }} />
                        </Link>
                      </Box>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Stack>
      )}
    </Box>
  );
};

export default ProfilingTab;
