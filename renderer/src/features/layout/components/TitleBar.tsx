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
import SmartNotifications from '@renderer/features/notifications/components/SmartNotifications';

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

  // Platform detection
  const isMacOS = window.electronAPI?.platform?.isMacOS;

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
      case 'view-zoom-in':
        if (window.electronAPI?.window?.zoomIn) {
          window.electronAPI.window.zoomIn().catch(console.error);
        }
        break;
      case 'view-zoom-out':
        if (window.electronAPI?.window?.zoomOut) {
          window.electronAPI.window.zoomOut().catch(console.error);
        }
        break;
      case 'view-reset':
        if (window.electronAPI?.window?.zoomReset) {
          window.electronAPI.window.zoomReset().catch(console.error);
        }
        break;
      case 'help-open-logs':
        if (diagnosticsBridge?.openLogDirectory) {
          diagnosticsBridge.openLogDirectory().catch(console.error);
        }
        break;
      case 'help-export-diagnostics':
        handleDiagnosticsExportShortcut();
        break;
      case 'file-exit':
        handleClose();
        break;
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
      onDoubleClick={isMacOS ? undefined : handleMaximize}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        zIndex: (muiTheme) => muiTheme.zIndex.drawer + 1,
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(10, 10, 10, 0.7)'
          : 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.06)',
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        pl: isMacOS ? 10 : 2, // Add padding for macOS traffic lights
        pr: 2,
        WebkitAppRegion: 'drag',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Left section: Menu + Logo */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, WebkitAppRegion: 'no-drag' }}>
        <IconButton
          aria-label="Open menu"
          onClick={handleMenuClick}
          size="small"
          sx={{
            color: 'text.primary',
            padding: '4px',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          <MenuIcon fontSize="small" />
        </IconButton>

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          slotProps={{
            paper: {
              elevation: 8,
              sx: {
                minWidth: 220,
                mt: 1,
                borderRadius: 2,
                overflow: 'hidden',
              },
            },
          }}
        >
          {activeSubmenu ? (
            <>
              <MenuItem onClick={() => setActiveSubmenu(null)} sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
                ← Back
              </MenuItem>
              <Divider />
              {renderSubmenu(activeSubmenu)}
            </>
          ) : (
            <>
              <MenuItem onClick={() => setActiveSubmenu('file')} dense>
                <ListItemIcon><FileIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="File" />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('edit')} dense>
                <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Edit" />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('view')} dense>
                <ListItemIcon><ViewIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="View" />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('go')} dense>
                <ListItemIcon><GoIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Go" />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('help')} dense>
                <ListItemIcon><HelpIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Help" />
              </MenuItem>
            </>
          )}
        </Menu>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #3ea54d 0%, #a54d3e 100%)',
            backgroundSize: '200% 200%',
            animation: 'logo-gradient 6s ease infinite',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            padding: '6px',
            '@keyframes logo-gradient': {
              '0%': { backgroundPosition: '0% 50%' },
              '50%': { backgroundPosition: '100% 50%' },
              '100%': { backgroundPosition: '0% 50%' },
            },
          }}
        >
          <img
            src={logoUrl}
            alt="ShekelSync"
            width={20}
            height={20}
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </Box>

        <Typography
          variant="subtitle2"
          component="div"
          sx={{
            fontWeight: 600,
            fontSize: '0.95rem',
            color: 'text.primary',
            userSelect: 'none',
          }}
        >
          ShekelSync
        </Typography>
      </Box>

      {/* Right section: Status + Notifications + Window Controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, WebkitAppRegion: 'no-drag' }}>
        {sessionDisplayName && (
          <Chip
            size="small"
            label={sessionDisplayName}
            variant="outlined"
            color="default"
            sx={{
              height: 24,
              fontSize: '0.75rem',
              backgroundColor: 'action.hover',
              border: 'none',
            }}
          />
        )}

        <SmartNotifications />

        {/* Window Controls - Hide on macOS as we use native traffic lights */}
        {!isMacOS && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1, borderLeft: 1, borderColor: 'divider', pl: 1.5 }}>
            <IconButton
              aria-label="Minimize window"
              onClick={handleMinimize}
              size="small"
              sx={{
                width: 28,
                height: 28,
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              <MinimizeIcon sx={{ fontSize: 18 }} />
            </IconButton>

            <IconButton
              aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
              onClick={handleMaximize}
              size="small"
              sx={{
                width: 28,
                height: 28,
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              <MaximizeIcon sx={{ fontSize: 18 }} />
            </IconButton>

            <IconButton
              aria-label="Close window"
              onClick={handleClose}
              size="small"
              sx={{
                width: 28,
                height: 28,
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: '#d32f2f',
                  color: 'white',
                },
              }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default TitleBar;
