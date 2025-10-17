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

interface UserProfile {
  id?: number;
  username: string;
  marital_status: string;
  age: number | null;
  occupation: string;
  monthly_income: number | null;
  family_status: string;
  location: string;
  industry: string;
}

const SettingsPage: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile>({
    username: '',
    marital_status: 'Single',
    age: null,
    occupation: '',
    monthly_income: null,
    family_status: '',
    location: '',
    industry: '',
  });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const { mode, setMode } = useThemeMode();
  const theme = useTheme();
  const { maskAmounts, setMaskAmounts } = useFinancePrivacy();

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await fetch('/api/profile');
      const data = await response.json();
      setProfile({
        username: data.username || '',
        marital_status: data.marital_status || 'Single',
        age: data.age || null,
        occupation: data.occupation || '',
        monthly_income: data.monthly_income || null,
        family_status: data.family_status || '',
        location: data.location || '',
        industry: data.industry || '',
      });
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const handleSaveProfile = async () => {
    setSaveError('');
    setSaveSuccess(false);

    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });

      if (!response.ok) {
        throw new Error('Failed to save profile');
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving profile:', error);
      setSaveError('Failed to save profile. Please try again.');
    }
  };

  return (
    <Box sx={{ pb: 10, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Settings
      </Typography>

      {/* Profile Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <PersonIcon color="primary" />
          <Typography variant="h6">Profile Information</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Complete your profile to get personalized financial insights and AI-powered comparisons.
        </Typography>

        <Grid container spacing={3}>
          {/* Basic Information */}
          <Grid item xs={12} md={6}>
            <TextField
              label="Username"
              fullWidth
              value={profile.username}
              onChange={(e) =>
                setProfile({ ...profile, username: e.target.value })
              }
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField
              label="Age"
              type="number"
              fullWidth
              value={profile.age || ''}
              onChange={(e) =>
                setProfile({ ...profile, age: e.target.value ? parseInt(e.target.value) : null })
              }
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <AgeIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              helperText="Used for age-group comparisons"
            />
          </Grid>

          {/* Marital & Family Status */}
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Marital Status</InputLabel>
              <Select
                value={profile.marital_status}
                label="Marital Status"
                onChange={(e) =>
                  setProfile({ ...profile, marital_status: e.target.value })
                }
              >
                <MenuItem value="Single">Single</MenuItem>
                <MenuItem value="Married">Married</MenuItem>
                <MenuItem value="Divorced">Divorced</MenuItem>
                <MenuItem value="Widowed">Widowed</MenuItem>
                <MenuItem value="Prefer not to say">Prefer not to say</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Family Status</InputLabel>
              <Select
                value={profile.family_status}
                label="Family Status"
                onChange={(e) =>
                  setProfile({ ...profile, family_status: e.target.value })
                }
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="No children">No children</MenuItem>
                <MenuItem value="1 child">1 child</MenuItem>
                <MenuItem value="2 children">2 children</MenuItem>
                <MenuItem value="3+ children">3+ children</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Work Information */}
          <Grid item xs={12} md={6}>
            <TextField
              label="Occupation"
              fullWidth
              value={profile.occupation}
              onChange={(e) =>
                setProfile({ ...profile, occupation: e.target.value })
              }
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <WorkIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              placeholder="e.g., Software Engineer"
              helperText="Used for occupation-based comparisons"
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Industry</InputLabel>
              <Select
                value={profile.industry}
                label="Industry"
                onChange={(e) =>
                  setProfile({ ...profile, industry: e.target.value })
                }
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="Tech">Technology</MenuItem>
                <MenuItem value="Finance">Finance</MenuItem>
                <MenuItem value="Healthcare">Healthcare</MenuItem>
                <MenuItem value="Education">Education</MenuItem>
                <MenuItem value="Retail">Retail</MenuItem>
                <MenuItem value="Manufacturing">Manufacturing</MenuItem>
                <MenuItem value="Government">Government</MenuItem>
                <MenuItem value="Self-employed">Self-employed</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Financial & Location */}
          <Grid item xs={12} md={6}>
            <TextField
              label="Monthly Income"
              type="number"
              fullWidth
              value={profile.monthly_income || ''}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  monthly_income: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    ₪
                  </InputAdornment>
                ),
              }}
              placeholder="15000"
              helperText="Gross monthly income (used for savings rate calculations)"
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={profile.location}
                label="Location"
                onChange={(e) =>
                  setProfile({ ...profile, location: e.target.value })
                }
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="Tel Aviv">Tel Aviv</MenuItem>
                <MenuItem value="Jerusalem">Jerusalem</MenuItem>
                <MenuItem value="Haifa">Haifa</MenuItem>
                <MenuItem value="Beer Sheva">Beer Sheva</MenuItem>
                <MenuItem value="Netanya">Netanya</MenuItem>
                <MenuItem value="Rishon LeZion">Rishon LeZion</MenuItem>
                <MenuItem value="Petah Tikva">Petah Tikva</MenuItem>
                <MenuItem value="Ashdod">Ashdod</MenuItem>
                <MenuItem value="Herzliya">Herzliya</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {/* Privacy Notice */}
        <Alert severity="info" sx={{ mt: 3, mb: 2 }}>
          <Typography variant="body2">
            🔒 <strong>Your privacy matters:</strong> All profile data is stored locally and used only for personalized
            insights. This information helps the AI chatbot and analytics provide better comparisons and recommendations.
          </Typography>
        </Alert>

        {/* Save Button */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<SaveIcon />}
            onClick={handleSaveProfile}
          >
            Save Profile
          </Button>
        </Box>

        {/* Success/Error Messages */}
        {saveSuccess && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Profile updated successfully! Your personalized insights will now be more accurate.
          </Alert>
        )}

        {saveError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {saveError}
          </Alert>
        )}
      </Paper>

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
