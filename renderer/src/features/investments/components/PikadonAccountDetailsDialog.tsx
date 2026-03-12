import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { apiClient } from '@/lib/api-client';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import type {
  InvestmentAccountSummary,
  PendingPikadonSetup,
  PikadonDetailsInput,
  PikadonHolding,
  PikadonListResponse,
} from '@renderer/types/investments';
import PikadonSetupDialog, { PikadonSetupItem } from './PikadonSetupDialog';
import { getPikadonCandidateKey } from './pikadon-linking';

interface PikadonAccountDetailsDialogProps {
  open: boolean;
  account: InvestmentAccountSummary | null;
  onClose: () => void;
}

function formatCurrency(value?: number | null): string {
  return `ILS ${(value || 0).toLocaleString()}`;
}

export default function PikadonAccountDetailsDialog({
  open,
  account,
  onClose,
}: PikadonAccountDetailsDialogProps) {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pikadon, setPikadon] = useState<PikadonHolding[]>([]);
  const [pendingSetup, setPendingSetup] = useState<PendingPikadonSetup[]>([]);
  const [editingItems, setEditingItems] = useState<PikadonSetupItem[] | null>(null);

  const loadDetails = useCallback(async () => {
    if (!account?.id) {
      setPikadon([]);
      setPendingSetup([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<PikadonListResponse>(
        `/api/investments/pikadon?accountId=${account.id}&includeTransactions=true`,
      );
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to load pikadon details');
      }

      const payload = response.data as PikadonListResponse;
      setPikadon(Array.isArray(payload.pikadon) ? payload.pikadon : []);
      setPendingSetup(Array.isArray(payload.pending_setup) ? payload.pending_setup : []);
    } catch (fetchError) {
      console.error('Failed to load pikadon details', fetchError);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load pikadon details');
    } finally {
      setLoading(false);
    }
  }, [account?.id]);

  useEffect(() => {
    if (open) {
      void loadDetails();
    }
  }, [loadDetails, open]);

  const hasContent = pikadon.length > 0 || pendingSetup.length > 0;
  const dialogTitle = useMemo(() => {
    if (!account) return 'Pikadon details';
    return `${account.account_name} pikadon`;
  }, [account]);

  const handlePendingSetupSave = async (detailsByKey: Record<string, PikadonDetailsInput>) => {
    if (!account?.id || !editingItems?.length) {
      return;
    }

    setSaving(true);
    try {
      for (const item of editingItems) {
        if ('id' in item && item.id) {
          const details = detailsByKey[getPikadonCandidateKey(item)];
          const updateResponse = await apiClient.put(`/api/investments/pikadon/${item.id}`, details);
          if (!updateResponse.ok) {
            throw new Error(updateResponse.statusText || 'Failed to update pikadon');
          }
          continue;
        }

        const details = detailsByKey[getPikadonCandidateKey(item)];
        const linkResponse = await apiClient.post('/api/investments/transaction-links', {
          transaction_identifier: item.transaction_identifier,
          transaction_vendor: item.transaction_vendor,
          account_id: item.account_id,
          link_method: 'manual',
          confidence: 1,
          pikadon_details: details,
        });
        if (!linkResponse.ok) {
          throw new Error(linkResponse.statusText || 'Failed to complete pikadon setup');
        }
      }

      showNotification('Pikadon details saved', 'success');
      setEditingItems(null);
      await loadDetails();
      window.dispatchEvent(new CustomEvent('dataRefresh'));
    } catch (saveError) {
      console.error('Failed to save pikadon details', saveError);
      showNotification(
        saveError instanceof Error ? saveError.message : 'Failed to save pikadon details',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="lg" fullWidth>
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent dividers>
          {loading ? (
            <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : !hasContent ? (
            <Alert severity="info">No pikadon entries or pending setup items were found for this account.</Alert>
          ) : (
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Active entries
                </Typography>
                {pikadon.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No pikadon entries have been created yet.
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Principal</TableCell>
                        <TableCell>Current value</TableCell>
                        <TableCell>Maturity</TableCell>
                        <TableCell>Rate</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Linked transaction</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pikadon.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{formatCurrency(item.cost_basis)}</TableCell>
                          <TableCell>{formatCurrency(item.current_value)}</TableCell>
                          <TableCell>{item.maturity_date || 'Missing'}</TableCell>
                          <TableCell>{item.interest_rate != null ? `${item.interest_rate}%` : '—'}</TableCell>
                          <TableCell>
                            <Chip size="small" label={item.status} />
                          </TableCell>
                          <TableCell>{item.deposit_transaction_id || '—'}</TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              onClick={() => setEditingItems([{
                                ...item,
                                transaction_identifier: item.deposit_transaction_id || `pikadon-${item.id}`,
                                transaction_vendor: item.deposit_transaction_vendor || 'unknown',
                                principal: item.cost_basis,
                                deposit_date: item.as_of_date,
                                transaction_name: item.account_name || item.deposit_transaction_id || 'Pikadon',
                              }])}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>

              {pendingSetup.length > 0 ? (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      Pending setup
                    </Typography>
                    <Stack spacing={1.5}>
                      {pendingSetup.map((item) => (
                        <Box
                          key={getPikadonCandidateKey(item)}
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            border: (theme) => `1px solid ${theme.palette.divider}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 2,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <Box>
                            <Typography variant="body2" fontWeight={600}>
                              {item.transaction_name || 'Pikadon deposit'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {item.deposit_date} • {formatCurrency(item.principal)}
                            </Typography>
                          </Box>
                          <Button size="small" variant="outlined" onClick={() => setEditingItems([item])}>
                            Complete setup
                          </Button>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                </>
              ) : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Close</Button>
        </DialogActions>
      </Dialog>

      <PikadonSetupDialog
        open={Boolean(editingItems?.length)}
        title={editingItems?.[0]?.id ? 'Edit pikadon details' : 'Complete pikadon setup'}
        items={editingItems || []}
        loading={saving}
        saveLabel={editingItems?.[0]?.id ? 'Update' : 'Save and link'}
        onClose={() => setEditingItems(null)}
        onSubmit={handlePendingSetupSave}
      />
    </>
  );
}
