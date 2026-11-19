import { Alert, Box, FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import { useTranslation } from 'react-i18next';
import { useUsageAnalyticsSettings } from '../hooks/useUsageAnalyticsSettings';
import UsageAnalyticsDetails from './UsageAnalyticsDetails';

const UsageAnalyticsPanel: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'usageAnalytics' });
  const {
    loading, available, enabled, saving, error, setEnabled,
    installationCountingAvailable, installationCountingEnabled, excluded, exclusionLocked,
    setInstallationCountingEnabled, setExcluded,
  } = useUsageAnalyticsSettings();

  return (
    <Paper sx={{ p: 3, mb: 3 }} data-testid="usage-analytics-panel">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <InsightsIcon color="primary" />
        <Typography variant="h6">{t('panel.title')}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('panel.description')}
      </Typography>

      <FormControlLabel
        control={(
          <Switch
            checked={enabled}
            disabled={loading || saving || !available || excluded}
            onChange={(event) => void setEnabled(event.target.checked)}
          />
        )}
        label={t('panel.toggle')}
        sx={{ mb: 2 }}
      />

      <UsageAnalyticsDetails />

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle1" gutterBottom>{t('installationCounting.title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('installationCounting.description')}
        </Typography>
        <FormControlLabel
          control={(
            <Switch
              checked={installationCountingEnabled}
              disabled={loading || saving || !installationCountingAvailable || excluded}
              onChange={(event) => void setInstallationCountingEnabled(event.target.checked)}
            />
          )}
          label={t('installationCounting.toggle')}
        />
        {!loading && !installationCountingAvailable && (
          <Typography variant="body2" color="text.secondary">{t('installationCounting.unavailable')}</Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('installationCounting.withdrawal')}
        </Typography>
      </Box>

      <Box sx={{ mt: 3 }}>
        <FormControlLabel
          control={(
            <Switch checked={excluded} disabled={loading || saving || exclusionLocked}
              onChange={(event) => void setExcluded(event.target.checked)} />
          )}
          label={t('installationCounting.exclude')}
        />
        <Typography variant="body2" color="text.secondary">{t('installationCounting.excludeDescription')}</Typography>
        {excluded && <Alert severity="info" sx={{ mt: 1 }}>{t('installationCounting.excluded')}</Alert>}
      </Box>

      {!loading && !available && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('panel.unavailable')}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {t('panel.saveFailed')}
        </Alert>
      )}
    </Paper>
  );
};

export default UsageAnalyticsPanel;
