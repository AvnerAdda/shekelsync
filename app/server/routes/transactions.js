const transactionsMetrics = require('../services/transactions/metrics.js');
const transactionsList = require('../services/transactions/list.js');
const transactionsAdminService = require('../services/transactions/admin.js');

const UPDATABLE_FIELDS = [
  'price',
  'category_definition_id',
  'category_type',
  'auto_categorized',
  'confidence_score',
];

function sendError(res, error, fallbackMessage) {
  const status = error?.status || 500;
  res.status(status).json({
    error: error?.message || fallbackMessage || 'Internal server error',
  });
}

async function getAvailableMonths(_req, res) {
  try {
    const months = await transactionsMetrics.listAvailableMonths();
    res.json(months);
  } catch (error) {
    console.error('Get available months error:', error);
    sendError(res, error, 'Failed to fetch available months');
  }
}

async function getBoxPanelData(_req, res) {
  try {
    const data = await transactionsMetrics.getBoxPanelData();
    res.json(data);
  } catch (error) {
    console.error('Get box panel data error:', error);
    sendError(res, error, 'Failed to fetch box panel data');
  }
}

async function getCategoryExpenses(req, res) {
  try {
    const rows = await transactionsMetrics.getCategoryExpenses(req.query || {});
    res.json(rows);
  } catch (error) {
    console.error('Get category expenses error:', error);
    sendError(res, error, 'Failed to fetch category expenses');
  }
}

async function getCategoryByMonth(req, res) {
  try {
    const rows = await transactionsMetrics.getCategorySpendingTimeline(req.query || {});
    res.json(rows);
  } catch (error) {
    console.error('Get category by month error:', error);
    sendError(res, error, 'Failed to fetch category spending timeline');
  }
}

async function getExpensesByMonth(req, res) {
  try {
    const rows = await transactionsMetrics.getExpensesByMonth(req.query || {});
    res.json(rows);
  } catch (error) {
    console.error('Get expenses by month error:', error);
    sendError(res, error, 'Failed to fetch expenses by month');
  }
}

async function getMonthByCategories(req, res) {
  try {
    const rows = await transactionsMetrics.getMonthByCategories(req.query || {});
    res.json(rows);
  } catch (error) {
    console.error('Get month by categories error:', error);
    sendError(res, error, 'Failed to fetch month by categories');
  }
}

async function getRecentTransactions(req, res) {
  try {
    const result = await transactionsList.listRecentTransactions(req.query || {});
    res.json(result);
  } catch (error) {
    console.error('Get recent transactions error:', error);
    sendError(res, error, 'Failed to fetch recent transactions');
  }
}

async function searchTransactions(req, res) {
  try {
    const result = await transactionsList.searchTransactions(req.query || {});
    res.json(result);
  } catch (error) {
    console.error('Search transactions error:', error);
    sendError(res, error, 'Failed to search transactions');
  }
}

async function createManualTransaction(req, res) {
  try {
    const result = await transactionsAdminService.createManualTransaction(req.body || {});
    res.json(result);
  } catch (error) {
    console.error('Manual transaction create error:', error);
    sendError(res, error, 'Failed to create manual transaction');
  }
}

async function updateTransaction(req, res) {
  const id = req.params?.id || req.query?.id;

  if (!id) {
    res.status(400).json({ error: 'ID parameter is required' });
    return;
  }

  const body = req.body || {};
  const hasUpdatableField = UPDATABLE_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

  if (!hasUpdatableField) {
    res.status(400).json({ error: 'At least one updatable field is required' });
    return;
  }

  try {
    const result = await transactionsAdminService.updateTransaction(id, body);
    res.json(result);
  } catch (error) {
    console.error('Transaction update error:', error);
    sendError(res, error, 'Failed to update transaction');
  }
}

async function deleteTransaction(req, res) {
  const id = req.params?.id || req.query?.id;

  if (!id) {
    res.status(400).json({ error: 'ID parameter is required' });
    return;
  }

  try {
    const result = await transactionsAdminService.deleteTransaction(id);
    res.json(result);
  } catch (error) {
    console.error('Transaction delete error:', error);
    sendError(res, error, 'Failed to delete transaction');
  }
}

module.exports = {
  getAvailableMonths,
  getBoxPanelData,
  getCategoryExpenses,
  getCategoryByMonth,
  getExpensesByMonth,
  getMonthByCategories,
  getRecentTransactions,
  searchTransactions,
  createManualTransaction,
  updateTransaction,
  deleteTransaction,
};
