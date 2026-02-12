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
  Grid,
  InputAdornment,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  IconButton,
  Card,
  CardContent,
  Chip,
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  Person as PersonIcon,
  Save as SaveIcon,
  Work as WorkIcon,
  Cake as AgeIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ChildCare as ChildIcon,
  Favorite as SpouseIcon,
} from '@mui/icons-material';
import {
  ChildProfile,
  EnhancedUserProfile,
  ProfileData,
  SpouseProfile,
  normalizeChildren,
  normalizeProfile,
  normalizeSpouse,
} from '@/lib/profile-normalization';
import { apiClient } from '@/lib/api-client';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import { useTranslation } from 'react-i18next';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';
import {
  buildChildProfileDelete,
  buildChildProfileUpdate,
  calculateProfileAge,
} from './enhanced-profile-helpers';

const EnhancedProfileSection: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'settings.profile' });
  const { refetch: refetchOnboarding } = useOnboarding();
  const MARITAL_OPTIONS = [
    { value: 'Single', label: t('options.marital.single') },
    { value: 'Married', label: t('options.marital.married') },
    { value: 'Divorced', label: t('options.marital.divorced') },
    { value: 'Widowed', label: t('options.marital.widowed') },
    { value: 'Prefer not to say', label: t('options.marital.na') },
  ];
  const LOCATION_OPTIONS = [
    { value: '', label: t('options.location.unspecified') },
    { value: 'Tel Aviv', label: t('options.location.telAviv') },
    { value: 'Jerusalem', label: t('options.location.jerusalem') },
    { value: 'Haifa', label: t('options.location.haifa') },
    { value: 'Beer Sheva', label: t('options.location.beerSheva') },
    { value: 'Netanya', label: t('options.location.netanya') },
    { value: 'Rishon LeZion', label: t('options.location.rishon') },
    { value: 'Petah Tikva', label: t('options.location.petahTikva') },
    { value: 'Ashdod', label: t('options.location.ashdod') },
    { value: 'Herzliya', label: t('options.location.herzliya') },
    { value: 'Other', label: t('options.location.other') },
  ];
  const INDUSTRY_OPTIONS = [
    { value: '', label: t('options.industry.unspecified') },
    { value: 'Tech', label: t('options.industry.tech') },
    { value: 'Finance', label: t('options.industry.finance') },
    { value: 'Healthcare', label: t('options.industry.healthcare') },
    { value: 'Education', label: t('options.industry.education') },
    { value: 'Retail', label: t('options.industry.retail') },
    { value: 'Manufacturing', label: t('options.industry.manufacturing') },
    { value: 'Government', label: t('options.industry.government') },
    { value: 'Self-employed', label: t('options.industry.selfEmployed') },
    { value: 'Other', label: t('options.industry.other') },
  ];
  const EMPLOYMENT_OPTIONS = [
    { value: '', label: t('options.employment.unspecified') },
    { value: 'employed', label: t('options.employment.employed') },
    { value: 'self_employed', label: t('options.employment.selfEmployed') },
    { value: 'unemployed', label: t('options.employment.unemployed') },
    { value: 'retired', label: t('options.employment.retired') },
    { value: 'student', label: t('options.employment.student') },
  ];
  const EDUCATION_OPTIONS = [
    { value: '', label: t('options.education.unspecified') },
    { value: 'high_school', label: t('options.education.highSchool') },
    { value: 'vocational', label: t('options.education.vocational') },
    { value: 'bachelor', label: t('options.education.bachelor') },
    { value: 'master', label: t('options.education.master') },
    { value: 'phd', label: t('options.education.phd') },
    { value: 'other', label: t('options.education.other') },
  ];
  const HOME_OPTIONS = [
    { value: '', label: t('options.home.unspecified') },
    { value: 'rent', label: t('options.home.rent') },
    { value: 'own', label: t('options.home.own') },
    { value: 'family', label: t('options.home.family') },
    { value: 'other', label: t('options.home.other') },
  ];
  const GENDER_OPTIONS = [
    { value: '', label: t('options.gender.unspecified') },
    { value: 'male', label: t('options.gender.male') },
    { value: 'female', label: t('options.gender.female') },
    { value: 'other', label: t('options.gender.other') },
  ];
  const CHILD_EDUCATION_OPTIONS = [
    { value: '', label: t('options.childEducation.unspecified') },
    { value: 'infant', label: t('options.childEducation.infant') },
    { value: 'toddler', label: t('options.childEducation.toddler') },
    { value: 'preschool', label: t('options.childEducation.preschool') },
    { value: 'elementary', label: t('options.childEducation.elementary') },
    { value: 'middle_school', label: t('options.childEducation.middleSchool') },
    { value: 'high_school', label: t('options.childEducation.highSchool') },
    { value: 'university', label: t('options.childEducation.university') },
    { value: 'graduated', label: t('options.childEducation.graduated') },
  ];
  const [profileData, setProfileData] = useState<ProfileData>({
    profile: {
      username: '',
      marital_status: 'Single',
      age: null,
      birth_date: null,
      occupation: '',
      monthly_income: null,
      family_status: '',
      location: '',
      industry: '',
      children_count: 0,
      household_size: 1,
      home_ownership: '',
      education_level: '',
      employment_status: '',
    },
    spouse: null,
    children: [],
  });

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>(undefined);
  const [childDialogOpen, setChildDialogOpen] = useState(false);
  const [editingChild, setEditingChild] = useState<ChildProfile | null>(null);
  const [tempChild, setTempChild] = useState<ChildProfile>({
    name: '',
    birth_date: '',
    gender: '',
    education_stage: '',
    special_needs: false,
  });

  useEffect(() => {
    fetchProfileData();
  }, []);

  const fetchProfileData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const response = await apiClient.get('/api/profile');
      if (!response.ok) {
        if (response.status === 401) {
          setLoadError(t('messages.sessionExpired'));
        } else {
          setLoadError(t('messages.loadError'));
        }
        return;
      }
      const data = response.data as any;

      const normalized = data.profile
        ? {
            profile: normalizeProfile(data.profile),
            spouse: normalizeSpouse(data.spouse),
            children: normalizeChildren(data.children),
          }
        : {
          profile: normalizeProfile(data),
          spouse: null,
          children: [],
        };
      setProfileData(normalized);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setLoadError(t('messages.loadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaveError('');
    setSaveSuccess(false);

    try {
      const response = await apiClient.put('/api/profile', profileData);
      if (!response.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        throw new Error(response.statusText || 'Failed to save profile');
      }

      const updatedData = response.data as any;
      setProfileData({
        profile: normalizeProfile(updatedData.profile),
        spouse: normalizeSpouse(updatedData.spouse),
        children: normalizeChildren(updatedData.children),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      // Refresh onboarding status to update checklist automatically
      await refetchOnboarding();
    } catch (error) {
      console.error('Error saving profile:', error);
      setSaveError(t('messages.saveError'));
    }
  };

  const calculateAge = (birthDate: string) => calculateProfileAge(birthDate);

  const handleAddChild = () => {
    setEditingChild(null);
    setTempChild({
      name: '',
      birth_date: '',
      gender: '',
      education_stage: '',
      special_needs: false,
    });
    setChildDialogOpen(true);
  };

  const handleEditChild = (child: ChildProfile) => {
    setEditingChild(child);
    setTempChild({ ...child });
    setChildDialogOpen(true);
  };

  const handleSaveChild = () => {
    if (!tempChild.birth_date) {
      setSaveError(t('children.dialog.birthRequired'));
      return;
    }

    const { updatedChildren, childrenCount, householdSize } = buildChildProfileUpdate({
      existingChildren: profileData.children,
      editingChild,
      tempChild,
      hasSpouse: Boolean(profileData.spouse),
      newChildId: Date.now(),
    });

    setProfileData({
      ...profileData,
      children: updatedChildren,
      profile: {
        ...profileData.profile,
        children_count: childrenCount,
        household_size: householdSize,
      }
    });

    setChildDialogOpen(false);
  };

  const handleDeleteChild = (childId: number | undefined) => {
    if (!childId) return;
    const { updatedChildren, childrenCount, householdSize } = buildChildProfileDelete({
      existingChildren: profileData.children,
      childId,
      hasSpouse: Boolean(profileData.spouse),
    });
    setProfileData({
      ...profileData,
      children: updatedChildren,
      profile: {
        ...profileData.profile,
        children_count: childrenCount,
        household_size: householdSize,
      }
    });
  };

  const handleProfileChange = (field: keyof EnhancedUserProfile, value: any) => {
    setProfileData({
      ...profileData,
      profile: {
        ...profileData.profile,
        [field]: value,
      }
    });
  };

  const handleSpouseChange = (field: keyof SpouseProfile, value: any) => {
    if (profileData.profile.marital_status === 'Married') {
      setProfileData({
        ...profileData,
        spouse: {
          ...profileData.spouse,
          [field]: value,
        } as SpouseProfile
      });
    }
  };

  const handleMaritalStatusChange = (status: string) => {
    const updatedProfile = { ...profileData.profile, marital_status: status };
    const updatedData: ProfileData = {
      ...profileData,
      profile: updatedProfile,
    };

    if (status === 'Married' && !profileData.spouse) {
      updatedData.spouse = {
        name: '',
        birth_date: '',
        occupation: '',
        industry: '',
        monthly_income: null,
        employment_status: '',
        education_level: '',
      };
    } else if (status !== 'Married') {
      updatedData.spouse = null;
    }

    // Recalculate household size
    updatedData.profile.household_size = 1 + (updatedData.spouse ? 1 : 0) + profileData.children.length;

    setProfileData(updatedData);
  };

  if (isLoading && !loadError) {
    return (
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="body1">{t('loading')}</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <PersonIcon color="primary" />
        <Typography variant="h6">{t('sections.profile')}</Typography>
        <Chip
          label={t('household', { size: profileData.profile.household_size })}
          color="primary"
          size="small"
          sx={{ ml: 'auto' }}
        />
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('intro')}
      </Typography>

      {loadError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {loadError}
        </Alert>
      )}

      {/* Basic Information - Always Visible */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonIcon fontSize="small" />
            <Typography variant="h6">{t('sections.basic')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label={t('fields.username')}
                fullWidth
                value={profileData.profile.username}
                onChange={(e) => handleProfileChange('username', e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label={t('fields.birthDate')}
                type="date"
                fullWidth
                value={profileData.profile.birth_date || ''}
                onChange={(e) => {
                  const newValue = e.target.value;
                  // Use the input's native validity check instead of Date.parse
                  // This properly handles partial input during typing
                  if (newValue === '' || e.target.validity.valid) {
                    // Update both birth_date and age in a SINGLE state update to prevent double renders
                    setProfileData({
                      ...profileData,
                      profile: {
                        ...profileData.profile,
                        birth_date: newValue,
                        age: newValue ? calculateAge(newValue) : null,
                      }
                    });
                  }
                }}
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <AgeIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
                helperText={profileData.profile.birth_date ? t('helpers.ageProfile', { age: calculateAge(profileData.profile.birth_date) }) : t('helpers.required')}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('fields.maritalStatus')}</InputLabel>
                <Select
                  data-testid="marital-status-select"
                  value={profileData.profile.marital_status}
                  label={t('fields.maritalStatus')}
                  onChange={(e) => handleMaritalStatusChange(e.target.value)}
                >
                  {MARITAL_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('fields.location')}</InputLabel>
                <Select
                  value={profileData.profile.location}
                  label={t('fields.location')}
                  onChange={(e) => handleProfileChange('location', e.target.value)}
                >
                  {LOCATION_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Professional Information */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WorkIcon fontSize="small" />
            <Typography variant="h6">{t('sections.professional')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label={t('fields.occupation')}
                fullWidth
                value={profileData.profile.occupation}
                onChange={(e) => handleProfileChange('occupation', e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <WorkIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
                placeholder={t('placeholders.occupation')}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('fields.industry')}</InputLabel>
                <Select
                  value={profileData.profile.industry}
                  label={t('fields.industry')}
                  onChange={(e) => handleProfileChange('industry', e.target.value)}
                >
                  {INDUSTRY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('fields.employmentStatus')}</InputLabel>
                <Select
                  value={profileData.profile.employment_status}
                  label={t('fields.employmentStatus')}
                  onChange={(e) => handleProfileChange('employment_status', e.target.value)}
                >
                  {EMPLOYMENT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('fields.educationLevel')}</InputLabel>
                <Select
                  value={profileData.profile.education_level}
                  label={t('fields.educationLevel')}
                  onChange={(e) => handleProfileChange('education_level', e.target.value)}
                >
                  {EDUCATION_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label={t('fields.monthlyIncome')}
                type="number"
                fullWidth
                value={profileData.profile.monthly_income || ''}
                onChange={(e) => handleProfileChange('monthly_income', e.target.value ? parseFloat(e.target.value) : null)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      ₪
                    </InputAdornment>
                  ),
                }}
                placeholder={t('placeholders.income')}
                helperText={t('helpers.grossIncome')}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('fields.homeOwnership')}</InputLabel>
                <Select
                  value={profileData.profile.home_ownership}
                  label={t('fields.homeOwnership')}
                  onChange={(e) => handleProfileChange('home_ownership', e.target.value)}
                >
                  {HOME_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Spouse Information - Only if Married */}
      {profileData.profile.marital_status === 'Married' && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SpouseIcon fontSize="small" />
              <Typography variant="h6">{t('sections.spouse')}</Typography>
              {profileData.spouse?.name && (
                <Chip label={profileData.spouse.name} size="small" color="secondary" />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  label={t('fields.spouseName')}
                  fullWidth
                  value={profileData.spouse?.name || ''}
                  onChange={(e) => handleSpouseChange('name', e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SpouseIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  label={t('fields.spouseBirthDate')}
                  type="date"
                  fullWidth
                  value={profileData.spouse?.birth_date || ''}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    // Use native validity check for proper validation during typing
                  if (newValue === '' || e.target.validity.valid) {
                    handleSpouseChange('birth_date', newValue);
                  }
                }}
                InputLabelProps={{ shrink: true }}
                helperText={profileData.spouse?.birth_date ? t('helpers.ageSpouse', { age: calculateAge(profileData.spouse.birth_date) }) : ''}
              />
            </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  label={t('fields.spouseOccupation')}
                  fullWidth
                  value={profileData.spouse?.occupation || ''}
                  onChange={(e) => handleSpouseChange('occupation', e.target.value)}
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('fields.spouseIndustry')}</InputLabel>
                  <Select
                    value={profileData.spouse?.industry || ''}
                    label={t('fields.spouseIndustry')}
                    onChange={(e) => handleSpouseChange('industry', e.target.value)}
                  >
                    {INDUSTRY_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  label={t('fields.spouseIncome')}
                  type="number"
                  fullWidth
                  value={profileData.spouse?.monthly_income || ''}
                  onChange={(e) => handleSpouseChange('monthly_income', e.target.value ? parseFloat(e.target.value) : null)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        ₪
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('fields.spouseEmployment')}</InputLabel>
                  <Select
                    value={profileData.spouse?.employment_status || ''}
                    label={t('fields.spouseEmployment')}
                    onChange={(e) => handleSpouseChange('employment_status', e.target.value)}
                  >
                    {EMPLOYMENT_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Children Information */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ChildIcon fontSize="small" />
            <Typography variant="h6">{t('sections.children')}</Typography>
            <Chip
              label={t('children.count', { count: profileData.children.length })}
              size="small"
              color={profileData.children.length > 0 ? 'primary' : 'default'}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box>
            {profileData.children.length === 0 ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('children.empty')}
              </Alert>
            ) : (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                {profileData.children.map((child, index) => {
                  const age = child.birth_date ? calculateAge(child.birth_date) : null;
                  const educationLabel = CHILD_EDUCATION_OPTIONS.find((option) => option.value === child.education_stage)?.label;
                  return (
                    <Grid size={{ xs: 12, md: 6 }} key={child.id || index}>
                      <Card variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                            <Typography variant="h6" component="div">
                              {child.name || t('children.unnamed', { index: index + 1 })}
                            </Typography>
                            <Box>
                              <IconButton
                                size="small"
                                aria-label={t('actions.editChild')}
                                onClick={() => handleEditChild(child)}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                size="small"
                                aria-label={t('actions.deleteChild')}
                                onClick={() => handleDeleteChild(child.id)}
                                color="error"
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          </Box>
                          <Typography color="text.secondary" gutterBottom>
                            {age !== null ? t('children.age', { age }) : ''}
                          </Typography>
                          {child.education_stage && (
                            <Chip label={educationLabel || t('options.childEducation.unspecified')} size="small" sx={{ mr: 1 }} />
                          )}
                          {child.special_needs && (
                            <Chip label={t('children.specialNeeds')} size="small" color="secondary" />
                          )}
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            )}

            <Fab
              size="small"
              color="primary"
              onClick={handleAddChild}
              aria-label={t('actions.addChild')}
              sx={{ mt: 2 }}
            >
              <AddIcon />
            </Fab>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Household Summary */}
      {(profileData.spouse || profileData.children.length > 0) && (
        <Alert severity="info" sx={{ mt: 3, mb: 2 }}>
          <Typography variant="body2">
            <strong>{t('summary.title')}</strong> {t('summary.members', { count: profileData.profile.household_size })}
            {profileData.spouse && (
              <> • {t('summary.combinedIncome', { amount: ((profileData.profile.monthly_income || 0) + (profileData.spouse?.monthly_income || 0)).toLocaleString() })}</>
            )}
            {profileData.children.length > 0 && (
              <> • {t('summary.children', { count: profileData.children.length })}</>
            )}
          </Typography>
        </Alert>
      )}

      {/* Privacy Notice */}
      <Alert severity="info" sx={{ mt: 3, mb: 2 }}>
        <Typography variant="body2">
          🔒 <strong>{t('privacyNote.title')}</strong> {t('privacyNote.body')}
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
          {t('actions.save')}
        </Button>
      </Box>

      {/* Success/Error Messages */}
      {saveSuccess && (
        <Alert severity="success" sx={{ mt: 2 }}>
          {t('messages.saveSuccess')}
        </Alert>
      )}

      {saveError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {saveError}
        </Alert>
      )}

      {/* Child Dialog */}
      <Dialog open={childDialogOpen} onClose={() => setChildDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingChild ? t('children.dialog.editTitle') : t('children.dialog.addTitle')}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('children.dialog.name')}
                fullWidth
                value={tempChild.name}
                onChange={(e) => setTempChild({ ...tempChild, name: e.target.value })}
                placeholder={t('children.dialog.namePlaceholder')}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label={t('children.dialog.birthDate')}
                type="date"
                fullWidth
                required
                value={tempChild.birth_date}
                onChange={(e) => {
                  const newValue = e.target.value;
                  // Use native validity check for proper validation during typing
                  if (newValue === '' || e.target.validity.valid) {
                    setTempChild({ ...tempChild, birth_date: newValue });
                  }
                }}
                InputLabelProps={{ shrink: true }}
                helperText={tempChild.birth_date ? t('children.dialog.age', { age: calculateAge(tempChild.birth_date) }) : t('children.dialog.required')}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('children.dialog.gender')}</InputLabel>
                <Select
                  value={tempChild.gender}
                  label={t('children.dialog.gender')}
                  onChange={(e) => setTempChild({ ...tempChild, gender: e.target.value })}
                >
                  {GENDER_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <FormControl fullWidth>
                <InputLabel>{t('children.dialog.educationStage')}</InputLabel>
                <Select
                  value={tempChild.education_stage}
                  label={t('children.dialog.educationStage')}
                  onChange={(e) => setTempChild({ ...tempChild, education_stage: e.target.value })}
                >
                  {CHILD_EDUCATION_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={tempChild.special_needs}
                    onChange={(e) => setTempChild({ ...tempChild, special_needs: e.target.checked })}
                  />
                }
                label={t('children.dialog.specialNeeds')}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChildDialogOpen(false)}>{t('actions.cancel')}</Button>
          <Button onClick={handleSaveChild} variant="contained">
            {editingChild ? t('actions.saveChanges') : t('actions.addChild')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* License Read-Only Alert */}
      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </Paper>
  );
};

export default EnhancedProfileSection;
