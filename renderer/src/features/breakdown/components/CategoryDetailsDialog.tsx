import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Grid,
  Card,
  CardContent,
  Typography,
  Chip,
  Box,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import InstitutionBadge from '@renderer/shared/components/InstitutionBadge';
import { CategoryDetails, CategoryType, FormatCurrencyFn } from '../types';
import { isPendingTransaction } from '../utils';
import { getBreakdownStrings } from '../strings';

interface CategoryDetailsDialogProps {
  open: boolean;
  details: CategoryDetails | null;
  onClose: () => void;
  breadcrumbs: React.ReactNode;
  categoryType: CategoryType;
  formatCurrencyValue: FormatCurrencyFn;
  onSubcategoryClick: (subcategoryId: number, subcategoryName: string) => void;
}

const CategoryDetailsDialog: React.FC<CategoryDetailsDialogProps> = ({
  open,
  details,
  onClose,
  breadcrumbs,
  categoryType,
  formatCurrencyValue,
  onSubcategoryClick,
}) => {
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const generalStrings = strings.general;

  if (!details) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>{breadcrumbs}</Box>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
      </Dialog>
    );
  }

  const transactions = details.transactions ?? [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>{breadcrumbs}</Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {generalStrings.total}{' '}
                    {categoryType === 'income'
                      ? generalStrings.income
                      : categoryType === 'investment'
                      ? generalStrings.invested
                      : generalStrings.spent}
                  </Typography>
                  <Typography
                    variant="h6"
                    fontWeight="bold"
                    color={categoryType === 'income' ? 'success.main' : undefined}
                  >
                    {formatCurrencyValue(details.summary.total)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {generalStrings.transactions}
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {details.summary.count}
                  </Typography>
                  {(() => {
                    const pendingCount = transactions.filter(txn => isPendingTransaction(txn)).length;
                    const processedCount = transactions.length - pendingCount;
                    if (pendingCount > 0) {
                      return (
                        <Typography variant="caption" color="text.secondary">
                          {strings.categoryDetails.processedBreakdown(processedCount, pendingCount)}
                        </Typography>
                      );
                    }
                    return null;
                  })()}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {generalStrings.average}
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {formatCurrencyValue(details.summary.average)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {details.subcategories && details.subcategories.length > 0 && (
            <>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                {generalStrings.subcategories}
              </Typography>
              <Grid container spacing={1} sx={{ mb: 3 }}>
                {details.subcategories.map(sub => (
                  <Grid item xs={12} key={sub.id}>
                    <Box
                      sx={{
                        p: 2,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 1,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': {
                          backgroundColor: theme.palette.action.hover,
                          transform: 'translateX(4px)',
                        },
                      }}
                      onClick={() => onSubcategoryClick(sub.id, sub.name)}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {sub.name}
                        </Typography>
                        <Chip
                          label={`${sub.count} ${generalStrings.transactions}`}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight="bold">
                          {formatCurrencyValue(sub.total)}
                        </Typography>
                        <ChevronRightIcon color="action" />
                      </Box>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          {details.byVendor && details.byVendor.length > 0 && (
            <>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                {generalStrings.vendors}
              </Typography>
              <Grid container spacing={1} sx={{ mb: 3 }}>
                {details.byVendor.map((vendor, index) => (
                  <Grid item xs={6} key={`${vendor.vendor}-${index}`}>
                    <Box
                      sx={{
                        p: 1,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 1,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <InstitutionBadge institution={vendor.institution} fallback={vendor.vendor} />
                      </Box>
                      <Typography variant="body2" fontWeight="bold">
                        {formatCurrencyValue(vendor.total)}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          {details.byCard && details.byCard.length > 0 && (
            <>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                {generalStrings.cards}
              </Typography>
              <Grid container spacing={1} sx={{ mb: 3 }}>
                {details.byCard.map((card, index) => (
                  <Grid item xs={6} key={`${card.accountNumber}-${index}`}>
                    <Box
                      sx={{
                        p: 1,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 1,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Box>
                        <Typography variant="body2" fontWeight="medium" sx={{ fontFamily: 'monospace' }}>
                          ****{card.accountNumber}
                        </Typography>
                        <InstitutionBadge institution={card.institution} fallback={card.vendor} />
                      </Box>
                      <Typography variant="body2" fontWeight="bold">
                        {formatCurrencyValue(card.total)}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            {generalStrings.recentTransactions}
          </Typography>
          <List dense>
            {transactions.map((txn, index) => {
              const pending = isPendingTransaction(txn);
              const transactionKey = txn.identifier ?? txn.id ?? `${txn.vendor}-${index}`;
              const processedDate = txn.processedDate || txn.processed_date;
              const accountNumber = txn.account_number || txn.accountNumber;
              return (
                <React.Fragment key={transactionKey}>
                  <ListItem
                    sx={{
                      opacity: pending ? 0.6 : 1,
                      bgcolor: pending ? 'rgba(237, 108, 2, 0.05)' : 'transparent',
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">{txn.name || txn.vendor}</Typography>
                          {pending && (
                            <Chip
                              icon={<HourglassEmptyIcon sx={{ fontSize: 14 }} />}
                              label={generalStrings.pendingBadge}
                              size="small"
                              color="warning"
                              sx={{
                                fontSize: '0.7rem',
                                height: 20,
                              }}
                            />
                          )}
                          {accountNumber && (
                            <Chip
                              label={`****${accountNumber}`}
                              size="small"
                              variant="outlined"
                              sx={{
                                fontSize: '0.7rem',
                                height: 20,
                                fontFamily: 'monospace',
                                backgroundColor: 'rgba(156, 163, 175, 0.1)',
                              }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                          <Typography variant="caption" color="text.secondary">
                            {new Date(txn.date).toLocaleDateString()}
                          </Typography>
                          {pending && processedDate && (
                            <>
                              <Typography variant="caption" color="text.secondary">
                                •
                              </Typography>
                              <Typography variant="caption" color="warning.main">
                                {`${generalStrings.processedDatePrefix}: ${new Date(processedDate).toLocaleDateString()}`}
                              </Typography>
                            </>
                          )}
                          {(txn.institution || txn.vendor) && (
                            <>
                              <Typography variant="caption" color="text.secondary">
                                •
                              </Typography>
                              <InstitutionBadge institution={txn.institution} fallback={txn.vendor} />
                            </>
                          )}
                        </Box>
                      }
                      secondaryTypographyProps={{ component: 'span' }}
                    />
                    <Typography
                      variant="body2"
                      fontWeight="bold"
                      color={categoryType === 'income' ? 'success.main' : undefined}
                    >
                      {formatCurrencyValue(Math.abs(txn.price))}
                    </Typography>
                  </ListItem>
                  {index < transactions.length - 1 && <Divider />}
                </React.Fragment>
              );
            })}
          </List>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default CategoryDetailsDialog;
