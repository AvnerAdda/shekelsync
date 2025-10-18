import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Divider,
  ToggleButtonGroup,
  ToggleButton,
  Alert,
  useTheme,
  Grid,
  InputAdornment,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Person as PersonIcon,
  Palette as ThemeIcon,
  Save as SaveIcon,
  LightMode as LightIcon,
  DarkMode as DarkIcon,
  SettingsBrightness as SystemIcon,
  Work as WorkIcon,
  LocationOn as LocationIcon,
  Cake as AgeIcon,
  AttachMoney as MoneyIcon,
  VisibilityOff as MaskIcon,
} from '@mui/icons-material';
import { useThemeMode } from '../contexts/ThemeContext';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import DataExportPanel from './DataExportPanel';
import EnhancedProfileSection from './EnhancedProfileSection';

const SettingsPage: React.FC = () => {
  const { mode, setMode } = useThemeMode();
  const theme = useTheme();
  const { maskAmounts, setMaskAmounts } = useFinancePrivacy();

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
          Choose your preferred theme. System will automatically match your device's theme.
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
      </Paper>

      <Divider sx={{ my: 4 }} />

      {/* Data Export */}
      <Box sx={{ mb: 4 }}>
        <DataExportPanel />
      </Box>

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
