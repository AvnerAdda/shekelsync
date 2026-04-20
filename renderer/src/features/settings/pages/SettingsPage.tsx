import React from 'react';
import {
  Alert,
  alpha,
  Box,
  Divider,
  FormControlLabel,
  Paper,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import {
  BugReport as BugReportIcon,
  DarkMode as DarkIcon,
  FormatSize as TextSizeIcon,
  LightMode as LightIcon,
  Palette as ThemeIcon,
  Person as ProfileTabIcon,
  Security as SecurityIcon,
  SettingsBrightness as SystemIcon,
  Sync as SyncTabIcon,
  SmartToy as ChatbotIcon,
  Translate as LanguageIcon,
  VisibilityOff as MaskIcon,
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeMode } from '@renderer/contexts/ThemeContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useChatbotPermissions, MODEL_TIERS } from '@app/contexts/ChatbotPermissionsContext';
import type { ModelTier } from '@app/contexts/ChatbotPermissionsContext';
import { useTelemetry } from '@app/contexts/TelemetryContext';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';
import type { SupportedLocale } from '@renderer/i18n';
import { useTranslation } from 'react-i18next';
import AutoSyncPanel from '../components/AutoSyncPanel';
import DataExportPanel from '../components/DataExportPanel';
import DiagnosticsPanel from '../components/DiagnosticsPanel';
import EnhancedProfileSection from '../components/EnhancedProfileSection';
import SecuritySettingsPanel from '../components/SecuritySettingsPanel';
import TelegramPanel from '../components/TelegramPanel';
import {
  DEFAULT_SETTINGS_TAB_ID,
  getCanonicalSettingsHash,
  normalizeSettingsHash,
  resolveSettingsSectionIdFromHash,
  resolveSettingsTabIdFromHash,
  SETTINGS_TAB_INDEX_BY_ID,
  SETTINGS_TABS,
  type SettingsTabId,
} from './settings-tabs';

const SECTION_SCROLL_MARGIN = 112;

type SettingsTabPanelProps = {
  children: React.ReactNode;
  index: number;
  tabId: SettingsTabId;
  value: number;
};

const SettingsTabPanel = ({ children, index, tabId, value }: SettingsTabPanelProps) => (
  <Box
    role="tabpanel"
    hidden={value !== index}
    id={`settings-tabpanel-${tabId}`}
    aria-labelledby={`settings-tab-${tabId}`}
    data-testid={`settings-tabpanel-${tabId}`}
    sx={{ pt: 3 }}
  >
    {children}
  </Box>
);

const SettingsPage: React.FC = () => {
  const { t: tSettings } = useTranslation('translation', { keyPrefix: 'settings' });
  const { t: tCommon } = useTranslation('translation', { keyPrefix: 'common' });
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, setLocale, detectedLocale } = useLocaleSettings();
  const { mode, setMode, fontSize, setFontSize } = useThemeMode();
  const theme = useTheme();
  const { maskAmounts, setMaskAmounts } = useFinancePrivacy();
  const {
    chatbotEnabled,
    setChatbotEnabled,
    allowTransactionAccess,
    setAllowTransactionAccess,
    allowCategoryAccess,
    setAllowCategoryAccess,
    allowAnalyticsAccess,
    setAllowAnalyticsAccess,
    openAiApiKey,
    setOpenAiApiKey,
    allowLongAnswers,
    setAllowLongAnswers,
    allowLongRequests,
    setAllowLongRequests,
    chatModelTier,
    setChatModelTier,
  } = useChatbotPermissions();
  const {
    telemetryEnabled,
    loading: telemetryLoading,
    supported: telemetrySupported,
    error: telemetryError,
    setTelemetryEnabled,
  } = useTelemetry();
  const [appVersion, setAppVersion] = React.useState('unknown');

  const activeTabId = resolveSettingsTabIdFromHash(location.hash) ?? DEFAULT_SETTINGS_TAB_ID;
  const activeTabIndex = SETTINGS_TAB_INDEX_BY_ID[activeTabId];

  React.useEffect(() => {
    let active = true;

    const loadAppVersion = async () => {
      try {
        const rawVersion = await window.electronAPI?.app?.getVersion?.();
        const normalizedVersion = typeof rawVersion === 'string' && rawVersion.trim().length > 0
          ? rawVersion.trim()
          : 'unknown';

        if (active) {
          setAppVersion(normalizedVersion);
        }
      } catch {
        if (active) {
          setAppVersion('unknown');
        }
      }
    };

    void loadAppVersion();
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    const settingsBridge = window.electronAPI?.settings;
    if (!settingsBridge?.update) {
      return;
    }

    settingsBridge.update({ appLocale: locale }).catch(() => {
      // Locale persistence already lives in renderer localStorage; this sync is best-effort for background features.
    });
  }, [locale]);

  React.useEffect(() => {
    const targetSectionId = resolveSettingsSectionIdFromHash(location.hash, activeTabId);
    if (!targetSectionId || typeof document === 'undefined') {
      return;
    }

    const scrollToSection = () => {
      const target = document.getElementById(targetSectionId);
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start' });
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(scrollToSection);
      return () => window.cancelAnimationFrame(frame);
    }

    scrollToSection();
    return undefined;
  }, [activeTabId, location.hash]);

  const languageOptions = [
    { code: 'he', label: tCommon('languages.he') },
    { code: 'en', label: tCommon('languages.en') },
    { code: 'fr', label: tCommon('languages.fr') },
  ] as const;

  const themeLabelMap: Record<'light' | 'dark', string> = {
    light: tSettings('appearance.light'),
    dark: tSettings('appearance.dark'),
  };

  const fontSizeLabelMap: Record<typeof fontSize, string> = {
    small: tSettings('textSize.small'),
    medium: tSettings('textSize.medium'),
    large: tSettings('textSize.large'),
  };

  const detectedLanguageLabel = languageOptions.find((lang) => lang.code === detectedLocale)?.label ?? tCommon('language');
  const appTagVersion = appVersion !== 'unknown' && !appVersion.startsWith('v')
    ? `v${appVersion}`
    : appVersion;

  const handleLanguageChange = (newLocale: SupportedLocale | null) => {
    if (newLocale) {
      setLocale(newLocale);
    }
  };

  const handleTabChange = (_event: React.SyntheticEvent, nextTabIndex: number) => {
    const nextTab = SETTINGS_TABS[nextTabIndex];
    if (!nextTab) {
      return;
    }

    navigate(`${location.pathname}${location.search}#${getCanonicalSettingsHash(nextTab.id)}`);
  };

  const settingsTabs = [
    { id: 'profile' as const, icon: <ProfileTabIcon sx={{ fontSize: 20 }} />, label: tSettings('tabs.profile') },
    { id: 'appearance' as const, icon: <ThemeIcon sx={{ fontSize: 20 }} />, label: tSettings('tabs.appearance') },
    { id: 'sync' as const, icon: <SyncTabIcon sx={{ fontSize: 20 }} />, label: tSettings('tabs.sync') },
    { id: 'privacy' as const, icon: <SecurityIcon sx={{ fontSize: 20 }} />, label: tSettings('tabs.privacySecurity') },
    { id: 'system' as const, icon: <BugReportIcon sx={{ fontSize: 20 }} />, label: tSettings('tabs.system') },
  ];

  return (
    <Box sx={{ pb: 10, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        {tSettings('title')}
      </Typography>

      <Box
        role="tablist"
        aria-label={tSettings('title')}
        sx={{
          mb: 3,
          p: 0.75,
          borderRadius: '16px',
          bgcolor: (currentTheme) => alpha(currentTheme.palette.background.paper, 0.5),
          backdropFilter: 'blur(24px)',
          border: '1px solid',
          borderColor: (currentTheme) => alpha(currentTheme.palette.divider, 0.08),
          boxShadow: (currentTheme) => `0 4px 24px 0 ${alpha(currentTheme.palette.common.black, 0.04)}, 0 1px 2px 0 ${alpha(currentTheme.palette.common.black, 0.03)}`,
          display: 'flex',
          gap: 0.5,
          flexWrap: 'wrap',
        }}
      >
        {settingsTabs.map((tab) => {
          const tabIndex = SETTINGS_TAB_INDEX_BY_ID[tab.id];
          const isSelected = activeTabId === tab.id;

          return (
            <Box
              key={tab.id}
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-controls={`settings-tabpanel-${tab.id}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={(event) => {
                if (isSelected && normalizeSettingsHash(location.hash) !== getCanonicalSettingsHash(tab.id)) {
                  navigate(`${location.pathname}${location.search}#${getCanonicalSettingsHash(tab.id)}`);
                  return;
                }

                handleTabChange(event, tabIndex);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (isSelected && normalizeSettingsHash(location.hash) !== getCanonicalSettingsHash(tab.id)) {
                    navigate(`${location.pathname}${location.search}#${getCanonicalSettingsHash(tab.id)}`);
                    return;
                  }

                  handleTabChange(event, tabIndex);
                }
              }}
              sx={{
                flex: 1,
                minWidth: 'fit-content',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                px: 2,
                py: 1.25,
                borderRadius: '12px',
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: '0.875rem',
                fontWeight: isSelected ? 700 : 500,
                letterSpacing: '-0.01em',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                color: isSelected
                  ? theme.palette.primary.contrastText
                  : theme.palette.text.secondary,
                background: isSelected
                  ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`
                  : 'transparent',
                boxShadow: isSelected
                  ? `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}, 0 1px 3px ${alpha(theme.palette.primary.main, 0.2)}`
                  : 'none',
                '&:hover': isSelected
                  ? {}
                  : {
                      bgcolor: alpha(theme.palette.primary.main, 0.08),
                      color: theme.palette.text.primary,
                    },
                '&:active': {
                  transform: 'scale(0.97)',
                },
                '& .MuiSvgIcon-root': {
                  opacity: isSelected ? 1 : 0.6,
                  transition: 'opacity 0.2s',
                },
              }}
            >
              {tab.icon}
              {tab.label}
            </Box>
          );
        })}
      </Box>

      <SettingsTabPanel value={activeTabIndex} index={SETTINGS_TAB_INDEX_BY_ID.profile} tabId="profile">
        <Box id="profile" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}>
          <EnhancedProfileSection />
        </Box>
      </SettingsTabPanel>

      <SettingsTabPanel value={activeTabIndex} index={SETTINGS_TAB_INDEX_BY_ID.appearance} tabId="appearance">
        <Box id="appearance" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
              <ThemeIcon color="primary" />
              <Typography variant="h6">{tSettings('appearance.title')}</Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tSettings('appearance.description')}
            </Typography>

            <ToggleButtonGroup
              value={mode}
              exclusive
              onChange={(_event, newMode) => {
                if (newMode !== null) {
                  setMode(newMode);
                }
              }}
              fullWidth
              sx={{ mb: 2 }}
            >
              <ToggleButton value="light">
                <LightIcon sx={{ mr: 1 }} />
                {tSettings('appearance.light')}
              </ToggleButton>
              <ToggleButton value="system">
                <SystemIcon sx={{ mr: 1 }} />
                {tSettings('appearance.system')}
              </ToggleButton>
              <ToggleButton value="dark">
                <DarkIcon sx={{ mr: 1 }} />
                {tSettings('appearance.dark')}
              </ToggleButton>
            </ToggleButtonGroup>

            <Alert severity="info">
              {tSettings('appearance.currentTheme', { theme: themeLabelMap[theme.palette.mode] })}
              {mode === 'system' && ` ${tSettings('appearance.systemFollow')}`}
            </Alert>

            <Divider sx={{ my: 3 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TextSizeIcon color="primary" />
              <Typography variant="h6">{tSettings('textSize.title')}</Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tSettings('textSize.description')}
            </Typography>

            <ToggleButtonGroup
              value={fontSize}
              exclusive
              onChange={(_event, newSize) => {
                if (newSize !== null) {
                  setFontSize(newSize);
                }
              }}
              fullWidth
              sx={{ mb: 2 }}
            >
              <ToggleButton value="small">
                {tSettings('textSize.small')}
              </ToggleButton>
              <ToggleButton value="medium">
                {tSettings('textSize.medium')}
              </ToggleButton>
              <ToggleButton value="large">
                {tSettings('textSize.large')}
              </ToggleButton>
            </ToggleButtonGroup>

            <Alert severity="info">
              {tSettings('textSize.current', { size: fontSizeLabelMap[fontSize] })}
              {fontSize === 'small' && ` ${tSettings('textSize.hints.small')}`}
              {fontSize === 'medium' && ` ${tSettings('textSize.hints.medium')}`}
              {fontSize === 'large' && ` ${tSettings('textSize.hints.large')}`}
            </Alert>
          </Paper>
        </Box>

        <Box id="language" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN, mt: 3 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <LanguageIcon color="primary" />
              <Typography variant="h6">{tSettings('language.title')}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tSettings('language.description')}
            </Typography>
            <ToggleButtonGroup
              value={locale}
              exclusive
              onChange={(_event, newLocale) => handleLanguageChange(newLocale as SupportedLocale | null)}
              fullWidth
              sx={{ mb: 2 }}
            >
              {languageOptions.map((lang) => (
                <ToggleButton key={lang.code} value={lang.code}>
                  {lang.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Alert severity="info">
              {tSettings('language.detectedLabel', { language: detectedLanguageLabel })}
            </Alert>
          </Paper>
        </Box>
      </SettingsTabPanel>

      <SettingsTabPanel value={activeTabIndex} index={SETTINGS_TAB_INDEX_BY_ID.sync} tabId="sync">
        <Box id="sync" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}>
          <Box sx={{ mb: 4 }}>
            <AutoSyncPanel />
          </Box>

          <Divider sx={{ my: 4 }} />

          <Box id="telegram" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN, mb: 4 }}>
            <TelegramPanel />
          </Box>
        </Box>
      </SettingsTabPanel>

      <SettingsTabPanel value={activeTabIndex} index={SETTINGS_TAB_INDEX_BY_ID.privacy} tabId="privacy">
        <Box id="chatbot" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
              <ChatbotIcon color="primary" />
              <Typography variant="h6">{tSettings('chatbot.title')}</Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {tSettings('chatbot.description')}
            </Typography>

            <Box sx={{ mb: 3 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={chatbotEnabled}
                    onChange={(event) => setChatbotEnabled(event.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight="bold">
                      {tSettings('chatbot.enable')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tSettings('chatbot.enableHint')}
                    </Typography>
                  </Box>
                }
              />
            </Box>

            <TextField
              fullWidth
              type="password"
              label={tSettings('chatbot.openAiApiKeyLabel')}
              placeholder="sk-..."
              value={openAiApiKey}
              onChange={(event) => setOpenAiApiKey(event.target.value)}
              helperText={tSettings('chatbot.openAiApiKeyHint')}
              autoComplete="off"
              sx={{ mb: 1 }}
            />

            {chatbotEnabled && !openAiApiKey.trim() && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  {tSettings('chatbot.openAiApiKeyRequired')}
                </Typography>
              </Alert>
            )}

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>
              {tSettings('chatbot.modelTierLabel')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              {tSettings('chatbot.modelTierHint')}
            </Typography>

            <ToggleButtonGroup
              value={chatModelTier}
              exclusive
              onChange={(_event, value: ModelTier | null) => {
                if (value) {
                  setChatModelTier(value);
                }
              }}
              size="small"
              disabled={!chatbotEnabled}
              sx={{ mb: 3 }}
            >
              {(Object.entries(MODEL_TIERS) as [ModelTier, { model: string; label: string }][]).map(([tier, { label }]) => (
                <ToggleButton key={tier} value={tier} sx={{ px: 3 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="body2" fontWeight="bold">{label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tSettings(`chatbot.modelTiers.${tier}`)}
                    </Typography>
                  </Box>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 2 }}>
              {tSettings('chatbot.permissionsTitle')}
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tSettings('chatbot.permissionsDescription')}
              {!chatbotEnabled && ` ${tSettings('chatbot.permissionsEnableFirst')}`}
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={allowTransactionAccess}
                    onChange={(event) => setAllowTransactionAccess(event.target.checked)}
                    color="primary"
                    disabled={!chatbotEnabled}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight="bold">
                      {tSettings('chatbot.permissions.transaction')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tSettings('chatbot.permissions.transactionHint')}
                    </Typography>
                  </Box>
                }
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={allowCategoryAccess}
                    onChange={(event) => setAllowCategoryAccess(event.target.checked)}
                    color="primary"
                    disabled={!chatbotEnabled}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight="bold">
                      {tSettings('chatbot.permissions.category')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tSettings('chatbot.permissions.categoryHint')}
                    </Typography>
                  </Box>
                }
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={allowAnalyticsAccess}
                    onChange={(event) => setAllowAnalyticsAccess(event.target.checked)}
                    color="primary"
                    disabled={!chatbotEnabled}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight="bold">
                      {tSettings('chatbot.permissions.analytics')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tSettings('chatbot.permissions.analyticsHint')}
                    </Typography>
                  </Box>
                }
              />
            </Box>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 2 }}>
              {tSettings('chatbot.responseSettingsTitle')}
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={allowLongAnswers}
                    onChange={(event) => setAllowLongAnswers(event.target.checked)}
                    color="primary"
                    disabled={!chatbotEnabled}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight="bold">
                      {tSettings('chatbot.responseSettings.longAnswers')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tSettings('chatbot.responseSettings.longAnswersHint')}
                    </Typography>
                  </Box>
                }
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={allowLongRequests}
                    onChange={(event) => setAllowLongRequests(event.target.checked)}
                    color="primary"
                    disabled={!chatbotEnabled}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight="bold">
                      {tSettings('chatbot.responseSettings.longRequests')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {tSettings('chatbot.responseSettings.longRequestsHint')}
                    </Typography>
                  </Box>
                }
              />
            </Box>

            <Alert severity="info" icon={<SecurityIcon />}>
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                {tSettings('chatbot.privacyTitle')}
              </Typography>
              <Typography variant="caption">
                {tSettings('chatbot.privacyBullet1')}<br />
                {tSettings('chatbot.privacyBullet2')}<br />
                {tSettings('chatbot.privacyBullet3')}<br />
                {tSettings('chatbot.privacyBullet4')}
              </Typography>
            </Alert>

            {chatbotEnabled && !allowTransactionAccess && !allowCategoryAccess && !allowAnalyticsAccess && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  {tSettings('chatbot.noPermissions')}
                </Typography>
              </Alert>
            )}
          </Paper>
        </Box>

        <Divider sx={{ my: 4 }} />

        <Paper id="privacy" sx={{ p: 3, mb: 3, scrollMarginTop: SECTION_SCROLL_MARGIN }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <MaskIcon color="primary" />
            <Typography variant="h6">{tSettings('privacy.title')}</Typography>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tSettings('privacy.description')}
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={maskAmounts}
                onChange={(event) => setMaskAmounts(event.target.checked)}
                color="primary"
              />
            }
            label={maskAmounts ? 'Masking enabled' : 'Masking disabled'}
          />

          <Alert severity="info" sx={{ mt: 2 }}>
            {maskAmounts
              ? tSettings('privacy.maskOn')
              : tSettings('privacy.maskOff')}
          </Alert>
        </Paper>

        <Divider sx={{ my: 4 }} />

        <SecuritySettingsPanel />
      </SettingsTabPanel>

      <SettingsTabPanel value={activeTabIndex} index={SETTINGS_TAB_INDEX_BY_ID.system} tabId="system">
        <Box id="system" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}>
          <Box id="export" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN, mb: 4 }}>
            <DataExportPanel />
          </Box>

          <Divider sx={{ my: 4 }} />

          <Box id="diagnostics" sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}>
            <Paper sx={{ p: 3, mb: 4 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <BugReportIcon color="primary" />
                <Typography variant="h6">{tSettings('diagnostics.title')}</Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {tSettings('diagnostics.description')}
              </Typography>

              {!telemetryLoading && !telemetrySupported && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {tSettings('diagnostics.notSupported')}
                </Alert>
              )}

              {telemetryError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {telemetryError}
                </Alert>
              )}

              {telemetrySupported && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={telemetryEnabled}
                      onChange={(event) => {
                        setTelemetryEnabled(event.target.checked).catch(() => {
                          /* errors are surfaced via telemetryError */
                        });
                      }}
                      disabled={telemetryLoading}
                      color="primary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" fontWeight="bold">
                        {tSettings('diagnostics.toggleLabel')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {telemetryEnabled
                          ? tSettings('diagnostics.toggleOn')
                          : tSettings('diagnostics.toggleOff')}
                      </Typography>
                    </Box>
                  }
                />
              )}

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                {tSettings('diagnostics.exportHint')}
              </Typography>
            </Paper>
          </Box>

          <DiagnosticsPanel />

          <Divider sx={{ my: 4 }} />

          <Paper id="about" sx={{ p: 3, scrollMarginTop: SECTION_SCROLL_MARGIN }}>
            <Typography variant="h6" gutterBottom>
              About ShekelSync
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Version: {appTagVersion} (Personal Intelligence Edition)
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              ShekelSync is a personal finance tracking application for Israeli bank accounts and credit cards.
              It automatically scrapes transactions, categorizes expenses, and provides AI-powered analytics
              to help you manage your finances better.
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              <strong>New Features:</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary" component="ul">
              <li>🧠 Personal Financial Intelligence with 9 insight categories</li>
              <li>💬 AI-powered chatbot for financial questions</li>
              <li>📊 Behavioral analytics (impulse score, payday effect, FOMO score)</li>
              <li>🔮 Predictive analytics and savings recommendations</li>
              <li>📈 Peer comparisons based on age, income, and location</li>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Made with ❤️ for better financial sync
            </Typography>
          </Paper>
        </Box>
      </SettingsTabPanel>
    </Box>
  );
};

export default SettingsPage;
