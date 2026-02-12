import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
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

type ConfigWarning = {
  code?: string;
  severity?: 'info' | 'warning' | 'error';
  message?: string;
};

type ConfigHealth = {
  database?: {
    mode?: string;
    sqlitePath?: string | null;
    sqliteExists?: boolean | null;
  };
  autoUpdateEnabled?: boolean;
  warnings?: ConfigWarning[];
};

type DiagnosticsInfo = {
  logDirectory?: string;
  logFile?: string;
  appVersion?: string;
  platform?: string;
  telemetry?: TelemetryDiagnosticsInfo | null;
  analyticsMetrics?: AnalyticsMetricsSnapshot;
  configHealth?: ConfigHealth | null;
};

type Status = 'idle' | 'loading' | 'success' | 'error';

const defaultInfo: DiagnosticsInfo = {
  appVersion: undefined,
  logDirectory: undefined,
  logFile: undefined,
  platform: undefined,
  telemetry: null,
  analyticsMetrics: null,
  configHealth: null,
};

const METRIC_LABELS: Record<string, string> = {
  breakdown: 'metrics.breakdown',
  dashboard: 'metrics.dashboard',
  unifiedCategory: 'metrics.unifiedCategory',
  waterfall: 'metrics.waterfall',
  categoryOpportunities: 'metrics.categoryOpportunities',
};

export function formatMetricKey(key: string) {
  const spaced = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatTimestamp(value?: string) {
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
  const [copyStatus, setCopyStatus] = useState<Status>('idle');
  const [backupStatus, setBackupStatus] = useState<Status>('idle');
  const [restoreStatus, setRestoreStatus] = useState<Status>('idle');
  const [restartRecommended, setRestartRecommended] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const diagnosticsApi = typeof window !== 'undefined' ? window.electronAPI?.diagnostics : undefined;
  const fileApi = typeof window !== 'undefined' ? window.electronAPI?.file : undefined;
  const databaseApi = typeof window !== 'undefined' ? window.electronAPI?.database : undefined;
  const appApi = typeof window !== 'undefined' ? window.electronAPI?.app : undefined;

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
            configHealth: result.configHealth ?? null,
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
  }, [diagnosticsApi, t]);

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
  }, [diagnosticsApi, fileApi, t]);

  const handleCopyDiagnostics = useCallback(async () => {
    if (!diagnosticsApi?.copyDiagnostics) {
      setCopyStatus('error');
      setErrorMessage(t('errors.copyUnsupported'));
      return;
    }

    setCopyStatus('loading');
    const result = await diagnosticsApi.copyDiagnostics();
    if (!result.success) {
      setCopyStatus('error');
      setErrorMessage(result.error ?? t('errors.copyFailed'));
      return;
    }
    setErrorMessage(null);
    setCopyStatus('success');
    setTimeout(() => setCopyStatus('idle'), 2500);
  }, [diagnosticsApi, t]);

  const handleBackupDatabase = useCallback(async () => {
    if (!databaseApi?.backup || !fileApi?.showSaveDialog) {
      setBackupStatus('error');
      setErrorMessage(t('errors.backupUnsupported'));
      return;
    }

    const defaultFilename = `shekelsync-backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.sqlite`;
    const saveResult = await fileApi.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [{ name: t('backupDialogLabel'), extensions: ['sqlite', 'db'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return;
    }

    setBackupStatus('loading');
    const result = await databaseApi.backup(saveResult.filePath);
    if (!result.success) {
      setBackupStatus('error');
      setErrorMessage(result.error ?? t('errors.backupFailed'));
      return;
    }
    setErrorMessage(null);
    setBackupStatus('success');
    setTimeout(() => setBackupStatus('idle'), 2500);
  }, [databaseApi, fileApi, t]);

  const handleRestoreDatabase = useCallback(async () => {
    if (!databaseApi?.restore || !fileApi?.showOpenDialog) {
      setRestoreStatus('error');
      setErrorMessage(t('errors.restoreUnsupported'));
      return;
    }

    const confirm = typeof window !== 'undefined'
      ? window.confirm(t('restoreConfirm'))
      : true;
    if (!confirm) {
      return;
    }

    const openResult = await fileApi.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: t('backupDialogLabel'), extensions: ['sqlite', 'db'] }],
    });
    if (openResult.canceled || !openResult.filePaths?.length) {
      return;
    }

    setRestartRecommended(false);
    setRestoreStatus('loading');
    const result = await databaseApi.restore(openResult.filePaths[0]);
    if (!result.success) {
      setRestoreStatus('error');
      setErrorMessage(result.error ?? t('errors.restoreFailed'));
      return;
    }
    setRestartRecommended(Boolean(result.restartRecommended));
    setErrorMessage(null);
    setRestoreStatus('success');
    setTimeout(() => setRestoreStatus('idle'), 2500);
  }, [databaseApi, fileApi, t]);

  const handleRestart = useCallback(async () => {
    if (!appApi?.relaunch) {
      return;
    }
    await appApi.relaunch();
  }, [appApi]);

  const actionDisabled = useMemo(() => !supportsDiagnostics || loading, [loading, supportsDiagnostics]);
  const databaseActionsDisabled = useMemo(
    () => loading || !databaseApi,
    [loading, databaseApi],
  );
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

      {info.configHealth?.warnings?.length ? (
        <Stack spacing={1} mb={2}>
          {info.configHealth.warnings.map((warning, index) => (
            <Alert
              key={`${warning.code || 'warning'}-${index}`}
              severity={warning.severity || 'warning'}
            >
              {warning.code
                ? t(`warnings.${warning.code}`, { defaultValue: warning.message })
                : warning.message}
            </Alert>
          ))}
        </Stack>
      ) : null}

      {info.configHealth?.database?.mode && (
        <Box mb={2}>
          <Typography variant="caption" color="text.secondary" display="block">
            {t('config.databaseMode')}
          </Typography>
          <Typography variant="body2">
            {info.configHealth.database.mode}
          </Typography>
          {info.configHealth.database.sqlitePath && (
            <>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {t('config.sqlitePath')}
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {info.configHealth.database.sqlitePath}
              </Typography>
            </>
          )}
        </Box>
      )}

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

        <Button
          startIcon={copyStatus === 'loading' ? <CircularProgress size={16} /> : <FileDownloadIcon />}
          variant="outlined"
          onClick={handleCopyDiagnostics}
          disabled={actionDisabled}
        >
          {t('copy')}
        </Button>
      </Stack>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle2" gutterBottom>
        {t('backup.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('backup.description')}
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={2}>
        <Button
          startIcon={backupStatus === 'loading' ? <CircularProgress size={16} /> : <FileDownloadIcon />}
          variant="contained"
          onClick={handleBackupDatabase}
          disabled={databaseActionsDisabled}
        >
          {t('backup.action')}
        </Button>
        <Button
          startIcon={restoreStatus === 'loading' ? <CircularProgress size={16} /> : <FileDownloadIcon />}
          variant="outlined"
          color="warning"
          onClick={handleRestoreDatabase}
          disabled={databaseActionsDisabled}
        >
          {t('backup.restore')}
        </Button>
        {restartRecommended && (
          <Button variant="text" onClick={handleRestart}>
            {t('backup.restart')}
          </Button>
        )}
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
                <Grid size={{ xs: 12, md: 6 }} key={summary.bucket}>
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
