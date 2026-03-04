import { Box, Button, Container, Paper, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface ErrorContent {
  title: string;
  message: string;
  debugInfo?: string;
}

const getErrorContent = (
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): ErrorContent => {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        title: t('titles.notFound'),
        message: t('messages.notFound'),
      };
    }

    const routeMessage = typeof error.data === 'string'
      ? error.data
      : t('messages.requestFailed', { status: error.status });

    return {
      title: error.status >= 500 ? t('titles.server') : t('titles.navigation'),
      message: routeMessage,
      debugInfo: `${error.status} ${error.statusText}`.trim(),
    };
  }

  if (error instanceof Error) {
    return {
      title: t('titles.unexpected'),
      message: t('messages.renderFailure'),
      debugInfo: error.stack || error.message,
    };
  }

  if (typeof error === 'string') {
    return {
      title: t('titles.unexpected'),
      message: error,
      debugInfo: error,
    };
  }

  return {
    title: t('titles.unexpected'),
    message: t('messages.loadFailure'),
  };
};

const RouteErrorBoundary: React.FC = () => {
  const error = useRouteError();
  const navigate = useNavigate();
  const { t } = useTranslation('translation', { keyPrefix: 'routeError' });
  const { title, message, debugInfo } = getErrorContent(error, t);

  return (
    <Container maxWidth="md">
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          py: 4,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: 4,
            textAlign: 'center',
            maxWidth: 640,
            width: '100%',
          }}
        >
          <ErrorOutlineIcon
            sx={{
              fontSize: 64,
              color: 'error.main',
              mb: 2,
            }}
          />
          <Typography variant="h4" gutterBottom color="error">
            {title}
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            {message}
          </Typography>

          {import.meta.env.DEV && debugInfo && (
            <Paper
              sx={{
                p: 2,
                my: 3,
                backgroundColor: 'grey.100',
                textAlign: 'left',
                maxHeight: 220,
                overflow: 'auto',
              }}
            >
              <Typography
                variant="caption"
                component="pre"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                }}
              >
                {debugInfo}
              </Typography>
            </Paper>
          )}

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 3 }}>
            <Button
              variant="outlined"
              onClick={() => navigate('/')}
              startIcon={<HomeOutlinedIcon />}
            >
              {t('actions.goToDashboard')}
            </Button>
            <Button
              variant="contained"
              onClick={() => window.location.reload()}
              startIcon={<RefreshIcon />}
            >
              {t('actions.reloadApp')}
            </Button>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default RouteErrorBoundary;
