import React, { useState } from 'react';
import {
  Box,
  Button,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { endOfDay, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDashboardFilters } from '../DashboardFiltersContext';

interface DashboardPeriodSelectorProps {
  sx?: SxProps<Theme>;
}

const DashboardPeriodSelector: React.FC<DashboardPeriodSelectorProps> = ({ sx }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'dashboardPeriod' });
  const {
    startDate,
    endDate,
    setDateRange,
    periodPreset,
    setPeriodPreset,
  } = useDashboardFilters();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [draftStartDate, setDraftStartDate] = useState<Date | null>(startDate);
  const [draftEndDate, setDraftEndDate] = useState<Date | null>(endDate);

  const openCustomRange = (target: HTMLElement) => {
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setAnchorEl(target);
  };

  const closeCustomRange = () => setAnchorEl(null);
  const hasValidRange = Boolean(
    draftStartDate
      && draftEndDate
      && draftStartDate.getTime() <= draftEndDate.getTime(),
  );

  const applyCustomRange = () => {
    if (!draftStartDate || !draftEndDate || !hasValidRange) return;
    setDateRange(startOfDay(draftStartDate), endOfDay(draftEndDate));
    closeCustomRange();
  };

  return (
    <>
      <ToggleButtonGroup
        value={periodPreset}
        exclusive
        onChange={(event, newPeriod) => {
          if (newPeriod === 'mtd' || newPeriod === '30d') {
            setPeriodPreset(newPeriod);
          } else if (newPeriod === 'custom') {
            openCustomRange(event.currentTarget);
          }
        }}
        size="small"
        aria-label={t('ariaLabel')}
        sx={sx}
      >
        <ToggleButton value="mtd">{t('mtd')}</ToggleButton>
        <ToggleButton value="30d">{t('last30')}</ToggleButton>
        <ToggleButton
          value="custom"
          onClick={(event) => {
            if (periodPreset === 'custom') {
              openCustomRange(event.currentTarget);
            }
          }}
        >
          {t('custom')}
        </ToggleButton>
      </ToggleButtonGroup>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={closeCustomRange}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              p: 2,
              borderRadius: 2,
              width: { xs: 280, sm: 360 },
            },
          },
        }}
      >
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <DatePicker
              label={t('startDate')}
              value={draftStartDate}
              onChange={setDraftStartDate}
              disableFuture
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            <DatePicker
              label={t('endDate')}
              value={draftEndDate}
              onChange={setDraftEndDate}
              disableFuture
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button size="small" onClick={closeCustomRange}>
                {t('cancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={!hasValidRange}
                onClick={applyCustomRange}
              >
                {t('apply')}
              </Button>
            </Box>
          </Box>
        </LocalizationProvider>
      </Popover>
    </>
  );
};

export default DashboardPeriodSelector;
