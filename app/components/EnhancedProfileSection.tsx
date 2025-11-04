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

const EnhancedProfileSection: React.FC = () => {
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
          setLoadError('Session expired. Please sign in again.');
        } else {
          setLoadError('Failed to load profile. Please try again.');
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
      setLoadError('Failed to load profile. Please try again.');
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
    } catch (error) {
      console.error('Error saving profile:', error);
      setSaveError('Failed to save profile. Please try again.');
    }
  };

  const calculateAge = (birthDate: string) => {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

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
      setSaveError('Birth date is required for children');
      return;
    }

    const updatedChildren = editingChild
      ? profileData.children.map(c => c.id === editingChild.id ? { ...tempChild } : c)
      : [...profileData.children, { ...tempChild, id: Date.now() }]; // Temporary ID

    setProfileData({
      ...profileData,
      children: updatedChildren,
      profile: {
        ...profileData.profile,
        children_count: updatedChildren.length,
        household_size: 1 + (profileData.spouse ? 1 : 0) + updatedChildren.length,
      }
    });

    setChildDialogOpen(false);
  };

  const handleDeleteChild = (childId: number | undefined) => {
    if (!childId) return;
    const updatedChildren = profileData.children.filter(c => c.id !== childId);
    setProfileData({
      ...profileData,
      children: updatedChildren,
      profile: {
        ...profileData.profile,
        children_count: updatedChildren.length,
        household_size: 1 + (profileData.spouse ? 1 : 0) + updatedChildren.length,
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
        <Typography variant="body1">Loading profile...</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <PersonIcon color="primary" />
        <Typography variant="h6">Enhanced Profile Information</Typography>
        <Chip
          label={`Household of ${profileData.profile.household_size}`}
          color="primary"
          size="small"
          sx={{ ml: 'auto' }}
        />
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Complete your enhanced profile for personalized insights and family financial analytics.
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
            <Typography variant="h6">Basic Information</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Username"
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

            <Grid item xs={12} md={6}>
              <TextField
                label="Birth Date"
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
                helperText={profileData.profile.birth_date ? `Age: ${calculateAge(profileData.profile.birth_date)}` : 'Used for age-group comparisons'}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Marital Status</InputLabel>
                <Select
                  value={profileData.profile.marital_status}
                  label="Marital Status"
                  onChange={(e) => handleMaritalStatusChange(e.target.value)}
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
                <InputLabel>Location</InputLabel>
                <Select
                  value={profileData.profile.location}
                  label="Location"
                  onChange={(e) => handleProfileChange('location', e.target.value)}
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
        </AccordionDetails>
      </Accordion>

      {/* Professional Information */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WorkIcon fontSize="small" />
            <Typography variant="h6">Professional Information</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Occupation"
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
                placeholder="e.g., Software Engineer"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Industry</InputLabel>
                <Select
                  value={profileData.profile.industry}
                  label="Industry"
                  onChange={(e) => handleProfileChange('industry', e.target.value)}
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

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Employment Status</InputLabel>
                <Select
                  value={profileData.profile.employment_status}
                  label="Employment Status"
                  onChange={(e) => handleProfileChange('employment_status', e.target.value)}
                >
                  <MenuItem value="">Not specified</MenuItem>
                  <MenuItem value="employed">Employed</MenuItem>
                  <MenuItem value="self_employed">Self-employed</MenuItem>
                  <MenuItem value="unemployed">Unemployed</MenuItem>
                  <MenuItem value="retired">Retired</MenuItem>
                  <MenuItem value="student">Student</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Education Level</InputLabel>
                <Select
                  value={profileData.profile.education_level}
                  label="Education Level"
                  onChange={(e) => handleProfileChange('education_level', e.target.value)}
                >
                  <MenuItem value="">Not specified</MenuItem>
                  <MenuItem value="high_school">High School</MenuItem>
                  <MenuItem value="vocational">Vocational Training</MenuItem>
                  <MenuItem value="bachelor">Bachelor&apos;s Degree</MenuItem>
                  <MenuItem value="master">Master&apos;s Degree</MenuItem>
                  <MenuItem value="phd">PhD</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label="Monthly Income"
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
                placeholder="15000"
                helperText="Gross monthly income"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Home Ownership</InputLabel>
                <Select
                  value={profileData.profile.home_ownership}
                  label="Home Ownership"
                  onChange={(e) => handleProfileChange('home_ownership', e.target.value)}
                >
                  <MenuItem value="">Not specified</MenuItem>
                  <MenuItem value="rent">Rent</MenuItem>
                  <MenuItem value="own">Own</MenuItem>
                  <MenuItem value="family">Living with Family</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
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
              <Typography variant="h6">Spouse Information</Typography>
              {profileData.spouse?.name && (
                <Chip label={profileData.spouse.name} size="small" color="secondary" />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Spouse Name"
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

              <Grid item xs={12} md={6}>
                <TextField
                  label="Spouse Birth Date"
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
                  helperText={profileData.spouse?.birth_date ? `Age: ${calculateAge(profileData.spouse.birth_date)}` : ''}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  label="Spouse Occupation"
                  fullWidth
                  value={profileData.spouse?.occupation || ''}
                  onChange={(e) => handleSpouseChange('occupation', e.target.value)}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Spouse Industry</InputLabel>
                  <Select
                    value={profileData.spouse?.industry || ''}
                    label="Spouse Industry"
                    onChange={(e) => handleSpouseChange('industry', e.target.value)}
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

              <Grid item xs={12} md={6}>
                <TextField
                  label="Spouse Monthly Income"
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

              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Employment Status</InputLabel>
                  <Select
                    value={profileData.spouse?.employment_status || ''}
                    label="Employment Status"
                    onChange={(e) => handleSpouseChange('employment_status', e.target.value)}
                  >
                    <MenuItem value="">Not specified</MenuItem>
                    <MenuItem value="employed">Employed</MenuItem>
                    <MenuItem value="self_employed">Self-employed</MenuItem>
                    <MenuItem value="unemployed">Unemployed</MenuItem>
                    <MenuItem value="retired">Retired</MenuItem>
                    <MenuItem value="student">Student</MenuItem>
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
            <Typography variant="h6">Children Information</Typography>
            <Chip
              label={`${profileData.children.length} ${profileData.children.length === 1 ? 'child' : 'children'}`}
              size="small"
              color={profileData.children.length > 0 ? 'primary' : 'default'}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box>
            {profileData.children.length === 0 ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                No children added yet. Click the + button to add your first child.
              </Alert>
            ) : (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                {profileData.children.map((child, index) => (
                  <Grid item xs={12} md={6} key={child.id || index}>
                    <Card variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Typography variant="h6" component="div">
                            {child.name || `Child ${index + 1}`}
                          </Typography>
                          <Box>
                            <IconButton
                              size="small"
                              aria-label="Edit child"
                              onClick={() => handleEditChild(child)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              aria-label="Delete child"
                              onClick={() => handleDeleteChild(child.id)}
                              color="error"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </Box>
                        <Typography color="text.secondary" gutterBottom>
                          Age: {calculateAge(child.birth_date)} years old
                        </Typography>
                        {child.education_stage && (
                          <Chip label={child.education_stage.replace('_', ' ')} size="small" sx={{ mr: 1 }} />
                        )}
                        {child.special_needs && (
                          <Chip label="Special Needs" size="small" color="secondary" />
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}

            <Fab
              size="small"
              color="primary"
              onClick={handleAddChild}
              aria-label="Add child"
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
            <strong>Household Summary:</strong> {profileData.profile.household_size} members
            {profileData.spouse && (
              <> • Combined income: ₪{((profileData.profile.monthly_income || 0) + (profileData.spouse.monthly_income || 0)).toLocaleString()}/month</>
            )}
            {profileData.children.length > 0 && (
              <> • {profileData.children.length} {profileData.children.length === 1 ? 'child' : 'children'}</>
            )}
          </Typography>
        </Alert>
      )}

      {/* Privacy Notice */}
      <Alert severity="info" sx={{ mt: 3, mb: 2 }}>
        <Typography variant="body2">
          🔒 <strong>Your privacy matters:</strong> All family data is stored locally and used only for personalized
          insights. This information enables advanced household analytics and family financial comparisons.
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
          Save Enhanced Profile
        </Button>
      </Box>

      {/* Success/Error Messages */}
      {saveSuccess && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Enhanced profile updated successfully! Your family insights will now be more comprehensive.
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
          {editingChild ? 'Edit Child Information' : 'Add Child Information'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Child Name"
                fullWidth
                value={tempChild.name}
                onChange={(e) => setTempChild({ ...tempChild, name: e.target.value })}
                placeholder="Optional - can be left blank"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label="Birth Date"
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
                helperText={tempChild.birth_date ? `Age: ${calculateAge(tempChild.birth_date)}` : 'Required'}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Gender</InputLabel>
                <Select
                  value={tempChild.gender}
                  label="Gender"
                  onChange={(e) => setTempChild({ ...tempChild, gender: e.target.value })}
                >
                  <MenuItem value="">Prefer not to say</MenuItem>
                  <MenuItem value="male">Male</MenuItem>
                  <MenuItem value="female">Female</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Education Stage</InputLabel>
                <Select
                  value={tempChild.education_stage}
                  label="Education Stage"
                  onChange={(e) => setTempChild({ ...tempChild, education_stage: e.target.value })}
                >
                  <MenuItem value="">Not specified</MenuItem>
                  <MenuItem value="infant">Infant (0-1 years)</MenuItem>
                  <MenuItem value="toddler">Toddler (1-3 years)</MenuItem>
                  <MenuItem value="preschool">Preschool (3-5 years)</MenuItem>
                  <MenuItem value="elementary">Elementary School</MenuItem>
                  <MenuItem value="middle_school">Middle School</MenuItem>
                  <MenuItem value="high_school">High School</MenuItem>
                  <MenuItem value="university">University</MenuItem>
                  <MenuItem value="graduated">Graduated</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={tempChild.special_needs}
                    onChange={(e) => setTempChild({ ...tempChild, special_needs: e.target.checked })}
                  />
                }
                label="Has special needs (affects family expenses)"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChildDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveChild} variant="contained">
            {editingChild ? 'Update' : 'Add'} Child
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default EnhancedProfileSection;
