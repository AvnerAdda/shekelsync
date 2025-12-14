import React, { useCallback, useEffect, useState, useMemo } from 'react';
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
  Tooltip,
  Autocomplete,
  TextField,
  InputAdornment,
  Paper,
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
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
  Translate as TranslateIcon,
  Search as SearchIcon,
  Home as HomeIcon,
  AccountBalance as AccountsIcon,
  Category as CategoryIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import logoUrl from '@app/public/logo.svg?url';
import SmartNotifications from '@renderer/features/notifications/components/SmartNotifications';
import { useThemeMode } from '@app/contexts/ThemeContext';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';
import type { SupportedLocale } from '@renderer/i18n';

interface TitleBarProps {
  sessionDisplayName?: string | null;
  authLoading?: boolean;
}

const TitleBar: React.FC<TitleBarProps> = ({ sessionDisplayName, authLoading }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { t } = useTranslation('translation');
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowClassesApplied, setWindowClassesApplied] = useState(false);
  const [langMenuAnchor, setLangMenuAnchor] = useState<null | HTMLElement>(null);

  // Theme and language hooks
  const { mode, setMode, actualTheme } = useThemeMode();
  const { locale, setLocale } = useLocaleSettings();

  // Platform detection
  const isMacOS = window.electronAPI?.platform?.isMacOS;

  const getKeywords = useCallback(
    (key: string, fallback: string[]) => {
      const value = t(`titleBar.search.keywords.${key}`, {
        returnObjects: true,
        defaultValue: fallback,
      }) as unknown;
      return Array.isArray(value) ? (value as string[]) : fallback;
    },
    [t],
  );

  const languageLabels = useMemo(
    () => ({
      he: t('common.languages.he'),
      en: t('common.languages.en'),
      fr: t('common.languages.fr'),
    }),
    [t],
  );

  // Search navigation options - includes main pages and specific sections
  const searchOptions = useMemo(
    () => [
      // Main pages
      {
        label: t('titleBar.search.options.dashboard'),
        path: '/',
        icon: <HomeIcon fontSize="small" />,
        keywords: getKeywords('dashboard', ['home', 'overview', 'main', 'summary']),
      },
      {
        label: t('titleBar.search.options.analysis'),
        path: '/analysis',
        icon: <AnalyticsIcon fontSize="small" />,
        keywords: getKeywords('analysis', ['analytics', 'spending', 'budget', 'reports', 'charts']),
      },
      {
        label: t('titleBar.search.options.investments'),
        path: '/investments',
        icon: <InvestmentsIcon fontSize="small" />,
        keywords: getKeywords('investments', ['portfolio', 'stocks', 'holdings', 'wealth', 'assets']),
      },
      {
        label: t('titleBar.search.options.settings'),
        path: '/settings',
        icon: <SettingsIcon fontSize="small" />,
        keywords: getKeywords('settings', ['preferences', 'config', 'theme', 'language', 'profile']),
      },
      // Dashboard sub-sections
      {
        label: t('titleBar.search.options.transactions'),
        path: '/#transactions',
        icon: <CategoryIcon fontSize="small" />,
        keywords: getKeywords('transactions', ['history', 'payments', 'purchases', 'expenses', 'income']),
      },
      {
        label: t('titleBar.search.options.breakdown'),
        path: '/#breakdown',
        icon: <CategoryIcon fontSize="small" />,
        keywords: getKeywords('breakdown', ['categories', 'pie', 'chart', 'spending breakdown']),
      },
      {
        label: t('titleBar.search.options.vendors'),
        path: '/#vendors',
        icon: <AccountsIcon fontSize="small" />,
        keywords: getKeywords('vendors', ['merchants', 'stores', 'shops', 'where']),
      },
      // Settings sub-sections
      {
        label: t('titleBar.search.options.appearance'),
        path: '/settings#appearance',
        icon: <SettingsIcon fontSize="small" />,
        keywords: getKeywords('appearance', ['theme', 'dark', 'light', 'mode', 'colors']),
      },
      {
        label: t('titleBar.search.options.language'),
        path: '/settings#language',
        icon: <TranslateIcon fontSize="small" />,
        keywords: getKeywords('language', ['hebrew', 'english', 'french', 'locale']),
      },
      {
        label: t('titleBar.search.options.profile'),
        path: '/settings#profile',
        icon: <SettingsIcon fontSize="small" />,
        keywords: getKeywords('profile', ['account', 'user', 'name', 'email']),
      },
      {
        label: t('titleBar.search.options.privacy'),
        path: '/settings#privacy',
        icon: <SettingsIcon fontSize="small" />,
        keywords: getKeywords('privacy', ['mask', 'hide', 'amounts', 'security']),
      },
      // Investments sub-sections
      {
        label: t('titleBar.search.options.portfolio'),
        path: '/investments#portfolio',
        icon: <InvestmentsIcon fontSize="small" />,
        keywords: getKeywords('portfolio', ['total', 'value', 'performance']),
      },
      {
        label: t('titleBar.search.options.holdings'),
        path: '/investments#holdings',
        icon: <InvestmentsIcon fontSize="small" />,
        keywords: getKeywords('holdings', ['positions', 'shares', 'funds']),
      },
    ],
    [getKeywords, t],
  );

  const handleSearchSelect = (_event: React.SyntheticEvent, option: typeof searchOptions[0] | null) => {
    if (option) {
      const [path, hash] = option.path.split('#');
      navigate(path || '/');
      // If there's a hash, scroll to the element after navigation
      if (hash) {
        setTimeout(() => {
          const element = document.getElementById(hash);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
    }
  };

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
      const maximized = Boolean(state);
      setIsMaximized(maximized);

      // Toggle body classes so CSS can remove window gaps on restore/maximize
      const body = document?.body;
      if (body) {
        body.classList.toggle('window-maximized', maximized);
        body.classList.toggle('window-restored', !maximized);
        setWindowClassesApplied(true);
      }
    };

    let unsubscribe: (() => void) | undefined;

    if (window.electronAPI?.window?.isMaximized) {
      window.electronAPI.window
        .isMaximized()
        .then((state: boolean) => applyState(Boolean(state)))
        .catch(() => applyState(false));
    } else {
      applyState(false);
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
      if (windowClassesApplied) {
        document.body.classList.remove('window-maximized', 'window-restored');
      }
    };
  }, [windowClassesApplied]);

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
              <ListItemText>{t('titleBar.menu.items.new')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('file-open')}>
              <ListItemIcon><OpenIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.open')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('file-save')}>
              <ListItemIcon><SaveIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.save')}</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleMenuAction('file-exit')}>
              <ListItemIcon><ExitIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.exit')}</ListItemText>
            </MenuItem>
          </>
        );
      case 'edit':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('edit-undo')}>
              <ListItemIcon><UndoIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.undo')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('edit-redo')}>
              <ListItemIcon><RedoIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.redo')}</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleMenuAction('edit-cut')}>
              <ListItemIcon><CutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.cut')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('edit-copy')}>
              <ListItemIcon><CopyIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.copy')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('edit-paste')}>
              <ListItemIcon><PasteIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.paste')}</ListItemText>
            </MenuItem>
          </>
        );
      case 'view':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('view-fullscreen')}>
              <ListItemIcon><FullscreenIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.fullscreen')}</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleMenuAction('view-zoom-in')}>
              <ListItemIcon><ZoomInIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.zoomIn')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('view-zoom-out')}>
              <ListItemIcon><ZoomOutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.zoomOut')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('view-reset')}>
              <ListItemIcon><ResetIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.resetZoom')}</ListItemText>
            </MenuItem>
          </>
        );
      case 'go':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('go-dashboard')}>
              <ListItemIcon><DashboardIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.dashboard')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('go-analysis')}>
              <ListItemIcon><AnalyticsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.analysis')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('go-investments')}>
              <ListItemIcon><InvestmentsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.investments')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('go-settings')}>
              <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.settings')}</ListItemText>
            </MenuItem>
          </>
        );
      case 'help':
        return (
          <>
            <MenuItem onClick={() => handleMenuAction('help-docs')}>
              <ListItemIcon><DocsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.documentation')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('help-open-logs')}>
              <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.openLogs')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('help-export-diagnostics')}>
              <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.exportDiagnostics')}</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem disabled>
              <ListItemIcon><DiagnosticsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.supportTools')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleMenuAction('help-about')}>
              <ListItemIcon><AboutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('titleBar.menu.items.about')}</ListItemText>
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
          aria-label={t('titleBar.tooltips.openMenu')}
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
                {t('titleBar.menu.back')}
              </MenuItem>
              <Divider />
              {renderSubmenu(activeSubmenu)}
            </>
          ) : (
            <>
              <MenuItem onClick={() => setActiveSubmenu('file')} dense>
                <ListItemIcon><FileIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t('titleBar.menu.file')} />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('edit')} dense>
                <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t('titleBar.menu.edit')} />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('view')} dense>
                <ListItemIcon><ViewIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t('titleBar.menu.view')} />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('go')} dense>
                <ListItemIcon><GoIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t('titleBar.menu.go')} />
              </MenuItem>
              <MenuItem onClick={() => setActiveSubmenu('help')} dense>
                <ListItemIcon><HelpIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t('titleBar.menu.help')} />
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

      {/* Center section: Search Bar */}
      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', maxWidth: 400, mx: 2, WebkitAppRegion: 'no-drag' }}>
        <Autocomplete
          size="small"
          options={searchOptions}
          getOptionLabel={(option) => option.label}
          onChange={handleSearchSelect}
          filterOptions={(options, { inputValue }) => {
            const query = inputValue.toLowerCase();
            return options.filter((option) =>
              option.label.toLowerCase().includes(query) ||
              option.keywords.some((kw) => kw.toLowerCase().includes(query))
            );
          }}
          renderOption={(props, option) => (
            <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ color: 'primary.main', display: 'flex', alignItems: 'center' }}>
                {option.icon}
              </Box>
              <Typography variant="body2">{option.label}</Typography>
            </Box>
          )}
          PaperComponent={(props) => (
            <Paper {...props} sx={{ mt: 0.5, borderRadius: 2, boxShadow: 3 }} />
          )}
          sx={{ width: '100%' }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={t('titleBar.search.placeholder')}
              variant="outlined"
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                sx: {
                  height: 32,
                  fontSize: '0.85rem',
                  borderRadius: 2,
                  backgroundColor: theme.palette.mode === 'dark' 
                    ? 'rgba(255, 255, 255, 0.05)' 
                    : 'rgba(0, 0, 0, 0.04)',
                  '& fieldset': { border: 'none' },
                  '&:hover': {
                    backgroundColor: theme.palette.mode === 'dark' 
                      ? 'rgba(255, 255, 255, 0.08)' 
                      : 'rgba(0, 0, 0, 0.06)',
                  },
                  '&.Mui-focused': {
                    backgroundColor: theme.palette.mode === 'dark' 
                      ? 'rgba(255, 255, 255, 0.1)' 
                      : 'rgba(0, 0, 0, 0.08)',
                    boxShadow: `0 0 0 2px ${theme.palette.primary.main}40`,
                  },
                },
              }}
            />
          )}
          blurOnSelect
          clearOnBlur
          selectOnFocus
          handleHomeEndKeys
        />
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

        {/* Dark/Light Mode Toggle */}
        <Tooltip title={actualTheme === 'dark' ? t('titleBar.tooltips.lightMode') : t('titleBar.tooltips.darkMode')}>
          <IconButton
            size="small"
            onClick={() => setMode(actualTheme === 'dark' ? 'light' : 'dark')}
            sx={{
              width: 32,
              height: 32,
              color: 'text.secondary',
              '&:hover': {
                backgroundColor: 'action.hover',
                color: 'text.primary',
              },
            }}
          >
            {actualTheme === 'dark' ? (
              <LightModeIcon sx={{ fontSize: 20 }} />
            ) : (
              <DarkModeIcon sx={{ fontSize: 20 }} />
            )}
          </IconButton>
        </Tooltip>

        {/* Language Selector */}
        <Tooltip title={t('titleBar.tooltips.changeLanguage')}>
          <IconButton
            size="small"
            onClick={(e) => setLangMenuAnchor(e.currentTarget)}
            sx={{
              width: 32,
              height: 32,
              color: 'text.secondary',
              '&:hover': {
                backgroundColor: 'action.hover',
                color: 'text.primary',
              },
            }}
          >
            <TranslateIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={langMenuAnchor}
          open={Boolean(langMenuAnchor)}
          onClose={() => setLangMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            selected={locale === 'he'}
            onClick={() => { setLocale('he' as SupportedLocale); setLangMenuAnchor(null); }}
          >
            {languageLabels.he}
          </MenuItem>
          <MenuItem
            selected={locale === 'en'}
            onClick={() => { setLocale('en' as SupportedLocale); setLangMenuAnchor(null); }}
          >
            {languageLabels.en}
          </MenuItem>
          <MenuItem
            selected={locale === 'fr'}
            onClick={() => { setLocale('fr' as SupportedLocale); setLangMenuAnchor(null); }}
          >
            {languageLabels.fr}
          </MenuItem>
        </Menu>

        <SmartNotifications />

        {/* Window Controls - Hide on macOS as we use native traffic lights */}
        {!isMacOS && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1, borderLeft: 1, borderColor: 'divider', pl: 1.5 }}>
            <IconButton
              aria-label={t('titleBar.tooltips.minimizeWindow')}
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
              aria-label={isMaximized ? t('titleBar.tooltips.restoreWindow') : t('titleBar.tooltips.maximizeWindow')}
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
              aria-label={t('titleBar.tooltips.closeWindow')}
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
