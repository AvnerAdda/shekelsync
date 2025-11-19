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
} from '@mui/icons-material';
import { useThemeMode } from '@app/contexts/ThemeContext';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useChatbotPermissions } from '@app/contexts/ChatbotPermissionsContext';
import DataExportPanel from '../components/DataExportPanel';
import DiagnosticsPanel from '../components/DiagnosticsPanel';
import EnhancedProfileSection from '../components/EnhancedProfileSection';
import { useTelemetry } from '@app/contexts/TelemetryContext';

const SettingsPage: React.FC = () => {
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

  return (
    <Box sx={{ pb: 10, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Settings
      </Typography>

      {/* Enhanced Profile Settings */}
      <EnhancedProfileSection />

      {/* Theme Settings */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <ThemeIcon color="primary" />
          <Typography variant="h6">Appearance</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose your preferred theme. System will automatically match your device&apos;s theme.
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
            Light
          </ToggleButton>
          <ToggleButton value="system">
            <SystemIcon sx={{ mr: 1 }} />
            System
          </ToggleButton>
          <ToggleButton value="dark">
            <DarkIcon sx={{ mr: 1 }} />
            Dark
          </ToggleButton>
        </ToggleButtonGroup>

        <Alert severity="info">
          Current theme: <strong>{theme.palette.mode}</strong>
          {mode === 'system' && ' (following system preference)'}
        </Alert>

        <Divider sx={{ my: 3 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <TextSizeIcon color="primary" />
          <Typography variant="h6">Text Size</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Adjust the text size throughout the application for better readability.
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
            Small
          </ToggleButton>
          <ToggleButton value="medium">
            Medium
          </ToggleButton>
          <ToggleButton value="large">
            Large
          </ToggleButton>
        </ToggleButtonGroup>

        <Alert severity="info">
          Current text size: <strong>{fontSize.charAt(0).toUpperCase() + fontSize.slice(1)}</strong>
          {fontSize === 'small' && ' (90% of default)'}
          {fontSize === 'medium' && ' (100% - default)'}
          {fontSize === 'large' && ' (110% of default)'}
        </Alert>
      </Paper>

      <Divider sx={{ my: 4 }} />

      {/* Data Export */}
      <Box sx={{ mb: 4 }}>
        <DataExportPanel />
      </Box>

      <Divider sx={{ my: 4 }} />

      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <BugReportIcon color="primary" />
          <Typography variant="h6">Diagnostics & Crash Reports</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Share anonymized crash reports to help us resolve stability issues faster. Sensitive data such as account
          credentials and personal identifiers are never included in crash payloads.
        </Typography>

        {!telemetrySupported && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Crash reporting is only available in the desktop app.
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
                Send crash reports automatically
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {telemetryEnabled
                  ? 'Crash details will be securely uploaded to our monitoring service.'
                  : 'Crash details remain on your device until you opt in.'}
              </Typography>
            </Box>
          }
        />

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          You can always export logs manually from the Diagnostics panel below.
        </Typography>
      </Paper>

      {/* AI Chatbot Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <ChatbotIcon color="primary" />
          <Typography variant="h6">AI Chatbot Settings</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Configure your AI financial assistant and control what data it can access.
          The chatbot never has access to your bank credentials or passwords.
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
                  Enable AI Chatbot
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Show the chatbot button and allow AI assistant interactions
                </Typography>
              </Box>
            }
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 2 }}>
          Data Access Permissions
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Grant the chatbot access to specific data to enable personalized insights.
          {!chatbotEnabled && ' (Enable chatbot first to configure permissions)'}
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
                  Transaction Data
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Allow access to transaction history, amounts, dates, and descriptions
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
                  Category Data
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Allow access to spending categories and categorization rules
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
                  Analytics & Insights
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Allow access to behavioral analytics, trends, and spending patterns
                </Typography>
              </Box>
            }
          />
        </Box>

        <Alert severity="info" icon={<SecurityIcon />}>
          <Typography variant="body2" fontWeight="bold" gutterBottom>
            Your Privacy is Protected
          </Typography>
          <Typography variant="caption">
            • The chatbot NEVER has access to your bank credentials or passwords<br />
            • All permissions can be revoked at any time<br />
            • Data is only used to answer your questions and provide insights<br />
            • No data is shared with third parties
          </Typography>
        </Alert>

        {chatbotEnabled && !allowTransactionAccess && !allowCategoryAccess && !allowAnalyticsAccess && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <Typography variant="body2">
              The chatbot is enabled but has no data access permissions.
              Grant at least one permission for the chatbot to provide useful insights.
            </Typography>
          </Alert>
        )}
      </Paper>

      <Divider sx={{ my: 4 }} />

      {/* Privacy Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <MaskIcon color="primary" />
          <Typography variant="h6">Privacy Controls</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Toggle amount masking to obscure all financial figures across the application. Useful when sharing your screen or working in public spaces.
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
            ? 'All currency amounts are currently replaced with asterisks.'
            : 'Currency amounts will display their full values until masking is enabled.'}
        </Alert>
      </Paper>

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
