import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

type DiagnosticsInfo = {
  logDirectory?: string;
  logFile?: string;
  appVersion?: string;
  platform?: string;
};

type Status = 'idle' | 'loading' | 'success' | 'error';

const defaultInfo: DiagnosticsInfo = {
  appVersion: undefined,
  logDirectory: undefined,
  logFile: undefined,
  platform: undefined,
};

export const DiagnosticsPanel: React.FC = () => {
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
      setErrorMessage('Log directory access is unavailable in this environment.');
      return;
    }
    setOpenStatus('loading');
    const result = await diagnosticsApi.openLogDirectory();
    if (!result.success) {
      setErrorMessage(result.error ?? 'Failed to open log directory.');
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
      setErrorMessage('Diagnostics export is not supported in this environment.');
      return;
    }

    const defaultFilename = `shekelsync-diagnostics-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    const saveResult = await fileApi.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [{ name: 'Diagnostics Bundle', extensions: ['json'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return;
    }

    setExportStatus('loading');
    const exportResult = await diagnosticsApi.exportDiagnostics(saveResult.filePath);
    if (!exportResult.success) {
      setExportStatus('error');
      setErrorMessage(exportResult.error ?? 'Failed to export diagnostics bundle.');
      return;
    }
    setErrorMessage(null);
    setExportStatus('success');
    setTimeout(() => setExportStatus('idle'), 2500);
  }, [diagnosticsApi, fileApi]);

  const actionDisabled = useMemo(() => !supportsDiagnostics || loading, [loading, supportsDiagnostics]);

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" mb={2}>
        <BugReportIcon color="primary" />
        <Typography variant="h6">Diagnostics & Logs</Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary" paragraph>
        Export recent logs and system context when filing a support ticket, or open the log directory to inspect issues locally.
      </Typography>

      {!supportsDiagnostics && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Diagnostics tooling is only available in the packaged Electron app.
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
          Open Log Folder
        </Button>

        <Button
          startIcon={exportStatus === 'loading' ? <CircularProgress size={16} /> : <FileDownloadIcon />}
          variant="contained"
          onClick={handleExport}
          disabled={actionDisabled}
        >
          Export Diagnostics
        </Button>
      </Stack>

      {info.logDirectory && (
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Log directory
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
            {info.logDirectory}
          </Typography>
        </Box>
      )}

      <Stack direction="row" spacing={2} mt={2}>
        {info.appVersion && (
          <Typography variant="caption" color="text.secondary">
            Version: {info.appVersion}
          </Typography>
        )}
        {info.platform && (
          <Typography variant="caption" color="text.secondary">
            Platform: {info.platform}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
};

export default DiagnosticsPanel;
