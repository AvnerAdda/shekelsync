import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
  Chip,
  useTheme,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Close as CloseIcon,
  Minimize as MinimizeIcon,
  CropSquare as MaximizeIcon,
  Description as FileIcon,
  Edit as EditIcon,
  Visibility as ViewIcon,
  Navigation as GoIcon,
  Help as HelpIcon,
  FiberNew as NewIcon,
  FolderOpen as OpenIcon,
  Save as SaveIcon,
  ExitToApp as ExitIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
  ContentCut as CutIcon,
  ContentCopy as CopyIcon,
  ContentPaste as PasteIcon,
  Fullscreen as FullscreenIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  SettingsBackupRestore as ResetIcon,
  Dashboard as DashboardIcon,
  Analytics as AnalyticsIcon,
  TrendingUp as InvestmentsIcon,
  Settings as SettingsIcon,
  MenuBook as DocsIcon,
  Info as AboutIcon,
  BugReport as DiagnosticsIcon,
  FolderOpen as FolderIcon,
  FileDownload as FileDownloadIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import logoUrl from '@app/public/logo.svg?url';
import SmartNotifications from '@app/components/SmartNotifications';

interface TitleBarProps {
  sessionDisplayName?: string | null;
  authLoading?: boolean;
}

const TitleBar: React.FC<TitleBarProps> = ({ sessionDisplayName, authLoading }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const diagnosticsBridge =
    typeof window !== 'undefined' ? window.electronAPI?.diagnostics : undefined;
  const fileBridge = typeof window !== 'undefined' ? window.electronAPI?.file : undefined;

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setActiveSubmenu(null);
  };

  const handleMinimize = async () => {
    if (window.electronAPI?.window?.minimize) {
      await window.electronAPI.window.minimize();
    }
  };

  const handleMaximize = async () => {
    if (window.electronAPI?.window?.maximize) {
      await window.electronAPI.window.maximize();
    }
  };

  const handleClose = async () => {
    if (window.electronAPI?.window?.close) {
      await window.electronAPI.window.close();
    }
  };

  const handleDiagnosticsExportShortcut = useCallback(async () => {
    if (!diagnosticsBridge?.exportDiagnostics || !fileBridge?.showSaveDialog) {
      console.info('Diagnostics export unavailable outside Electron runtime.');
      return;
    }
    const defaultFilename = `shekelsync-diagnostics-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    const saveResult = await fileBridge.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [{ name: 'Diagnostics Bundle', extensions: ['json'] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return;
    }

    const exportResult = await diagnosticsBridge.exportDiagnostics(saveResult.filePath);
    if (!exportResult.success) {
      console.error('Diagnostics export failed', exportResult.error);
    }
  }, [diagnosticsBridge, fileBridge]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return () => {};
    }
    const applyState = (state: boolean) => {
      setIsMaximized(state);
    };

    let unsubscribe: (() => void) | undefined;

    if (window.electronAPI?.window?.isMaximized) {
      window.electronAPI.window
        .isMaximized()
        .then((state: boolean) => applyState(Boolean(state)))
        .catch(() => applyState(false));
    }

    if (window.electronAPI?.events?.onWindowStateChanged) {
      const disposer = window.electronAPI.events.onWindowStateChanged(payload => {
        applyState(Boolean(payload?.maximized));
      });
      if (typeof disposer === 'function') {
        unsubscribe = disposer;
      }
    }

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleMenuAction = (action: string) => {
    handleMenuClose();

    switch (action) {
      case 'go-dashboard':
        navigate('/');
        break;
      case 'go-analysis':
        navigate('/analysis');
        break;
      case 'go-investments':
        navigate('/investments');
        break;
      case 'go-settings':
        navigate('/settings');
        break;
      case 'help-open-logs':
        if (diagnosticsBridge?.openLogDirectory) {
          diagnosticsBridge.openLogDirectory().catch((error) => {
            console.error('Failed to open log directory from Help menu', error);
          });
        } else {
          console.info('Diagnostics API unavailable in this environment.');
        }
        break;
      case 'help-export-diagnostics':
        handleDiagnosticsExportShortcut();
        break;
      case 'file-exit':
        handleClose();
        break;
      // Add more actions as needed
      default:
        console.log('Menu action:', action);
    }
  };

  const renderSubmenu = (submenu: string) => {
    switch (submenu) {
      case 'file':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('file-new')}>
              <ListItemIcon><NewIcon fontSize="small" /></ListItemIcon>
              <ListItemText>New</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('file-open')}>
              <ListItemIcon><OpenIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Open</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('file-save')}>
              <ListItemIcon><SaveIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Save</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleMenuAction('file-exit')}>
              <ListItemIcon><ExitIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Exit</ListItemText>
            </MenuItem>
          </>
        );
      case 'edit':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('edit-undo')}>
              <ListItemIcon><UndoIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Undo</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('edit-redo')}>
              <ListItemIcon><RedoIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Redo</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleMenuAction('edit-cut')}>
              <ListItemIcon><CutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Cut</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('edit-copy')}>
              <ListItemIcon><CopyIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Copy</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('edit-paste')}>
              <ListItemIcon><PasteIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Paste</ListItemText>
            </MenuItem>
          </>
        );
      case 'view':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('view-fullscreen')}>
              <ListItemIcon><FullscreenIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Toggle Fullscreen</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleMenuAction('view-zoom-in')}>
              <ListItemIcon><ZoomInIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Zoom In</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('view-zoom-out')}>
              <ListItemIcon><ZoomOutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Zoom Out</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('view-reset')}>
              <ListItemIcon><ResetIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Reset Zoom</ListItemText>
            </MenuItem>
          </>
        );
      case 'go':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('go-dashboard')}>
              <ListItemIcon><DashboardIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Dashboard</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('go-analysis')}>
              <ListItemIcon><AnalyticsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Analysis</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('go-investments')}>
              <ListItemIcon><InvestmentsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Investments</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('go-settings')}>
              <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Settings</ListItemText>
            </MenuItem>
          </>
        );
      case 'help':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('help-docs')}>
              <ListItemIcon><DocsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Documentation</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('help-open-logs')}>
              <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Open Log Folder</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('help-export-diagnostics')}>
              <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Export Diagnostics…</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem disabled>
              <ListItemIcon><DiagnosticsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Support Tools</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('help-about')}>
              <ListItemIcon><AboutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>About</ListItemText>
            </MenuItem>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Box
      component="header"
      role="banner"
      onDoubleClick={handleMaximize}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 64,
        zIndex: (muiTheme) => muiTheme.zIndex.drawer + 1,
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(30, 30, 30, 0.7)'
          : 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        borderBottom: theme.palette.mode === 'dark'
          ? '1px solid rgba(200, 250, 207, 0.1)'
          : '1px solid rgba(200, 250, 207, 0.2)',
        borderRadius: isMaximized ? '0' : '16px 16px 0 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        WebkitAppRegion: 'drag',
      }}
    >
      {/* Left section: Menu + Logo */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, WebkitAppRegion: 'no-drag' }}>
        <IconButton
          aria-label="Open menu"
          onClick={handleMenuClick}
          size="small"
          sx={{
            color: 'text.primary',
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(200, 250, 207, 0.1)'
                : 'rgba(200, 250, 207, 0.2)',
            },
          }}
        >
          <MenuIcon />
        </IconButton>

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          slotProps={{
            paper: {
              sx: {
                minWidth: 200,
                mt: 1,
              },
            },
          }}
        >
          {activeSubmenu ? (
            <>
              <MenuItem onClick={() => setActiveSubmenu(null)} sx={{ fontWeight: 600 }}>
                ← Back
              </MenuItem>
              <Divider />
              {renderSubmenu(activeSubmenu)}
            </>
          ) : (
            <>
              <MenuItem onClick={() => setActiveSubmenu('file')}>
                <ListItemIcon><FileIcon fontSize="small" /></ListItemIcon>
                <ListItemText>File</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('edit')}>
                <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Edit</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('view')}>
                <ListItemIcon><ViewIcon fontSize="small" /></ListItemIcon>
                <ListItemText>View</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('go')}>
                <ListItemIcon><GoIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Go</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('help')}>
                <ListItemIcon><HelpIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Help</ListItemText>
              </MenuItem>
            </>
          )}
        </Menu>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #c8facf 0%, #e0e2c8 50%, #facfc8 100%)',
            backgroundSize: '200% 200%',
            animation: 'gradient-flow 6s ease infinite',
            padding: '8px',
            boxShadow: `
              0 0 20px rgba(200, 250, 207, 0.4),
              0 0 40px rgba(250, 207, 200, 0.2),
              0 8px 32px rgba(0, 0, 0, 0.1)
            `,
            position: 'relative',
            transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: -2,
              background: 'linear-gradient(135deg, #c8facf, #facfc8)',
              borderRadius: '16px',
              opacity: 0,
              transition: 'opacity 0.3s',
              filter: 'blur(8px)',
              zIndex: -1,
            },
            '&:hover': {
              transform: 'scale(1.05) rotate(5deg)',
              boxShadow: `
                0 0 30px rgba(200, 250, 207, 0.6),
                0 0 60px rgba(250, 207, 200, 0.3),
                0 12px 40px rgba(0, 0, 0, 0.15)
              `,
            },
            '&:hover::before': {
              opacity: 0.7,
            },
            '@keyframes gradient-flow': {
              '0%, 100%': { backgroundPosition: '0% 50%' },
              '50%': { backgroundPosition: '100% 50%' },
            },
          }}
        >
          <img
            src={logoUrl}
            alt="ShekelSync"
            width={28}
            height={28}
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </Box>

        <Typography
          variant="h6"
          component="div"
          sx={{
            fontWeight: 600,
            letterSpacing: '-0.5px',
            background: 'linear-gradient(135deg, #3ea54d 0%, #a54d3e 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          ShekelSync
        </Typography>
      </Box>

      {/* Right section: Status + Notifications + Window Controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, WebkitAppRegion: 'no-drag' }}>
        <Chip
          size="small"
          color={sessionDisplayName ? 'success' : 'default'}
          variant={sessionDisplayName ? 'filled' : 'outlined'}
          label={authLoading
            ? 'Signing in…'
            : sessionDisplayName
              ? `Signed in as ${sessionDisplayName}`
              : 'Offline mode'}
          sx={{
            fontWeight: 500,
            ...(sessionDisplayName && {
              backgroundColor: 'success.light',
              color: 'success.contrastText',
            }),
          }}
        />

        <SmartNotifications />

        {/* Window Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
          <IconButton
            aria-label="Minimize window"
            onClick={handleMinimize}
            size="small"
            sx={{
              color: 'text.secondary',
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(200, 250, 207, 0.1)'
                  : 'rgba(200, 250, 207, 0.2)',
                color: 'text.primary',
              },
            }}
          >
            <MinimizeIcon fontSize="small" />
          </IconButton>

          <IconButton
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            onClick={handleMaximize}
            size="small"
            sx={{
              color: 'text.secondary',
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(200, 250, 207, 0.1)'
                  : 'rgba(200, 250, 207, 0.2)',
                color: 'text.primary',
              },
            }}
          >
            <MaximizeIcon fontSize="small" />
          </IconButton>

          <IconButton
            aria-label="Close window"
            onClick={handleClose}
            size="small"
            sx={{
              color: 'text.secondary',
              '&:hover': {
                backgroundColor: '#f44336',
                color: 'white',
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

export default TitleBar;
