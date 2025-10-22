import React from 'react';
import IconButton from '@mui/material/IconButton';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import TableChartIcon from '@mui/icons-material/TableChart';
import RefreshIcon from '@mui/icons-material/Refresh';
import Button from '@mui/material/Button';
import { CategorySummary, Expense, ModalData, CategorizedExpense, CategoryOption } from './types';
import { BANK_CATEGORY_NAME } from '../../lib/category-constants';
import { useCategoryIcons, useCategoryColors } from './utils/categoryUtils';
import Card from './components/Card';
import ExpensesModal from './components/ExpensesModal';
import MetricsPanel from './components/MetricsPanel';
import TransactionsTable from './components/TransactionsTable';
import SavingsRateCard from './components/SavingsRateCard';
import AlertBanner from './components/AlertBanner';

const CategoryDashboard: React.FC = () => {
  const [sumPerCategory, setSumPerCategory] = React.useState<CategorySummary[]>([]);
  const [selectedYear, setSelectedYear] = React.useState<string>("");
  const [selectedMonth, setSelectedMonth] = React.useState<string>("");
  const [uniqueYears, setUniqueYears] = React.useState<string[]>([]);
  const [uniqueMonths, setUniqueMonths] = React.useState<string[]>([]);
  const [bankTransactions, setBankTransactions] = React.useState({ income: 0, expenses: 0 });
  const [creditCardTransactions, setCreditCardTransactions] = React.useState(0);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [loadingCategory, setLoadingCategory] = React.useState<number | null>(null);
  const [loadingBankTransactions, setLoadingBankTransactions] = React.useState(false);
  const [modalData, setModalData] = React.useState<ModalData>();
  const [showTransactionsTable, setShowTransactionsTable] = React.useState(false);
  const [transactions, setTransactions] = React.useState<CategorizedExpense[]>([]);
  const [loadingTransactions, setLoadingTransactions] = React.useState(false);
  const categoryIcons = useCategoryIcons();
  const categoryColors = useCategoryColors();
  const [allAvailableDates, setAllAvailableDates] = React.useState<string[]>([]);

  const getDisplayCategory = React.useCallback((transaction: Expense | CategorizedExpense) =>
    transaction.resolved_category_name ||
    transaction.category_name ||
    transaction.category ||
    transaction.legacy_category ||
    null,
  []);

  const getBankCategoryId = React.useCallback((transactions: Expense[]) => {
    const match = transactions.find((transaction) =>
      transaction.category_definition_id &&
      getDisplayCategory(transaction) === BANK_CATEGORY_NAME
    );
    return match?.category_definition_id || null;
  }, [getDisplayCategory]);

  const isBankTransaction = React.useCallback((transaction: Expense, bankCategoryId: number | null) => (
    bankCategoryId
      ? transaction.category_definition_id === bankCategoryId
      : getDisplayCategory(transaction) === BANK_CATEGORY_NAME
  ), [getDisplayCategory]);
  const [uncategorizedCount, setUncategorizedCount] = React.useState<number>(0);

  // Use refs to store current values for the event listener
  const currentYearRef = React.useRef(selectedYear);
  const currentMonthRef = React.useRef(selectedMonth);

  // Update refs when values change
  React.useEffect(() => {
    currentYearRef.current = selectedYear;
    currentMonthRef.current = selectedMonth;
  }, [selectedYear, selectedMonth]);

  const handleDataRefresh = React.useCallback(() => {
    console.log('handleDataRefresh called with:', { 
      selectedYear: currentYearRef.current, 
      selectedMonth: currentMonthRef.current 
    });
    // Only refresh if we have valid year and month values
    if (currentYearRef.current && currentMonthRef.current && 
        currentYearRef.current !== '' && currentMonthRef.current !== '') {
      console.log('Calling fetchData with:', `${currentYearRef.current}-${currentMonthRef.current}`);
      // Use setTimeout to ensure fetchData is available
      setTimeout(() => {
        fetchData(`${currentYearRef.current}-${currentMonthRef.current}`);
      }, 0);
    } else {
      console.log('Invalid year or month values, skipping refresh');
    }
  }, []);

  React.useEffect(() => {
    getAvailableMonths();

    // Add event listener for data refresh
    window.addEventListener('dataRefresh', handleDataRefresh);

    // Cleanup
    return () => {
      window.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, []);

  React.useEffect(() => {
    if (showTransactionsTable) {
      fetchTransactions();
    }
  }, [selectedYear, selectedMonth]);

  const getAvailableMonths = async () => {
    try {
      const response = await fetch("/api/available_months");
      const transactionsData = await response.json();
      setAllAvailableDates(transactionsData);
      
      // Sort dates in descending order to get the most recent first
      const sortedDates = transactionsData.sort((a: string, b: string) => b.localeCompare(a));
      const lastDate = sortedDates[0];
      
      const years = Array.from(new Set(transactionsData.map((date: string) => date.substring(0, 4)))) as string[];
      const lastYear = lastDate.substring(0, 4);
      
      setUniqueYears(years);
      setSelectedYear(lastYear);

      // Get months for the last year
      const monthsForLastYear = transactionsData
        .filter((date: string) => date.startsWith(lastYear))
        .map((date: string) => date.substring(5, 7));
      
      const months = Array.from(new Set(monthsForLastYear)) as string[];
      const lastMonth = lastDate.substring(5, 7);
      
      setUniqueMonths(months);
      setSelectedMonth(lastMonth);

      // Fetch data for initial selection
      fetchData(`${lastYear}-${lastMonth}`);
    } catch (error) {
      console.error("Error:", error);
    }
  };

  const handleYearChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = event.target.value;
    setSelectedYear(newYear);

    // Update available months for the selected year
    const monthsForYear = allAvailableDates
      .filter((date: string) => date.startsWith(newYear))
      .map((date: string) => date.substring(5, 7));
    
    const uniqueMonthsForYear = Array.from(new Set(monthsForYear)) as string[];
    setUniqueMonths(uniqueMonthsForYear);
    
    // If current month is not available in new year, select the first available month
    if (!uniqueMonthsForYear.includes(selectedMonth)) {
      setSelectedMonth(uniqueMonthsForYear[0]);
      fetchData(`${newYear}-${uniqueMonthsForYear[0]}`);
    } else {
      fetchData(`${newYear}-${selectedMonth}`);
    }
  };

  const handleMonthChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newMonth = event.target.value;
    setSelectedMonth(newMonth);
    fetchData(`${selectedYear}-${newMonth}`);
  };

  const handleRefreshClick = () => {
    if (selectedYear && selectedMonth) {
      const currentMonth = `${selectedYear}-${selectedMonth}`;
      fetchData(currentMonth);
      if (showTransactionsTable) {
        fetchTransactions();
      }
    }
  };

  const fetchData = async (month: string) => {
    try {
      const url = new URL("/api/month_by_categories", window.location.origin);
      const params = new URLSearchParams();
      params.append("month", month);
      url.search = params.toString();

      const response = await fetch(url.toString(), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: CategorySummary[] = await response.json();
      setSumPerCategory(data);
      
      // Fetch all transactions to calculate income and expenses properly
      const allTransactionsURL = new URL("/api/category_expenses", window.location.origin);
      const allTransactionsParams = new URLSearchParams();
      allTransactionsParams.append("month", month);
      allTransactionsParams.append("all", "true");
      allTransactionsURL.search = allTransactionsParams.toString();
      
      const allTransactionsResponse = await fetch(allTransactionsURL.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!allTransactionsResponse.ok) {
        throw new Error(`HTTP error! status: ${allTransactionsResponse.status}`);
      }

      const allTransactions: Expense[] = await allTransactionsResponse.json();

      const bankCategoryId = getBankCategoryId(allTransactions);

      const bankTransactionsList = allTransactions.filter((transaction) =>
        isBankTransaction(transaction, bankCategoryId)
      );
      const totalBankIncome = bankTransactionsList
        .filter((transaction) => transaction.price > 0)
        .reduce((acc, transaction) => acc + transaction.price, 0);

      const totalBankExpenses = bankTransactionsList
        .filter((transaction) => transaction.price < 0)
        .reduce((acc, transaction) => acc + Math.abs(transaction.price), 0);

      const creditCardTransactions = allTransactions.filter(
        (transaction) =>
          transaction.category_definition_id &&
          transaction.category_type === 'expense' &&
          transaction.price < 0 &&
          !isBankTransaction(transaction, bankCategoryId)
      );

      const creditCardExpenses = creditCardTransactions.reduce(
        (acc, transaction) => acc + Math.abs(transaction.price),
        0
      );

      // Count uncategorized transactions
      const uncategorized = allTransactions.filter(
        (transaction) => !transaction.category_definition_id
      ).length;

      setBankTransactions({ income: totalBankIncome, expenses: totalBankExpenses });
      setCreditCardTransactions(creditCardExpenses);
      setUncategorizedCount(uncategorized);
    } catch (error) {
      console.error("Error fetching data:", error);
      // Reset states in case of error
      setSumPerCategory([]);
      setBankTransactions({ income: 0, expenses: 0 });
      setCreditCardTransactions(0);
      setUncategorizedCount(0);
    }
  };
  
  const categories = sumPerCategory.map((item) => ({
    id: item.category_definition_id,
    name: item.name,
    value: item.expenses_total || Math.abs(item.value) || 0,
    color: item.color || categoryColors[item.name] || '#94a3b8',
    icon: categoryIcons[item.name] || MonetizationOnIcon,
    autoCount: item.auto_count || 0,
    transactionCount: item.transaction_count || 0
  }));

  const handleBankTransactionsClick = async () => {
    setLoadingBankTransactions(true);
    try {
      const url = new URL("/api/category_expenses", window.location.origin);
      const params = new URLSearchParams();
      const fullMonth = `${selectedYear}-${selectedMonth}`;
      params.append("month", fullMonth);
      params.append("all", "true");
      url.search = params.toString();
      
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const allTransactions: Expense[] = await response.json();
      
      // Filter for Bank category transactions (both positive and negative)
      const bankCategoryId = getBankCategoryId(allTransactions);

      const bankTransactions = allTransactions.filter((transaction) =>
        isBankTransaction(transaction, bankCategoryId)
      );

      setModalData({
        type: "Bank Transactions",
        data: bankTransactions.map((transaction) => ({
          ...transaction,
          category: getDisplayCategory(transaction) ?? BANK_CATEGORY_NAME
        }))
      });
      
      setIsModalOpen(true);
    } catch (error) {
      console.error("Error fetching bank transactions data:", error);
    } finally {
      setLoadingBankTransactions(false);
    }
  };

  const handleTotalCreditCardExpensesClick = async () => {
    try {
      setLoadingBankTransactions(true);
      const url = new URL("/api/category_expenses", window.location.origin);
      const params = new URLSearchParams();
      const fullMonth = `${selectedYear}-${selectedMonth}`;
      params.append("month", fullMonth);
      params.append("all", "true");
      url.search = params.toString();

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const allExpensesData: Expense[] = await response.json();
      
      const bankCategoryId = getBankCategoryId(allExpensesData);

      const creditCardData = allExpensesData.filter(
        (transaction) =>
          transaction.category_definition_id &&
          transaction.category_type === 'expense' &&
          transaction.price < 0 &&
          !isBankTransaction(transaction, bankCategoryId)
      );

      setModalData({
        type: "Credit Card Expenses",
        data: creditCardData.map((transaction) => ({
          ...transaction,
          category: getDisplayCategory(transaction) ?? 'Uncategorized'
        }))
      });

      setIsModalOpen(true);
    } catch (error) {
      console.error("Error fetching credit card expenses data:", error);
    } finally {
      setLoadingBankTransactions(false);
    }
  };

  const handleCategoryClick = async (categoryId: number, categoryName: string) => {
    try {
      setLoadingCategory(categoryId);
      const url = new URL("/api/category_expenses", window.location.origin);
      const params = new URLSearchParams();
      const fullMonth = `${selectedYear}-${selectedMonth}`;
      params.append("month", fullMonth);
      params.append("categoryId", String(categoryId));
      url.search = params.toString();

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data: Expense[] = await response.json();

      setModalData({
        type: categoryName,
        category_definition_id: categoryId,
        data: data.map((transaction) => ({
          ...transaction,
          category: getDisplayCategory(transaction) ?? 'Uncategorized'
        })),
      });

      setIsModalOpen(true);
    } catch (error) {
      console.error("Error fetching category expenses:", error);
    } finally {
      setLoadingCategory(null);
    }
  };

  const handleTransactionsTableClick = async () => {
    const newShowTransactionsTable = !showTransactionsTable;
    setShowTransactionsTable(newShowTransactionsTable);
    if (!newShowTransactionsTable){
      return;
    }

    fetchTransactions();
  };

  const fetchTransactions = async () => {
    try {
      setLoadingTransactions(true);
      const url = new URL("/api/category_expenses", window.location.origin);
      const params = new URLSearchParams();
      const fullMonth = `${selectedYear}-${selectedMonth}`;
      params.append("month", fullMonth);
      params.append("all", "true");
      url.search = params.toString();

      const response = await fetch(url.toString());
      const transactionsData: Expense[] = await response.json();
      setTransactions(
        transactionsData.map((transaction) => ({
          ...transaction,
          category: getDisplayCategory(transaction) ?? 'Uncategorized'
        }))
      );
    } catch (error) {
      console.error("Error fetching transactions data:", error);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const handleDeleteTransaction = async (transaction: CategorizedExpense) => {
    try {
      const response = await fetch(`/api/transactions/${transaction.identifier}|${transaction.vendor}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        // Remove the transaction from the local state
        setTransactions(transactions.filter(t => 
          t.identifier !== transaction.identifier || t.vendor !== transaction.vendor
        ));
        // Refresh the data to update the metrics
        fetchData(`${selectedYear}-${selectedMonth}`);
      } else {
        throw new Error('Failed to delete transaction');
      }
    } catch (error) {
      console.error("Error deleting transaction:", error);
    }
  };

  const handleUpdateTransaction = async (transaction: CategorizedExpense, newPrice: number, newCategory?: CategoryOption) => {
    try {
      const updateData: any = { price: newPrice };
      if (newCategory) {
        updateData.category_definition_id = newCategory.id;
        updateData.category = newCategory.name;
        updateData.parent_category = newCategory.parentId ? newCategory.parentName : newCategory.name;
        updateData.subcategory = newCategory.parentId ? newCategory.name : null;
        updateData.category_type = newCategory.categoryType;
        updateData.auto_categorized = false;
      }

      const response = await fetch(`/api/transactions/${transaction.identifier}|${transaction.vendor}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });
      
      if (response.ok) {
        // Refresh state to reflect updated category labels and amounts
        if (showTransactionsTable) {
          await fetchTransactions();
        }
        fetchData(`${selectedYear}-${selectedMonth}`);
      } else {
        throw new Error('Failed to update transaction');
      }
    } catch (error) {
      console.error("Error updating transaction:", error);
    }
  };

  return (
    <div style={{
      padding: '32px',
      maxWidth: '1440px',
      margin: '0 auto',
      background: '#FAFBFC',
      minHeight: '100vh'
    }}>
      <MetricsPanel />

      {/* Alert Banner for Uncategorized Transactions */}
      {uncategorizedCount > 0 && (
        <AlertBanner
          message="Transactions need categories"
          count={uncategorizedCount}
          onAction={() => setShowTransactionsTable(true)}
          actionLabel="Review"
          severity="warning"
        />
      )}

      {/* Savings Rate + Bank/Credit Cards Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px',
        marginBottom: '32px'
      }}>
        <SavingsRateCard
          income={bankTransactions.income}
          totalExpenses={bankTransactions.expenses + creditCardTransactions}
        />
        <Card
          title="Bank Transactions"
          value={bankTransactions.income}
          color="#10B981"
          icon={MonetizationOnIcon}
          onClick={handleBankTransactionsClick}
          isLoading={loadingBankTransactions}
          size="large"
          secondaryValue={bankTransactions.expenses}
          secondaryColor="#EF4444"
          isExpense={false}
        />
        <Card
          title="Credit Card Transactions"
          value={creditCardTransactions}
          color="#8B5CF6"
          icon={CreditCardIcon}
          onClick={handleTotalCreditCardExpensesClick}
          isLoading={loadingBankTransactions}
          size="large"
          isExpense={true}
        />
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        marginBottom: '24px',
        marginTop: '24px',
        gap: '12px'
      }}>
        <IconButton
          onClick={handleRefreshClick}
          style={{
            backgroundColor: '#ffffff',
            padding: '12px',
            borderRadius: '12px',
            border: '1.5px solid #E2E8F0',
            color: '#64748B',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#3B82F6';
            e.currentTarget.style.color = '#3B82F6';
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 4px 6px rgba(59, 130, 246, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#E2E8F0';
            e.currentTarget.style.color = '#64748B';
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
          }}
        >
          <RefreshIcon />
        </IconButton>
        <IconButton
          onClick={handleTransactionsTableClick}
          style={{
            backgroundColor: showTransactionsTable ? '#3B82F615' : '#ffffff',
            padding: '12px',
            borderRadius: '12px',
            border: `1.5px solid ${showTransactionsTable ? '#3B82F6' : '#E2E8F0'}`,
            color: showTransactionsTable ? '#3B82F6' : '#64748B',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: showTransactionsTable ? '0 4px 6px rgba(59, 130, 246, 0.1)' : '0 1px 2px rgba(0, 0, 0, 0.05)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <TableChartIcon />
        </IconButton>
        <select
          value={selectedYear}
          onChange={handleYearChange}
          style={{
            padding: '14px 20px',
            borderRadius: '12px',
            border: '1.5px solid #E2E8F0',
            backgroundColor: '#ffffff',
            color: '#1E293B',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            outline: 'none',
            textAlign: 'right',
            direction: 'rtl',
            minWidth: '100px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#3B82F6';
            e.currentTarget.style.boxShadow = '0 4px 6px rgba(59, 130, 246, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#E2E8F0';
            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
          }}
        >
          {uniqueYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select
          value={selectedMonth}
          onChange={handleMonthChange}
          style={{
            padding: '14px 20px',
            borderRadius: '12px',
            border: '1.5px solid #E2E8F0',
            backgroundColor: '#ffffff',
            color: '#1E293B',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            outline: 'none',
            textAlign: 'right',
            direction: 'rtl',
            minWidth: '140px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#3B82F6';
            e.currentTarget.style.boxShadow = '0 4px 6px rgba(59, 130, 246, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#E2E8F0';
            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
          }}
        >
          {uniqueMonths.map((month) => (
            <option key={month} value={month}>
              {new Date(`2024-${month}-01`).toLocaleDateString('default', { month: 'long' })}
            </option>
          ))}
        </select>
      </div>

      {showTransactionsTable ? (
        <TransactionsTable 
          transactions={transactions} 
          isLoading={loadingTransactions}
          onDelete={handleDeleteTransaction}
          onUpdate={handleUpdateTransaction}
        />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '24px',
          width: '100%',
          maxWidth: '1400px',
          boxSizing: 'border-box'
        }}>
          {categories.length > 0 ? (
            categories.map((category) => (
              <Card
                key={`category-${category.id}`}
                title={category.name}
                value={category.value}
                color={category.color}
                icon={category.icon}
                onClick={() => handleCategoryClick(category.id, category.name)}
                isLoading={loadingCategory === category.id}
                size="medium"
              />
            ))
          ) : (
            <div style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '48px',
              color: '#666',
              fontSize: '16px'
            }}>
              No transactions found for {new Date(`2024-${selectedMonth}-01`).toLocaleDateString('default', { month: 'long' })} {selectedYear}
            </div>
          )}
        </div>
      )}

      {modalData && (
        <ExpensesModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          data={modalData}
          color={categoryColors[modalData?.type] || '#94a3b8'}
          setModalData={setModalData}
          currentMonth={`${selectedYear}-${selectedMonth}`}
        />
      )}
    </div>
  );
};

export default CategoryDashboard; 
