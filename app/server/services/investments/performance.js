const actualDatabase = require('../database.js');
const historyModule = require('./history.js');
const {
  fetchLinkedInvestmentTransactions,
} = require('./linked-transaction-rollforward.js');

let database = actualDatabase;
let historyService = historyModule;

const FEE_KEYWORDS = ['fee', 'fees', 'commission', 'עמלה', 'עמלות'];
const INVESTMENT_INCOME_KEYWORDS = ['interest', 'dividend', 'ריבית', 'דיבידנד'];
const CAPITAL_RETURN_KEYWORDS = ['capital return', 'capital returns', 'החזר קרן'];

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.split('T')[0];
  return new Date(value).toISOString().split('T')[0];
}

function lower(value) {
  return String(value || '').toLowerCase();
}

function matchesKeyword(text, keywords) {
  const normalized = lower(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function addFlow(map, date, updater) {
  if (!date) return;
  if (!map.has(date)) {
    map.set(date, {
      contributions: 0,
      withdrawals: 0,
      capitalReturns: 0,
      income: 0,
      fees: 0,
    });
  }

  updater(map.get(date));
}

function calculateTwr(timeline) {
  if (!Array.isArray(timeline) || timeline.length < 2) return 0;

  let twr = 1;
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index];
    const startValue = toNumber(previous.currentValue);
    if (startValue <= 0) continue;

    const valueChange = toNumber(current.currentValue) - startValue;
    const netExternalFlow =
      toNumber(current.contributions)
      - toNumber(current.withdrawals)
      - toNumber(current.capitalReturns)
      - toNumber(current.income)
      - toNumber(current.fees);
    const dailyReturn = (valueChange - netExternalFlow) / startValue;
    twr *= 1 + dailyReturn;
  }

  return twr - 1;
}

function xnpv(rate, cashFlows) {
  const firstDate = new Date(cashFlows[0].date).getTime();
  return cashFlows.reduce((sum, flow) => {
    const date = new Date(flow.date).getTime();
    const years = (date - firstDate) / (365 * 24 * 60 * 60 * 1000);
    return sum + (flow.amount / ((1 + rate) ** years));
  }, 0);
}

function calculateMwr(cashFlows) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2) return null;
  const hasPositive = cashFlows.some((flow) => flow.amount > 0);
  const hasNegative = cashFlows.some((flow) => flow.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  let low = -0.9999;
  let high = 10;
  let npvLow = xnpv(low, cashFlows);
  let npvHigh = xnpv(high, cashFlows);

  if (Number.isNaN(npvLow) || Number.isNaN(npvHigh) || npvLow * npvHigh > 0) {
    return null;
  }

  for (let iteration = 0; iteration < 120; iteration += 1) {
    const mid = (low + high) / 2;
    const npvMid = xnpv(mid, cashFlows);
    if (Math.abs(npvMid) < 1e-7) return mid;
    if (npvLow * npvMid < 0) {
      high = mid;
      npvHigh = npvMid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }

  return (low + high) / 2;
}

async function loadPikadonReturnMap(accountIds = []) {
  const ids = Array.isArray(accountIds)
    ? accountIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];

  const params = [];
  const filters = [
    "holding_type = 'pikadon'",
    'return_transaction_id IS NOT NULL',
    'return_transaction_vendor IS NOT NULL',
  ];

  if (ids.length > 0) {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    params.push(...ids);
    filters.push(`account_id IN (${placeholders})`);
  }

  const result = await database.query(
    `
      SELECT
        return_transaction_id,
        return_transaction_vendor,
        cost_basis,
        (current_value - cost_basis) AS interest_amount
      FROM investment_holdings
      WHERE ${filters.join(' AND ')}
    `,
    params,
  );

  const map = new Map();
  (result.rows || []).forEach((row) => {
    map.set(
      `${row.return_transaction_id}|${row.return_transaction_vendor}`,
      {
        principal: Math.max(toNumber(row.cost_basis), 0),
        interest: Math.max(toNumber(row.interest_amount), 0),
      },
    );
  });
  return map;
}

function classifyTransactions(rows, pikadonReturns) {
  const dailyFlows = new Map();

  rows.forEach((row) => {
    const date = toDateStr(row.date);
    const amount = toNumber(row.price);
    const name = `${row.name || ''} ${row.category_name_en || ''} ${row.category_name || ''}`;
    const key = `${row.identifier}|${row.vendor}`;

    if (amount < 0 && row.category_type === 'investment' && matchesKeyword(name, FEE_KEYWORDS)) {
      addFlow(dailyFlows, date, (entry) => {
        entry.fees += Math.abs(amount);
      });
      return;
    }

    const pikadonReturn = amount > 0 ? pikadonReturns.get(key) : null;
    if (pikadonReturn) {
      addFlow(dailyFlows, date, (entry) => {
        entry.capitalReturns += pikadonReturn.principal;
        entry.income += pikadonReturn.interest;
      });
      return;
    }

    if (row.category_type === 'investment') {
      addFlow(dailyFlows, date, (entry) => {
        if (amount < 0) {
          entry.contributions += Math.abs(amount);
        } else {
          entry.withdrawals += Math.abs(amount);
        }
      });
      return;
    }

    if (row.category_type === 'income' && amount > 0) {
      const isCapitalReturn =
        row.is_counted_as_income === 0
        || row.is_counted_as_income === false
        || matchesKeyword(name, CAPITAL_RETURN_KEYWORDS);

      addFlow(dailyFlows, date, (entry) => {
        if (isCapitalReturn) {
          entry.capitalReturns += amount;
        } else if (matchesKeyword(name, INVESTMENT_INCOME_KEYWORDS)) {
          entry.income += amount;
        } else {
          entry.income += amount;
        }
      });
    }
  });

  return dailyFlows;
}

async function getInvestmentPerformance(params = {}) {
  const range = params.range || params.timeRange || '3m';
  const historyResult = await historyService.getInvestmentHistory({
    timeRange: range,
    includeAccounts: true,
  });
  const history = Array.isArray(historyResult?.history) ? historyResult.history : [];

  if (history.length === 0) {
    return {
      range,
      startDate: historyResult?.startDate || null,
      endDate: null,
      startValue: 0,
      endValue: 0,
      valueChange: 0,
      netFlows: {
        contributions: 0,
        withdrawals: 0,
        netContributions: 0,
      },
      capitalReturns: 0,
      income: 0,
      fees: 0,
      marketMove: 0,
      twr: 0,
      mwr: null,
      timeline: [],
    };
  }

  const startDate = historyResult?.startDate || history[0]?.date;
  const endDate = history[history.length - 1]?.date || history[0]?.date;
  const accountIds = Array.isArray(historyResult?.accounts)
    ? historyResult.accounts
      .map((account) => Number(account?.accountId))
      .filter((id) => Number.isFinite(id))
    : [];

  const [transactions, pikadonReturns] = accountIds.length > 0
    ? await Promise.all([
      fetchLinkedInvestmentTransactions(database, accountIds, {
        startDate: toDateStr(startDate),
        endDate: toDateStr(endDate),
      }),
      loadPikadonReturnMap(accountIds),
    ])
    : [[], new Map()];

  const dailyFlows = classifyTransactions(transactions, pikadonReturns);

  const timeline = history.map((point, index) => {
    const date = toDateStr(point.date);
    const flows = dailyFlows.get(date) || {
      contributions: 0,
      withdrawals: 0,
      capitalReturns: 0,
      income: 0,
      fees: 0,
    };
    const previousValue = index > 0 ? toNumber(history[index - 1]?.currentValue) : toNumber(point.currentValue);
    const currentValue = toNumber(point.currentValue);
    const valueChange = index > 0 ? currentValue - previousValue : 0;
    const marketMove =
      valueChange
      - flows.contributions
      + flows.withdrawals
      + flows.capitalReturns
      + flows.income
      + flows.fees;

    return {
      date,
      currentValue,
      costBasis: toNumber(point.costBasis),
      contributions: flows.contributions,
      withdrawals: flows.withdrawals,
      capitalReturns: flows.capitalReturns,
      income: flows.income,
      fees: flows.fees,
      valueChange,
      marketMove,
      netFlow:
        flows.contributions
        - flows.withdrawals
        - flows.capitalReturns
        - flows.income
        - flows.fees,
    };
  });

  const totals = timeline.reduce(
    (acc, point) => {
      acc.contributions += point.contributions;
      acc.withdrawals += point.withdrawals;
      acc.capitalReturns += point.capitalReturns;
      acc.income += point.income;
      acc.fees += point.fees;
      return acc;
    },
    {
      contributions: 0,
      withdrawals: 0,
      capitalReturns: 0,
      income: 0,
      fees: 0,
    },
  );

  const startValue = toNumber(history[0]?.currentValue);
  const endValue = toNumber(history[history.length - 1]?.currentValue);
  const valueChange = endValue - startValue;
  const marketMove =
    valueChange
    - totals.contributions
    + totals.withdrawals
    + totals.capitalReturns
    + totals.income
    + totals.fees;

  const cashFlows = [
    { date: toDateStr(startDate), amount: -startValue },
    ...timeline.flatMap((point) => {
      const flows = [];
      if (point.contributions > 0) {
        flows.push({ date: point.date, amount: -point.contributions });
      }
      if (point.withdrawals > 0) {
        flows.push({ date: point.date, amount: point.withdrawals });
      }
      if (point.capitalReturns > 0) {
        flows.push({ date: point.date, amount: point.capitalReturns });
      }
      if (point.income > 0) {
        flows.push({ date: point.date, amount: point.income });
      }
      if (point.fees > 0) {
        flows.push({ date: point.date, amount: -point.fees });
      }
      return flows;
    }),
    { date: toDateStr(endDate), amount: endValue },
  ];

  return {
    range,
    startDate: toDateStr(startDate),
    endDate: toDateStr(endDate),
    startValue,
    endValue,
    valueChange,
    netFlows: {
      contributions: totals.contributions,
      withdrawals: totals.withdrawals,
      netContributions: totals.contributions - totals.withdrawals,
    },
    capitalReturns: totals.capitalReturns,
    income: totals.income,
    fees: totals.fees,
    marketMove,
    twr: calculateTwr(timeline),
    mwr: calculateMwr(cashFlows),
    timeline,
  };
}

module.exports = {
  getInvestmentPerformance,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    if (historyService?.__setDatabase) {
      historyService.__setDatabase(database);
    }
  },
  __setHistoryService(mockHistoryService) {
    historyService = mockHistoryService || historyModule;
  },
  __resetDatabase() {
    database = actualDatabase;
    historyService = historyModule;
    if (historyService?.__resetDatabase) {
      historyService.__resetDatabase();
    }
  },
};

module.exports.default = module.exports;
