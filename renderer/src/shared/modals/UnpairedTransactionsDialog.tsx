import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import ModalHeader from './ModalHeader';
import { apiClient } from '@/lib/api-client';

interface UnpairedTransaction {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  categoryId: number;
  categoryName: string;
  accountNumber: string | null;
}

interface UnpairedTransactionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UnpairedTransactionsDialog({
  isOpen,
  onClose
}: UnpairedTransactionsDialogProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'unpairedTransactions' });
  const [transactions, setTransactions] = useState<UnpairedTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchUnpairedTransactions();
    }
  }, [isOpen, t]);

  const fetchUnpairedTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/api/accounts/truly-unpaired-transactions?include_details=true');
      if (!response.ok) {
        setError(response.statusText || t('errors.loadFailed'));
        return;
      }
      const data = response.data as any;
      setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch (err) {
      console.error('Error fetching unpaired transactions:', err);
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  const getVendorDisplayName = (vendor: string) => {
    const vendorNames: Record<string, string> = {
      hapoalim: 'Bank Hapoalim',
      leumi: 'Bank Leumi',
      discount: 'Discount Bank',
      mizrahi: 'Mizrahi-Tefahot',
      beinleumi: 'Bank Beinleumi',
      union: 'Union Bank',
      yahav: 'Bank Yahav',
      otsarHahayal: 'Otsar Hahayal',
      mercantile: 'Mercantile Discount',
      massad: 'Bank Massad'
    };
    return vendorNames[vendor] || vendor;
  };

  const groupedByVendor = transactions.reduce((acc, txn) => {
    if (!acc[txn.vendor]) {
      acc[txn.vendor] = [];
    }
    acc[txn.vendor].push(txn);
    return acc;
  }, {} as Record<string, UnpairedTransaction[]>);

  return (
    <Dialog open={isOpen} onClose={onClose} maxWidth="lg" fullWidth>
      <ModalHeader
        title={t('title')}
        onClose={onClose}
      />

      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : transactions.length === 0 ? (
          <Alert severity="success">
            {t('alerts.allMatched')}
          </Alert>
        ) : (
          <>
            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2">
                {t('alerts.unmatchedInfo', { count: transactions.length })}
              </Typography>
            </Alert>

            {Object.entries(groupedByVendor).map(([vendor, txns]) => (
              <Box key={vendor} sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                  <Typography variant="h6">
                    {getVendorDisplayName(vendor)}
                  </Typography>
                  <Chip label={t('labels.transactionCount', { count: txns.length })} size="small" color="warning" />
                </Box>

                <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('table.date')}</TableCell>
                        <TableCell>{t('table.name')}</TableCell>
                        <TableCell>{t('table.account')}</TableCell>
                        <TableCell align="right">{t('table.amount')}</TableCell>
                        <TableCell>{t('table.category')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {txns.map((txn) => (
                        <TableRow key={txn.identifier} hover>
                          <TableCell>
                            {new Date(txn.date).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {txn.name}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                              {txn.accountNumber || t('table.notAvailable')}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                color: txn.price < 0 ? 'error.main' : 'success.main',
                                fontWeight: 600
                              }}
                            >
                              ₪{Math.abs(txn.price).toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={txn.categoryName || t('table.idLabel', { id: txn.categoryId })}
                              size="small"
                              color={txn.categoryId === 25 ? 'primary' : 'success'}
                              variant="outlined"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            ))}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
