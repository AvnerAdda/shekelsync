import { Box, CircularProgress, Typography } from '@mui/material';

interface LoadingFallbackProps {
  message?: string;
}

export const LoadingFallback: React.FC<LoadingFallbackProps> = ({
  message = 'Loading...'
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 'calc(100vh - 64px)',
        gap: 2,
      }}
    >
      <CircularProgress size={48} />
      <Typography variant="body1" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
};

export default LoadingFallback;
