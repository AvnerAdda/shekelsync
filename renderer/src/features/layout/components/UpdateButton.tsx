import React from 'react';
import {
  IconButton,
  Badge,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  CircularProgress,
  Box,
  LinearProgress,
  Divider,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  SystemUpdateAlt as UpdateIcon,
  Download as DownloadIcon,
  RestartAlt as RestartIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available';
  updateInfo: UpdateInfo | null;
  downloadProgress: number;
  error: string | null;
}

interface UpdateButtonProps {
  updateState: UpdateState;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
}

const UpdateButton: React.FC<UpdateButtonProps> = ({
  updateState,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
}) => {
  const { t } = useTranslation('translation');
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleAction = (action: () => void) => {
    action();
    handleClose();
  };

  const getStatusIcon = () => {
    switch (updateState.status) {
      case 'checking':
        return <CircularProgress size={20} sx={{ color: theme.palette.primary.main }} />;
      case 'available':
        return <UpdateIcon sx={{ fontSize: 20, color: theme.palette.warning.main }} />;
      case 'downloading':
        return <DownloadIcon sx={{ fontSize: 20, color: theme.palette.info.main }} />;
      case 'downloaded':
        return <RestartIcon sx={{ fontSize: 20, color: theme.palette.success.main }} />;
      case 'error':
        return <ErrorIcon sx={{ fontSize: 20, color: theme.palette.error.main }} />;
      case 'not-available':
        return <CheckIcon sx={{ fontSize: 20, color: theme.palette.success.main }} />;
      default:
        return <RefreshIcon sx={{ fontSize: 20 }} />;
    }
  };

  const getTooltipText = () => {
    switch (updateState.status) {
      case 'checking':
        return t('titleBar.update.tooltip.checking');
      case 'available':
        return t('titleBar.update.tooltip.available', { version: updateState.updateInfo?.version });
      case 'downloading':
        return t('titleBar.update.tooltip.downloading', { progress: updateState.downloadProgress });
      case 'downloaded':
        return t('titleBar.update.tooltip.downloaded');
      case 'error':
        return t('titleBar.update.tooltip.error');
      case 'not-available':
        return t('titleBar.update.tooltip.upToDate');
      default:
        return t('titleBar.update.tooltip.checkForUpdates');
    }
  };

  const showBadge = updateState.status === 'available' || updateState.status === 'downloaded';

  return (
    <>
      <Tooltip title={getTooltipText()}>
        <IconButton
          size="small"
          onClick={handleClick}
          sx={{
            width: 36,
            height: 36,
            color: theme.palette.text.secondary,
            borderRadius: 2,
            transition: 'all 0.2s',
            '&:hover': {
              backgroundColor: alpha(theme.palette.text.primary, 0.05),
              color: theme.palette.text.primary,
              transform: 'translateY(-2px)',
            },
          }}
        >
          <Badge
            badgeContent={showBadge ? '!' : 0}
            color={updateState.status === 'downloaded' ? 'success' : 'warning'}
            sx={{
              '& .MuiBadge-badge': {
                width: 16,
                height: 16,
                fontSize: '0.6rem',
                minWidth: 16,
                borderRadius: '50%',
              },
            }}
          >
            {getStatusIcon()}
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            elevation: 8,
            sx: {
              mt: 1.5,
              borderRadius: 3,
              minWidth: 280,
              maxWidth: 320,
              backgroundColor: theme.palette.mode === 'dark' 
                ? 'rgba(30, 30, 30, 0.95)' 
                : 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={600} color={theme.palette.text.primary}>
            {t('titleBar.update.menu.title')}
          </Typography>
          <Typography variant="caption" color={theme.palette.text.secondary}>
            {t('titleBar.update.menu.subtitle')}
          </Typography>
        </Box>

        {updateState.status === 'downloading' && (
          <Box sx={{ px: 2, py: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color={theme.palette.text.secondary}>
                {t('titleBar.update.menu.downloading')}
              </Typography>
              <Typography variant="body2" color={theme.palette.text.secondary}>
                {updateState.downloadProgress}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={updateState.downloadProgress}
              sx={{ borderRadius: 1, height: 6 }}
            />
          </Box>
        )}

        <Divider sx={{ borderColor: alpha(theme.palette.divider, 0.1) }} />

        {updateState.status === 'idle' || updateState.status === 'not-available' || updateState.status === 'error' ? (
          <MenuItem 
            onClick={() => handleAction(onCheckForUpdates)} 
            sx={{ borderRadius: 1, mx: 0.5, my: 0.5 }}
          >
            <ListItemIcon>
              <RefreshIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('titleBar.update.menu.checkForUpdates')}</ListItemText>
          </MenuItem>
        ) : null}

        {updateState.status === 'available' && (
          <MenuItem 
            onClick={() => handleAction(onDownloadUpdate)}
            sx={{ borderRadius: 1, mx: 0.5, my: 0.5 }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              <Typography variant="body2">
                {t('titleBar.update.menu.downloadUpdate')}
              </Typography>
              <Typography variant="caption" color={theme.palette.text.secondary}>
                {t('titleBar.update.menu.version', { version: updateState.updateInfo?.version })}
              </Typography>
            </ListItemText>
          </MenuItem>
        )}

        {updateState.status === 'downloaded' && (
          <MenuItem 
            onClick={() => handleAction(onInstallUpdate)}
            sx={{ 
              borderRadius: 1, 
              mx: 0.5, 
              my: 0.5,
              backgroundColor: alpha(theme.palette.success.main, 0.1),
              '&:hover': {
                backgroundColor: alpha(theme.palette.success.main, 0.2),
              },
            }}
          >
            <ListItemIcon>
              <RestartIcon fontSize="small" sx={{ color: theme.palette.success.main }} />
            </ListItemIcon>
            <ListItemText>
              <Typography variant="body2" sx={{ color: theme.palette.success.main, fontWeight: 600 }}>
                {t('titleBar.update.menu.restartAndUpdate')}
              </Typography>
              <Typography variant="caption" color={theme.palette.text.secondary}>
                {t('titleBar.update.menu.readyToInstall')}
              </Typography>
            </ListItemText>
          </MenuItem>
        )}

        {updateState.error && (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography 
              variant="caption" 
              color={theme.palette.error.main}
              sx={{ 
                display: 'block',
                backgroundColor: alpha(theme.palette.error.main, 0.1),
                padding: 1,
                borderRadius: 1,
              }}
            >
              {updateState.error}
            </Typography>
          </Box>
        )}

        {updateState.updateInfo?.releaseNotes && (
          <>
            <Divider sx={{ borderColor: alpha(theme.palette.divider, 0.1) }} />
            <Box sx={{ px: 2, py: 1, maxHeight: 120, overflow: 'auto' }}>
              <Typography variant="caption" fontWeight={600} color={theme.palette.text.primary}>
                {t('titleBar.update.menu.releaseNotes')}
              </Typography>
              <Typography 
                variant="caption" 
                color={theme.palette.text.secondary}
                sx={{ 
                  display: 'block', 
                  mt: 0.5,
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.7rem',
                }}
              >
                {updateState.updateInfo.releaseNotes}
              </Typography>
            </Box>
          </>
        )}
      </Menu>
    </>
  );
};

export default UpdateButton;
