import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type {
  PendingPikadonSetup,
  PikadonDetailsInput,
} from '@renderer/types/investments';
import { getPikadonCandidateKey } from './pikadon-linking';

export interface PikadonSetupItem extends PendingPikadonSetup {
  id?: number;
  current_value?: number | null;
  status?: string;
  maturity_date?: string | null;
  interest_rate?: number | null;
  notes?: string | null;
}

interface PikadonSetupDialogProps {
  open: boolean;
  title: string;
  items: PikadonSetupItem[];
  loading?: boolean;
  saveLabel?: string;
  helperText?: string;
  onClose: () => void;
  onSubmit: (detailsByKey: Record<string, PikadonDetailsInput>) => Promise<void> | void;
}

function buildInitialState(items: PikadonSetupItem[]): Record<string, PikadonDetailsInput> {
  return items.reduce<Record<string, PikadonDetailsInput>>((acc, item) => {
    acc[getPikadonCandidateKey(item)] = {
      maturity_date: item.maturity_date || '',
      interest_rate: item.interest_rate ?? null,
      notes: item.notes ?? '',
    };
    return acc;
  }, {});
}

export default function PikadonSetupDialog({
  open,
  title,
  items,
  loading = false,
  saveLabel = 'Save',
  helperText,
  onClose,
  onSubmit,
}: PikadonSetupDialogProps) {
  const [formState, setFormState] = useState<Record<string, PikadonDetailsInput>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormState(buildInitialState(items));
      setError(null);
    }
  }, [items, open]);

  const hasMultipleItems = items.length > 1;
  const dialogHelperText = useMemo(() => {
    if (helperText) return helperText;
    if (hasMultipleItems) {
      return 'Add maturity details for each pikadon before linking.';
    }
    return 'Maturity date is required before this pikadon can be linked.';
  }, [hasMultipleItems, helperText]);

  const updateField = (item: PikadonSetupItem, field: keyof PikadonDetailsInput, value: string) => {
    const key = getPikadonCandidateKey(item);
    setFormState((current) => ({
      ...current,
      [key]: {
        maturity_date: current[key]?.maturity_date || '',
        interest_rate: current[key]?.interest_rate ?? null,
        notes: current[key]?.notes ?? '',
        [field]: field === 'interest_rate'
          ? (value === '' ? null : Number(value))
          : value,
      },
    }));
  };

  const handleSubmit = async () => {
    const missingItem = items.find((item) => !formState[getPikadonCandidateKey(item)]?.maturity_date);
    if (missingItem) {
      setError('Maturity date is required for every pikadon.');
      return;
    }

    setError(null);
    await onSubmit(formState);
  };

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info">{dialogHelperText}</Alert>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {items.map((item, index) => {
            const formValue = formState[getPikadonCandidateKey(item)] || {
              maturity_date: '',
              interest_rate: null,
              notes: '',
            };

            return (
              <Box
                key={getPikadonCandidateKey(item)}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                }}
              >
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600}>
                      {item.transaction_name || item.account_name || 'Pikadon'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {item.account_name ? `${item.account_name} • ` : ''}
                      {item.deposit_date} • ILS {item.principal.toLocaleString()}
                    </Typography>
                  </Box>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        fullWidth
                        label="Maturity date"
                        type="date"
                        value={formValue.maturity_date}
                        onChange={(event) => updateField(item, 'maturity_date', event.target.value)}
                        InputLabelProps={{ shrink: true }}
                        required
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        fullWidth
                        label="Interest rate (%)"
                        type="number"
                        value={formValue.interest_rate ?? ''}
                        onChange={(event) => updateField(item, 'interest_rate', event.target.value)}
                        inputProps={{ min: 0, step: 0.01 }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        fullWidth
                        label="Status"
                        value={item.status || 'pending'}
                        InputProps={{ readOnly: true }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        label="Notes"
                        value={formValue.notes || ''}
                        onChange={(event) => updateField(item, 'notes', event.target.value)}
                        multiline
                        minRows={2}
                      />
                    </Grid>
                  </Grid>
                </Stack>
                {index < items.length - 1 ? <Divider sx={{ mt: 2 }} /> : null}
              </Box>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button onClick={() => void handleSubmit()} variant="contained" disabled={loading}>
          {saveLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
