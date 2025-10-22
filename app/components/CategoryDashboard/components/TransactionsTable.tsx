import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableRow, Paper, Box, Typography, IconButton, TextField, Autocomplete } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useFinancePrivacy } from '../../../contexts/FinancePrivacyContext';
import { dateUtils } from '../utils/dateUtils';
import { CategorizedExpense, CategoryOption } from '../types';

type Transaction = CategorizedExpense;

interface TransactionsTableProps {
  transactions: Transaction[];
  isLoading?: boolean;
  onDelete?: (transaction: Transaction) => void;
  onUpdate?: (transaction: Transaction, newPrice: number, newCategory?: CategoryOption) => void;
}

const TransactionsTable: React.FC<TransactionsTableProps> = ({ transactions, isLoading, onDelete, onUpdate }) => {
  const [editingTransaction, setEditingTransaction] = React.useState<Transaction | null>(null);
  const [editPrice, setEditPrice] = React.useState<string>('');
  const [editCategoryId, setEditCategoryId] = React.useState<number | null>(null);
  const [initialCategoryId, setInitialCategoryId] = React.useState<number | null>(null);
  const [availableCategories, setAvailableCategories] = React.useState<CategoryOption[]>([]);
  const { formatCurrency } = useFinancePrivacy();

  const formatCurrencyValue = (
    value: number,
    options?: { absolute?: boolean; minimumFractionDigits?: number; maximumFractionDigits?: number }
  ) =>
    formatCurrency(value, {
      minimumFractionDigits: options?.minimumFractionDigits ?? 2,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
      ...(options?.absolute ? { absolute: true } : {}),
    });

  // Fetch available categories when component mounts
  React.useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch('/api/get_all_categories');
        if (!response.ok) return;
        const raw = await response.json();
        const categories: CategoryOption[] = Array.isArray(raw)
          ? raw.map((cat: any) => ({
              id: cat.id,
              name: cat.name,
              nameEn: cat.name_en ?? cat.nameEn ?? null,
              categoryType: cat.category_type ?? cat.categoryType,
              parentId: cat.parent_id ?? cat.parentId ?? null,
              parentName: cat.parent_name ?? cat.parentName ?? null,
              parentNameEn: cat.parent_name_en ?? cat.parentNameEn ?? null,
            }))
          : [];
        setAvailableCategories(categories);
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };
    fetchCategories();
  }, []);

  const handleEditClick = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditPrice(Math.abs(transaction.price).toString());
    setEditCategoryId(transaction.category_definition_id ?? null);
    setInitialCategoryId(transaction.category_definition_id ?? null);
  };

  const handleSaveClick = () => {
    if (editingTransaction && editPrice) {
      const newPrice = parseFloat(editPrice);
      if (!isNaN(newPrice)) {
        const priceWithSign = editingTransaction.price < 0 ? -newPrice : newPrice;
        const selectedCategory = editCategoryId !== null
          ? availableCategories.find((cat) => cat.id === editCategoryId) ?? null
          : null;
        const categoryChanged = editCategoryId !== initialCategoryId;
        const hasPriceChange = priceWithSign !== editingTransaction.price;

        if (!hasPriceChange && !categoryChanged) {
          setEditingTransaction(null);
          setInitialCategoryId(null);
          setEditCategoryId(null);
          return;
        }

        onUpdate?.(
          editingTransaction,
          priceWithSign,
          categoryChanged ? selectedCategory ?? undefined : undefined
        );
        setEditingTransaction(null);
        setInitialCategoryId(null);
        setEditCategoryId(null);
      }
    }
  };

  const handleCancelClick = () => {
    setEditingTransaction(null);
    setInitialCategoryId(null);
    setEditCategoryId(null);
  };

  const handleRowClick = (transaction: Transaction) => {
    // If clicking on a different row while editing, save the current changes
    if (editingTransaction && editingTransaction.identifier !== transaction.identifier) {
      handleSaveClick();
    }
  };

  const handleTableClick = (e: React.MouseEvent) => {
    // If clicking on the table background (not on a row), save current changes
    if (editingTransaction && (e.target as HTMLElement).tagName === 'TABLE') {
      handleSaveClick();
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
        <Typography>Loading transactions...</Typography>
      </Box>
    );
  }

  if (!transactions || transactions.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
        <Typography>No transactions found</Typography>
      </Box>
    );
  }

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden', borderRadius: '16px' }}>
      <Table
        onClick={handleTableClick}
      >
        <TableHead>
          <TableRow>
            <TableCell style={{ color: '#555', borderBottom: '1px solid #e2e8f0' }}>Description</TableCell>
            <TableCell style={{ color: '#555', borderBottom: '1px solid #e2e8f0' }}>Category</TableCell>
            <TableCell style={{ color: '#555', borderBottom: '1px solid #e2e8f0' }}>Card</TableCell>
            <TableCell align="right" style={{ color: '#555', borderBottom: '1px solid #e2e8f0' }}>Amount</TableCell>
            <TableCell style={{ color: '#555', borderBottom: '1px solid #e2e8f0' }}>Date</TableCell>
            <TableCell align="right" style={{ color: '#555', borderBottom: '1px solid #e2e8f0' }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {transactions.map((transaction, index) => (
            <TableRow 
              key={index}
              onClick={() => handleRowClick(transaction)}
              style={{ cursor: 'pointer' }}
            >
              <TableCell style={{ color: '#333', borderBottom: '1px solid #e2e8f0' }}>
                {transaction.name}
              </TableCell>
              <TableCell style={{ color: '#333', borderBottom: '1px solid #e2e8f0' }}>
                {editingTransaction?.identifier === transaction.identifier ? (
                  <Autocomplete<CategoryOption>
                    value={
                      editCategoryId !== null
                        ? availableCategories.find((cat) => cat.id === editCategoryId) ?? null
                        : null
                    }
                    onChange={(event, newValue) => setEditCategoryId(newValue ? newValue.id : null)}
                    options={availableCategories}
                    size="small"
                    sx={{
                      minWidth: 150,
                      '& .MuiOutlinedInput-root': {
                        '& fieldset': {
                          borderColor: '#e2e8f0',
                        },
                        '&:hover fieldset': {
                          borderColor: '#3b82f6',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#3b82f6',
                        },
                      },
                    }}
                    getOptionLabel={(option) =>
                      option.parentName ? `${option.parentName} › ${option.name}` : option.name
                    }
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder="Select category..."
                        sx={{
                          '& .MuiInputBase-input': {
                            fontSize: '14px',
                            padding: '8px 12px',
                          },
                        }}
                      />
                    )}
                  />
                ) : (
                  <span
                    style={{
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      transition: 'all 0.2s ease-in-out',
                      display: 'inline-block',
                      minWidth: '60px',
                      textAlign: 'center',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      color: '#3b82f6',
                      fontWeight: '500',
                      fontSize: '13px'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRowClick(transaction);
                      handleEditClick(transaction);
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
                      e.currentTarget.style.transform = 'scale(1.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    {transaction.category}
                  </span>
                )}
              </TableCell>
              <TableCell style={{ color: '#666', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                {transaction.account_number ? (
                  <span style={{
                    backgroundColor: 'rgba(156, 163, 175, 0.1)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontWeight: '500'
                  }}>
                    ****{transaction.account_number}
                  </span>
                ) : (
                  <span style={{ color: '#9ca3af' }}>-</span>
                )}
              </TableCell>
              <TableCell 
                align="right" 
                style={{ 
                  color: transaction.price < 0 ? '#F87171' : '#4ADE80',
                  borderBottom: '1px solid #e2e8f0'
                }}
              >
                {editingTransaction?.identifier === transaction.identifier ? (
                  <TextField
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    size="small"
                    type="number"
                    inputProps={{ 
                      style: { 
                        textAlign: 'right',
                        color: transaction.price < 0 ? '#F87171' : '#4ADE80'
                      } 
                    }}
                    sx={{ 
                      width: '100px',
                      '& .MuiOutlinedInput-root': {
                        '& fieldset': {
                          borderColor: transaction.price < 0 ? '#F87171' : '#4ADE80',
                        },
                      },
                    }}
                  />
                ) : (
                  formatCurrencyValue(transaction.price, { absolute: true })
                )}
              </TableCell>
              <TableCell style={{ color: '#333', borderBottom: '1px solid #e2e8f0' }}>
                {dateUtils.formatDate(transaction.date)}
              </TableCell>
              <TableCell align="right" style={{ borderBottom: '1px solid #e2e8f0' }}>
                {editingTransaction?.identifier === transaction.identifier ? (
                  <>
                    <IconButton 
                      onClick={handleSaveClick}
                      sx={{ color: '#4ADE80' }}
                    >
                      <CheckIcon />
                    </IconButton>
                    <IconButton 
                      onClick={handleCancelClick}
                      sx={{ color: '#ef4444' }}
                    >
                      <CloseIcon />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRowClick(transaction);
                        handleEditClick(transaction);
                      }}
                      sx={{ color: '#3b82f6' }}
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton 
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(transaction);
                      }}
                      sx={{ color: '#ef4444' }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
};

export default TransactionsTable; 
