import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Divider,
  ToggleButtonGroup,
  ToggleButton,
  Alert,
  useTheme,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Palette as ThemeIcon,
  LightMode as LightIcon,
  DarkMode as DarkIcon,
  SettingsBrightness as SystemIcon,
  VisibilityOff as MaskIcon,
  FormatSize as TextSizeIcon,
  SmartToy as ChatbotIcon,
  Security as SecurityIcon,
  BugReport as BugReportIcon,
  Translate as LanguageIcon,
} from '@mui/icons-material';
import { useThemeMode } from '@renderer/contexts/ThemeContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useChatbotPermissions } from '@app/contexts/ChatbotPermissionsContext';
import DataExportPanel from '../components/DataExportPanel';
import DiagnosticsPanel from '../components/DiagnosticsPanel';
import EnhancedProfileSection from '../components/EnhancedProfileSection';
import SecuritySettingsPanel from '../components/SecuritySettingsPanel';
import AutoSyncPanel from '../components/AutoSyncPanel';
import { useTelemetry } from '@app/contexts/TelemetryContext';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';
import type { SupportedLocale } from '@renderer/i18n';
import { useTranslation } from 'react-i18next';

const SettingsPage: React.FC = () => {
  const { t: tSettings } = useTranslation('translation', { keyPrefix: 'settings' });
  const { t: tCommon } = useTranslation('translation', { keyPrefix: 'common' });
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
  } = useChatbotPermissions();
  const {
    telemetryEnabled,
    loading: telemetryLoading,
    supported: telemetrySupported,
    error: telemetryError,
    setTelemetryEnabled,
  } = useTelemetry();

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

  const handleLanguageChange = (newLocale: SupportedLocale | null) => {
    if (newLocale) {
      setLocale(newLocale);
    }
  };

  return (
    <Box sx={{ pb: 10, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        {tSettings('title')}
      </Typography>

      {/* Enhanced Profile Settings */}
      <Box id="profile">
        <EnhancedProfileSection />
      </Box>

      {/* Theme Settings */}
      <Paper id="appearance" sx={{ p: 3 }}>
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
          onChange={(e, newMode) => {
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
          onChange={(e, newSize) => {
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

      {/* Language */}
      <Paper id="language" sx={{ p: 3, mb: 3 }}>
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
          onChange={(e, newLocale) => handleLanguageChange(newLocale as SupportedLocale | null)}
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

      <Divider sx={{ my: 4 }} />

      {/* Auto Sync */}
      <Box sx={{ mb: 4 }}>
        <AutoSyncPanel />
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* Data Export */}
      <Box sx={{ mb: 4 }}>
        <DataExportPanel />
      </Box>

      <Divider sx={{ my: 4 }} />

      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <BugReportIcon color="primary" />
          <Typography variant="h6">{tSettings('diagnostics.title')}</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {tSettings('diagnostics.description')}
        </Typography>

        {!telemetrySupported && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {tSettings('diagnostics.notSupported')}
          </Alert>
        )}

        {telemetryError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {telemetryError}
          </Alert>
        )}

        <FormControlLabel
          control={
            <Switch
              checked={telemetryEnabled}
              onChange={(event) => {
                setTelemetryEnabled(event.target.checked).catch(() => {
                  /* errors are surfaced via telemetryError */
                });
              }}
              disabled={!telemetrySupported || telemetryLoading}
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

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          {tSettings('diagnostics.exportHint')}
        </Typography>
      </Paper>

      {/* AI Chatbot Settings */}
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

      <Divider sx={{ my: 4 }} />

      {/* Privacy Settings */}
      <Paper id="privacy" sx={{ p: 3, mb: 3 }}>
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

      {/* Security Settings */}
      <SecuritySettingsPanel />

      <Divider sx={{ my: 4 }} />

      <DiagnosticsPanel />

      <Divider sx={{ my: 4 }} />

      {/* App Info */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          About ShekelSync
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Version: 2.0.0 (Personal Intelligence Edition)
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
  );
};

export default SettingsPage;
