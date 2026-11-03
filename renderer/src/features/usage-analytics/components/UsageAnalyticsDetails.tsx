import { Box, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/CheckCircleOutlined';
import BlockIcon from '@mui/icons-material/Block';
import { useTranslation } from 'react-i18next';

const SHARED_KEYS = ['version', 'system', 'screens', 'setup', 'syncs', 'features', 'errors'] as const;

const UsageAnalyticsDetails: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'usageAnalytics' });

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          {t('sharedTitle')}
        </Typography>
        <Stack component="ul" spacing={0.75} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {SHARED_KEYS.map((key) => (
            <Box component="li" key={key} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <CheckIcon fontSize="small" color="success" sx={{ mt: '2px' }} />
              <Typography variant="body2" color="text.secondary">
                {t(`shared.${key}`)}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <BlockIcon fontSize="small" color="error" sx={{ mt: '2px' }} />
        <Typography variant="body2" color="text.secondary">
          {t('neverShared')}
        </Typography>
      </Box>
    </Stack>
  );
};

export default UsageAnalyticsDetails;
