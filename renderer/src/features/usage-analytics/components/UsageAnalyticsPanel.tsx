import { Alert, Box, FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import { useTranslation } from 'react-i18next';
import { useUsageAnalyticsSettings } from '../hooks/useUsageAnalyticsSettings';
import UsageAnalyticsDetails from './UsageAnalyticsDetails';

const UsageAnalyticsPanel: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'usageAnalytics' });
  const { loading, available, enabled, saving, error, setEnabled } = useUsageAnalyticsSettings();

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
            disabled={loading || saving || !available}
            onChange={(event) => void setEnabled(event.target.checked)}
          />
        )}
        label={t('panel.toggle')}
        sx={{ mb: 2 }}
      />

      <UsageAnalyticsDetails />

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
