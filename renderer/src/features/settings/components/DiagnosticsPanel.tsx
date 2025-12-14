import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useTranslation } from 'react-i18next';

type AnalyticsMetricSample = {
  durationMs?: number;
  recordedAt?: string;
  type?: string;
  months?: number;
  aggregation?: string;
  groupBy?: string;
  rowCounts?: Record<string, number>;
};

type AnalyticsMetricsSnapshot = {
  breakdown?: AnalyticsMetricSample[];
  dashboard?: AnalyticsMetricSample[];
  unifiedCategory?: AnalyticsMetricSample[];
  waterfall?: AnalyticsMetricSample[];
  categoryOpportunities?: AnalyticsMetricSample[];
} | null;

type TelemetryDiagnosticsInfo = {
  enabled?: boolean;
  initialized?: boolean;
  dsnConfigured?: boolean;
  dsnHost?: string | null;
  dsnProjectId?: string | null;
  debug?: boolean;
};

type DiagnosticsInfo = {
  logDirectory?: string;
  logFile?: string;
  appVersion?: string;
  platform?: string;
  telemetry?: TelemetryDiagnosticsInfo | null;
  analyticsMetrics?: AnalyticsMetricsSnapshot;
};

type Status = 'idle' | 'loading' | 'success' | 'error';

const defaultInfo: DiagnosticsInfo = {
  appVersion: undefined,
  logDirectory: undefined,
  logFile: undefined,
  platform: undefined,
  telemetry: null,
  analyticsMetrics: null,
};

const METRIC_LABELS: Record<string, string> = {
  breakdown: 'metrics.breakdown',
  dashboard: 'metrics.dashboard',
  unifiedCategory: 'metrics.unifiedCategory',
  waterfall: 'metrics.waterfall',
  categoryOpportunities: 'metrics.categoryOpportunities',
};

function formatMetricKey(key: string) {
  const spaced = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatTimestamp(value?: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString();
}

export const DiagnosticsPanel: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'settings.diagnosticsPanel' });
  const [info, setInfo] = useState<DiagnosticsInfo>(defaultInfo);
  const [loading, setLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState<Status>('idle');
  const [openStatus, setOpenStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const diagnosticsApi = typeof window !== 'undefined' ? window.electronAPI?.diagnostics : undefined;
  const fileApi = typeof window !== 'undefined' ? window.electronAPI?.file : undefined;

  const supportsDiagnostics = Boolean(diagnosticsApi);

  useEffect(() => {
    if (!diagnosticsApi?.getInfo) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    diagnosticsApi
      .getInfo()
      .then((result) => {
        if (!cancelled && result?.success) {
          setInfo({
            appVersion: result.appVersion,
            logDirectory: result.logDirectory,
            logFile: result.logFile,
            platform: result.platform,
            telemetry: result.telemetry ?? null,
            analyticsMetrics: result.analyticsMetrics ?? null,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [diagnosticsApi]);

  const handleOpenLogs = useCallback(async () => {
    if (!diagnosticsApi?.openLogDirectory) {
      setOpenStatus('error');
      setErrorMessage(t('errors.logUnavailable'));
      return;
    }
    setOpenStatus('loading');
    const result = await diagnosticsApi.openLogDirectory();
    if (!result.success) {
      setErrorMessage(result.error ?? t('errors.openFailed'));
      setOpenStatus('error');
      return;
    }
    setErrorMessage(null);
    setOpenStatus('success');
    setTimeout(() => setOpenStatus('idle'), 2000);
  }, [diagnosticsApi]);

  const handleExport = useCallback(async () => {
    if (!diagnosticsApi?.exportDiagnostics || !fileApi?.showSaveDialog) {
      setExportStatus('error');
      setErrorMessage(t('errors.exportUnsupported'));
      return;
    }

    const defaultFilename = `shekelsync-diagnostics-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    const saveResult = await fileApi.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [{ name: t('saveDialogLabel'), extensions: ['json'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return;
    }

    setExportStatus('loading');
    const exportResult = await diagnosticsApi.exportDiagnostics(saveResult.filePath);
    if (!exportResult.success) {
      setExportStatus('error');
      setErrorMessage(exportResult.error ?? t('errors.exportFailed'));
      return;
    }
    setErrorMessage(null);
    setExportStatus('success');
    setTimeout(() => setExportStatus('idle'), 2500);
  }, [diagnosticsApi, fileApi]);

  const actionDisabled = useMemo(() => !supportsDiagnostics || loading, [loading, supportsDiagnostics]);
  const metricsSummary = useMemo(() => {
    if (!info.analyticsMetrics) {
      return [];
    }
    return Object.entries(info.analyticsMetrics)
      .filter(([, samples]) => Array.isArray(samples) && samples.length > 0)
      .map(([bucket, samples]) => {
        const safeSamples = samples as AnalyticsMetricSample[];
        const latest = safeSamples[safeSamples.length - 1];
        const avgDuration =
          safeSamples.length > 0
            ? Number(
                (
                  safeSamples.reduce((sum, sample) => sum + (sample.durationMs || 0), 0) /
                  safeSamples.length
                ).toFixed(1),
              )
            : null;
        return {
          bucket,
          label: METRIC_LABELS[bucket] ? t(METRIC_LABELS[bucket]) : formatMetricKey(bucket),
          totalRuns: safeSamples.length,
          avgDuration,
          latest,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [info.analyticsMetrics]);

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" mb={2}>
        <BugReportIcon color="primary" />
        <Typography variant="h6">{t('title')}</Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary" paragraph>
        {t('description')}
      </Typography>

      {!supportsDiagnostics && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('notSupported')}
        </Alert>
      )}

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={2}>
        <Button
          startIcon={openStatus === 'loading' ? <CircularProgress size={16} /> : <FolderOpenIcon />}
          variant="outlined"
          onClick={handleOpenLogs}
          disabled={actionDisabled}
        >
          {t('openLogs')}
        </Button>

        <Button
          startIcon={exportStatus === 'loading' ? <CircularProgress size={16} /> : <FileDownloadIcon />}
          variant="contained"
          onClick={handleExport}
          disabled={actionDisabled}
        >
          {t('export')}
        </Button>
      </Stack>

      {info.logDirectory && (
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            {t('logDirectory')}
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
            {info.logDirectory}
          </Typography>
        </Box>
      )}

      <Stack direction="row" spacing={2} mt={2}>
        {info.appVersion && (
          <Typography variant="caption" color="text.secondary">
            {t('version', { version: info.appVersion })}
          </Typography>
        )}
        {info.platform && (
          <Typography variant="caption" color="text.secondary">
            {t('platform', { platform: info.platform })}
          </Typography>
        )}
      </Stack>

      {info.telemetry && (
        <Box mt={3} p={2} borderRadius={2} bgcolor={(theme) => theme.palette.action.hover}>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            {t('telemetry.status')}
          </Typography>
          <Typography variant="body2" fontWeight="bold">
            {info.telemetry.enabled ? t('telemetry.optedIn') : t('telemetry.optedOut')}
          </Typography>
          {!info.telemetry.dsnConfigured && (
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              {t('telemetry.noDsn')}
            </Typography>
          )}
          {info.telemetry.dsnConfigured && info.telemetry.dsnHost && (
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              {t('telemetry.destination', { host: info.telemetry.dsnHost })}
            </Typography>
          )}
        </Box>
      )}

      {metricsSummary.length > 0 && (
        <Box mt={3}>
          <Typography variant="subtitle2" gutterBottom>
            {t('metrics.title')}
          </Typography>
          <Grid container spacing={2}>
            {metricsSummary.map((summary) => {
              const lastRun = formatTimestamp(summary.latest?.recordedAt);
              const rowCountsEntries = summary.latest?.rowCounts
                ? Object.entries(summary.latest.rowCounts)
                : [];
              return (
                <Grid item xs={12} md={6} key={summary.bucket}>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body2" fontWeight="bold">
                      {summary.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t('metrics.runs', { count: summary.totalRuns })}
                      {summary.avgDuration ? ` · ${t('metrics.avgDuration', { value: summary.avgDuration })}` : ''}
                    </Typography>
                    {lastRun && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('metrics.lastRun', { date: lastRun })}
                      </Typography>
                    )}
                    {rowCountsEntries.length > 0 && (
                      <Box mt={1}>
                        {rowCountsEntries.map(([key, value]) => (
                          <Typography variant="caption" color="text.secondary" display="block" key={key}>
                            {formatMetricKey(key)}: {value}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}
    </Paper>
  );
};

export default DiagnosticsPanel;
