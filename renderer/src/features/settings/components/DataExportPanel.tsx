import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Chip,
  Autocomplete,
  Grid,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  LinearProgress,
  FormControlLabel,
  Checkbox,
  FormGroup,
} from '@mui/material';
import {
  Download as DownloadIcon,
  GetApp as ExportIcon,
  DateRange as DateIcon,
  Description as FileIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { format as formatDate, subMonths, startOfYear } from 'date-fns';
import { apiClient } from '@/lib/api-client';
import InstitutionBadge, { InstitutionMetadata, getInstitutionLabel } from '@renderer/shared/components/InstitutionBadge';
import { useTranslation } from 'react-i18next';

interface ExportStatus {
  loading: boolean;
  success: boolean;
  error: string | null;
  downloadUrl: string | null;
}

interface Category {
  name: string;
  count: number;
}

interface Vendor {
  name: string;
  count: number;
  institution?: InstitutionMetadata | null;
}

const DataExportPanel: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'settings.dataExport' });
  // Export configuration state
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [dataType, setDataType] = useState<'transactions' | 'categories' | 'vendors' | 'budgets' | 'full'>('transactions');
  const [dateRange, setDateRange] = useState<'last3months' | 'last6months' | 'lastyear' | 'thisyear' | 'custom'>('last3months');
  const [startDate, setStartDate] = useState<Date>(subMonths(new Date(), 3));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [includeIncome, setIncludeIncome] = useState(true);
  const [includeExpenses, setIncludeExpenses] = useState(true);
  const [includeInvestments, setIncludeInvestments] = useState(true);
  const [excludeDuplicates, setExcludeDuplicates] = useState(true);
  const [includeInstitutions, setIncludeInstitutions] = useState(true);

  // Data state
  const [categories, setCategories] = useState<Category[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({
    loading: false,
    success: false,
    error: null,
    downloadUrl: null,
  });
  const [hasElectronSaveBridge, setHasElectronSaveBridge] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchVendors();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const fileApi = window.electronAPI?.file;
    setHasElectronSaveBridge(Boolean(fileApi?.showSaveDialog && fileApi?.writeFile));
  }, []);

  useEffect(() => {
    // Update dates when range changes
    const now = new Date();
    switch (dateRange) {
      case 'last3months':
        setStartDate(subMonths(now, 3));
        setEndDate(now);
        break;
      case 'last6months':
        setStartDate(subMonths(now, 6));
        setEndDate(now);
        break;
      case 'lastyear':
        setStartDate(subMonths(now, 12));
        setEndDate(now);
        break;
      case 'thisyear':
        setStartDate(startOfYear(now));
        setEndDate(now);
        break;
      // custom range doesn't change dates
    }
  }, [dateRange]);

  const fetchCategories = async () => {
    try {
      const response = await apiClient.get('/api/get_all_categories');
      const data = response.data as any;
      setCategories(data.map((cat: any) => ({ name: cat.category, count: cat.count })));
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchVendors = async () => {
    try {
      const response = await apiClient.get('/api/analytics/unified-category?groupBy=vendor&months=12');
      const data = response.data as any;
      if (data.success && data.data.breakdown) {
        setVendors(
          data.data.breakdown.map((vendor: any) => ({
            name: vendor.vendor,
            count: vendor.count,
            institution: vendor.institution || null,
          })),
        );
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const handleExport = async () => {
    setExportStatus({ loading: true, success: false, error: null, downloadUrl: null });

    try {
      const params = new URLSearchParams({
        format,
        dataType,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        excludeDuplicates: excludeDuplicates.toString(),
        includeIncome: includeIncome.toString(),
        includeExpenses: includeExpenses.toString(),
        includeInvestments: includeInvestments.toString(),
        includeInstitutions: includeInstitutions.toString(),
      });

      if (selectedCategories.length > 0) {
        params.append('categories', selectedCategories.join(','));
      }

      if (selectedVendors.length > 0) {
        params.append('vendors', selectedVendors.join(','));
      }

      const response = await apiClient.get(`/api/data/export?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const now = new Date();
      const defaultFilename =
        format === 'csv'
          ? `clarify-export-${Date.now()}.csv`
          : `clarify-export-${dataType}-${formatDate(now, 'yyyy-MM-dd')}.json`;
      const payload =
        format === 'csv'
          ? String(response.data ?? '')
          : JSON.stringify(response.data, null, 2);
      const electronFileApi =
        typeof window !== 'undefined' ? window.electronAPI?.file : undefined;

      if (electronFileApi?.showSaveDialog && electronFileApi?.writeFile) {
        const filters =
          format === 'csv'
            ? [{ name: 'CSV Files', extensions: ['csv'] }]
            : [{ name: 'JSON Files', extensions: ['json'] }];

        const saveResult = await electronFileApi.showSaveDialog({
          defaultPath: defaultFilename,
          filters,
        });

        if (saveResult.canceled || !saveResult.filePath) {
          setExportStatus({ loading: false, success: false, error: null, downloadUrl: null });
          return;
        }

        const writeResult = await electronFileApi.writeFile(saveResult.filePath, payload, {
          encoding: 'utf8',
        });

        if (!writeResult.success) {
          throw new Error(
            writeResult.error ||
              'Failed to save exported file. Check that the destination is writable and try again.',
          );
        }
      } else {
        const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
        const blob = new Blob([payload], { type: mimeType });
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }

      setExportStatus({ loading: false, success: true, error: null, downloadUrl: null });

      // Reset success state after 3 seconds
      setTimeout(() => {
        setExportStatus(prev => ({ ...prev, success: false }));
      }, 3000);

    } catch (error) {
      setExportStatus({
        loading: false,
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
        downloadUrl: null,
      });
    }
  };

  const getEstimatedRecords = () => {
    // Simple estimation based on selected timeframe and filters
    const monthsDiff = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)));
    const baseRecords = monthsDiff * 50; // Assume ~50 transactions per month

    let multiplier = 1;
    if (selectedCategories.length > 0) multiplier *= 0.3; // Filter reduces records
    if (selectedVendors.length > 0) multiplier *= 0.2;

    return Math.round(baseRecords * multiplier);
  };

  const selectedVendorOptions = vendors.filter((v) => selectedVendors.includes(v.name));

  return (
    <Paper sx={{ p: 3 }} data-testid="data-export-panel">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <ExportIcon color="primary" />
        <Typography variant="h6">{t('title')}</Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('description')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('institutionNote')}
      </Typography>
      <Alert severity="info" sx={{ mb: 3 }}>
        {hasElectronSaveBridge ? t('bridge.desktop') : t('bridge.web')}
      </Alert>

      <Grid container spacing={3}>
        {/* Export Configuration */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <FileIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                {t('config.title')}
              </Typography>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>{t('config.dataTypeLabel')}</InputLabel>
                <Select
                  value={dataType}
                  label={t('config.dataTypeLabel')}
                  onChange={(e) => setDataType(e.target.value as any)}
                >
                  <MenuItem value="transactions">{t('config.dataTypes.transactions')}</MenuItem>
                  <MenuItem value="categories">{t('config.dataTypes.categories')}</MenuItem>
                  <MenuItem value="vendors">{t('config.dataTypes.vendors')}</MenuItem>
                  <MenuItem value="budgets">{t('config.dataTypes.budgets')}</MenuItem>
                  <MenuItem value="full">{t('config.dataTypes.full')}</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>{t('config.formatLabel')}</InputLabel>
                <Select
                  value={format}
                  label={t('config.formatLabel')}
                  onChange={(e) => setFormat(e.target.value as any)}
                >
                  <MenuItem value="csv">{t('config.format.csv')}</MenuItem>
                  <MenuItem value="json">{t('config.format.json')}</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>{t('config.dateRangeLabel')}</InputLabel>
                <Select
                  value={dateRange}
                  label={t('config.dateRangeLabel')}
                  onChange={(e) => setDateRange(e.target.value as any)}
                >
                  <MenuItem value="last3months">{t('config.dateRanges.last3months')}</MenuItem>
                  <MenuItem value="last6months">{t('config.dateRanges.last6months')}</MenuItem>
                  <MenuItem value="lastyear">{t('config.dateRanges.lastyear')}</MenuItem>
                  <MenuItem value="thisyear">{t('config.dateRanges.thisyear')}</MenuItem>
                  <MenuItem value="custom">{t('config.dateRanges.custom')}</MenuItem>
                </Select>
              </FormControl>

              {dateRange === 'custom' && (
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <DatePicker
                      label={t('config.startDate')}
                      value={startDate}
                      onChange={(newValue: Date | null) => {
                        if (newValue) {
                          setStartDate(newValue);
                        }
                      }}
                      slotProps={{ textField: { size: 'small', fullWidth: true } }}
                    />
                    <DatePicker
                      label={t('config.endDate')}
                      value={endDate}
                      onChange={(newValue: Date | null) => {
                        if (newValue) {
                          setEndDate(newValue);
                        }
                      }}
                      slotProps={{ textField: { size: 'small', fullWidth: true } }}
                    />
                  </Box>
                </LocalizationProvider>
              )}

              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                <DateIcon sx={{ fontSize: 16, mr: 0.5 }} />
                {t('config.exportPeriod', {
                  start: formatDate(startDate, 'MMM dd, yyyy'),
                  end: formatDate(endDate, 'MMM dd, yyyy'),
                })}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Filters */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t('filters.title')}
              </Typography>

              <FormGroup sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>{t('filters.includeTypes')}</Typography>
                <FormControlLabel
                  control={<Checkbox checked={includeIncome} onChange={(e) => setIncludeIncome(e.target.checked)} />}
                  label={t('filters.income')}
                />
                <FormControlLabel
                  control={<Checkbox checked={includeExpenses} onChange={(e) => setIncludeExpenses(e.target.checked)} />}
                  label={t('filters.expenses')}
                />
                <FormControlLabel
                  control={<Checkbox checked={includeInvestments} onChange={(e) => setIncludeInvestments(e.target.checked)} />}
                  label={t('filters.investments')}
                />
              </FormGroup>

              <FormControlLabel
                control={<Checkbox checked={excludeDuplicates} onChange={(e) => setExcludeDuplicates(e.target.checked)} />}
                label={t('filters.excludeDuplicates')}
                sx={{ mb: 2 }}
              />
              <FormControlLabel
                control={<Checkbox checked={includeInstitutions} onChange={(e) => setIncludeInstitutions(e.target.checked)} />}
                label={t('filters.includeInstitutions')}
                sx={{ mb: 2 }}
              />

              <Autocomplete
                multiple
                options={categories.map(c => c.name)}
                value={selectedCategories}
                onChange={(_, newValue) => setSelectedCategories(newValue)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('filters.categories.label')}
                    placeholder={t('filters.categories.placeholder')}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      size="small"
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
                sx={{ mb: 2 }}
              />

              <Autocomplete<Vendor, true, false, false>
                multiple
                options={vendors}
                value={selectedVendorOptions}
                getOptionLabel={(option) =>
                  option?.institution ? getInstitutionLabel(option.institution) || option.name : option?.name || ''
                }
                isOptionEqualToValue={(option, value) => option.name === value.name}
                onChange={(_, newValue) => setSelectedVendors(newValue.map((option) => option.name))}
                renderOption={(props, option) => (
                  <li {...props} key={option.name}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <InstitutionBadge institution={option.institution} fallback={option.name} />
                      <Typography variant="caption" color="text.secondary">
                        {t('filters.vendors.count', { count: option.count })}
                      </Typography>
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('filters.vendors.label')}
                    placeholder={t('filters.vendors.placeholder')}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option.institution ? getInstitutionLabel(option.institution) || option.name : option.name}
                      size="small"
                      {...getTagProps({ index })}
                      key={option.name}
                    />
                  ))
                }
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Export Summary & Action */}
        <Grid size={{ xs: 12 }}>
          <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography variant="h6">Export Summary</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('summary.estimated', { count: getEstimatedRecords() })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('summary.formatType', { format: format.toUpperCase(), type: dataType })}
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={exportStatus.loading ? <CircularProgress size={20} color="inherit" /> : <DownloadIcon />}
                  onClick={handleExport}
                  disabled={exportStatus.loading}
                  data-testid="data-export-submit"
                  sx={{ minWidth: 140 }}
                >
                  {exportStatus.loading ? t('summary.exporting') : t('summary.cta')}
                </Button>
              </Box>

              {exportStatus.loading && (
                <LinearProgress sx={{ mb: 2 }} />
              )}

              {exportStatus.success && (
                <Alert severity="success" icon={<SuccessIcon />} sx={{ mb: 2 }} data-testid="data-export-success">
                  {t('summary.success')}
                </Alert>
              )}

              {exportStatus.error && (
                <Alert severity="error" icon={<ErrorIcon />} sx={{ mb: 2 }}>
                  {t('summary.error', { message: exportStatus.error })}
                </Alert>
              )}

              <Alert severity="info">
                <Typography variant="body2">
                  <strong>{t('summary.privacyNoteTitle')}</strong> {t('summary.privacyNoteBody')}
                </Typography>
              </Alert>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default DataExportPanel;
