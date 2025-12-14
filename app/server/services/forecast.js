/**
 * Financial Forecasting Service
 * Predicts day-by-day expenses, income, and investments based on historical patterns
 * 
 * Ported from scripts/forecast-script-daily.js for use in the Electron app
 */

const database = require('./database.js');

// ==================== UTILITY FUNCTIONS ====================

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getDayName(dayOfWeek) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek];
}

// ==================== DATABASE QUERIES ====================

async function getAllTransactions() {
  const query = `
    SELECT
      t.identifier,
      t.date,
      t.name,
      t.price,
      t.type,
      t.category_type,
      t.vendor,
      t.vendor_nickname,
      cd.id as category_id,
      cd.name as category_name,
      parent_cd.name as parent_category_name,
      strftime('%w', t.date) as day_of_week,
      CAST(strftime('%d', t.date) AS INTEGER) as day_of_month,
      strftime('%Y-%m', t.date) as month
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    LEFT JOIN account_pairings ap ON (
      t.vendor = ap.bank_vendor
      AND ap.is_active = 1
      AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
      AND ap.match_patterns IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM json_each(ap.match_patterns)
        WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
      )
    )
    WHERE t.status = 'completed'
      AND ap.id IS NULL
    ORDER BY t.date
  `;

  const result = await database.query(query);
  return (result && result.rows) ? result.rows : [];
}

async function getCurrentMonthTransactions(currentMonth) {
  const query = `
    SELECT
      t.date,
      t.name,
      t.price,
      t.category_type,
      cd.name as category_name,
      strftime('%w', t.date) as day_of_week,
      CAST(strftime('%d', t.date) AS INTEGER) as day_of_month
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN account_pairings ap ON (
      t.vendor = ap.bank_vendor
      AND ap.is_active = 1
      AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
      AND ap.match_patterns IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM json_each(ap.match_patterns)
        WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
      )
    )
    WHERE strftime('%Y-%m', t.date) = ?
      AND t.status = 'completed'
      AND ap.id IS NULL
    ORDER BY t.date
  `;

  const result = await database.query(query, [currentMonth]);
  return (result && result.rows) ? result.rows : [];
}

// ==================== PATTERN ANALYSIS ====================

function analyzeCategoryPatterns(transactions) {
  const patterns = {};

  if (transactions.length === 0) return patterns;

  const excludeCategories = [
    'החזר קרן',
    'ריבית מהשקעות',
    'פיקדונות'
  ];

  // Group transactions by category first
  const tempPatterns = {};
  transactions.forEach(txn => {
    const categoryKey = txn.category_name || 'Uncategorized';

    if (excludeCategories.includes(categoryKey)) return;

    if (!tempPatterns[categoryKey]) {
      tempPatterns[categoryKey] = [];
    }
    tempPatterns[categoryKey].push(txn);
  });

  // Process each category
  Object.entries(tempPatterns).forEach(([categoryKey, txns]) => {
    const months = new Set(txns.map(t => t.month)).size;
    const avgOccurrencesPerMonth = txns.length / Math.max(months, 1);
    
    // Split by transaction name for truly monthly recurring payments (1.5-2.0 per month)
    const couldBeMonthlyRecurring = avgOccurrencesPerMonth >= 1.5 && avgOccurrencesPerMonth <= 2.0;
    
    if (couldBeMonthlyRecurring) {
      txns.forEach(txn => {
        const key = txn.name || categoryKey;
        
        if (!patterns[key]) {
          patterns[key] = {
            category: categoryKey,
            transactionName: txn.name,
            categoryType: txn.category_type,
            parentCategory: txn.parent_category_name,
            amounts: [],
            dailyTotals: {},
            daysOfWeek: {},
            daysOfMonth: {},
            monthlyOccurrences: {},
            totalCount: 0,
            transactions: []
          };
        }

        patterns[key].transactions.push(txn);
        patterns[key].amounts.push(Math.abs(txn.price));
        patterns[key].totalCount++;

        const day = txn.date.split('T')[0];
        patterns[key].dailyTotals[day] = (patterns[key].dailyTotals[day] || 0) + Math.abs(txn.price);

        const dow = txn.day_of_week;
        patterns[key].daysOfWeek[dow] = (patterns[key].daysOfWeek[dow] || 0) + 1;

        const dom = txn.day_of_month;
        patterns[key].daysOfMonth[dom] = (patterns[key].daysOfMonth[dom] || 0) + 1;

        const month = txn.month;
        patterns[key].monthlyOccurrences[month] = (patterns[key].monthlyOccurrences[month] || 0) + 1;
      });
    } else {
      const key = categoryKey;

      patterns[key] = {
        category: key,
        transactionName: null,
        categoryType: txns[0].category_type,
        parentCategory: txns[0].parent_category_name,
        amounts: [],
        dailyTotals: {},
        daysOfWeek: {},
        daysOfMonth: {},
        monthlyOccurrences: {},
        totalCount: 0,
        transactions: []
      };

      txns.forEach(txn => {
        patterns[key].transactions.push(txn);
        patterns[key].amounts.push(Math.abs(txn.price));
        patterns[key].totalCount++;

        const day = txn.date.split('T')[0];
        patterns[key].dailyTotals[day] = (patterns[key].dailyTotals[day] || 0) + Math.abs(txn.price);

        const dow = txn.day_of_week;
        patterns[key].daysOfWeek[dow] = (patterns[key].daysOfWeek[dow] || 0) + 1;

        const dom = txn.day_of_month;
        patterns[key].daysOfMonth[dom] = (patterns[key].daysOfMonth[dom] || 0) + 1;

        const month = txn.month;
        patterns[key].monthlyOccurrences[month] = (patterns[key].monthlyOccurrences[month] || 0) + 1;
      });
    }
  });

  // Calculate statistics for each pattern
  Object.keys(patterns).forEach(key => {
    const p = patterns[key];
    
    const uniqueMonths = Object.keys(p.monthlyOccurrences).length;
    p.monthsOfHistory = uniqueMonths;
    
    const hasMinimumMonths = uniqueMonths >= 2;
    const hasMinimumOccurrences = p.totalCount >= 3;
    
    if (!hasMinimumMonths && !hasMinimumOccurrences) {
      p.insufficientData = true;
      return;
    }
    
    // Amount statistics
    p.avgAmount = mean(p.amounts);
    p.stdDev = standardDeviation(p.amounts);
    
    // Outlier filtering (keep at least 80% of data)
    const outlierThreshold = p.avgAmount + (3 * p.stdDev);
    const nonOutlierAmounts = p.amounts.filter(amt => amt <= outlierThreshold);
    if (nonOutlierAmounts.length >= p.amounts.length * 0.8) {
      p.avgAmount = mean(nonOutlierAmounts);
      p.stdDev = standardDeviation(nonOutlierAmounts);
    }
    
    // Frequency analysis
    const months = Object.keys(p.monthlyOccurrences).length;
    p.avgOccurrencesPerMonth = p.totalCount / Math.max(months, 1);
    
    // For daily patterns, calculate daily totals
    if (p.avgOccurrencesPerMonth >= 20 && Object.keys(p.dailyTotals).length > 0) {
      const dailyTotalValues = Object.values(p.dailyTotals);
      p.avgDailyTotal = mean(dailyTotalValues);
      p.stdDevDailyTotal = standardDeviation(dailyTotalValues);
      p.useDailyTotal = true;
    }
    
    // Day of week probabilities
    const totalDowCount = Object.values(p.daysOfWeek).reduce((sum, count) => sum + count, 0);
    p.dayOfWeekProb = {};
    Object.keys(p.daysOfWeek).forEach(dow => {
      p.dayOfWeekProb[dow] = p.daysOfWeek[dow] / totalDowCount;
    });
    
    // Day of month probabilities
    const totalDomCount = Object.values(p.daysOfMonth).reduce((sum, count) => sum + count, 0);
    p.dayOfMonthProb = {};
    Object.keys(p.daysOfMonth).forEach(dom => {
      p.dayOfMonthProb[dom] = p.daysOfMonth[dom] / totalDomCount;
    });
    
    // Determine pattern type
    if (p.avgOccurrencesPerMonth >= 20) {
      p.patternType = 'daily';
    } else if (p.avgOccurrencesPerMonth >= 4) {
      p.patternType = 'weekly';
    } else if (p.avgOccurrencesPerMonth >= 0.9 && p.avgOccurrencesPerMonth <= 1.5) {
      p.patternType = 'monthly';
    } else if (p.avgOccurrencesPerMonth >= 0.4) {
      p.patternType = 'bi-monthly';
    } else {
      p.patternType = 'sporadic';
    }
    
    // Most likely days of week
    p.mostLikelyDaysOfWeek = Object.entries(p.dayOfWeekProb)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([dow, prob]) => ({ day: parseInt(dow), dayName: getDayName(parseInt(dow)), probability: prob }));

    // Most likely days of month
    p.mostLikelyDaysOfMonth = Object.entries(p.dayOfMonthProb)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dom, prob]) => ({ day: parseInt(dom), probability: prob }));

    // Calculate last occurrence
    if (p.transactions && p.transactions.length > 0) {
      p.lastOccurrence = p.transactions[p.transactions.length - 1].date;
      const lastDate = new Date(p.lastOccurrence);
      const now = new Date();
      p.daysSinceLastOccurrence = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
    }

    // Clean up raw transaction data to save memory
    delete p.transactions;
  });

  return patterns;
}

// ==================== PROBABILITY CALCULATIONS ====================

function calculateDayProbability(pattern, date, adjustments, patternKey) {
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();

  let probability = 0;
  const dowProb = pattern.dayOfWeekProb[dayOfWeek] || 0;
  const domProb = pattern.dayOfMonthProb[dayOfMonth] || 0;

  if (pattern.patternType === 'daily') {
    const avgDailyFrequency = pattern.avgOccurrencesPerMonth / 30;
    const maxDowProb = Math.max(...Object.values(pattern.dayOfWeekProb), 0.01);
    const dowAdjustment = dowProb > 0 ? (dowProb / maxDowProb) : 1.0;
    probability = avgDailyFrequency * dowAdjustment;
  } else if (pattern.patternType === 'monthly') {
    if (pattern.categoryType === 'income') {
      const topDays = pattern.mostLikelyDaysOfMonth.slice(0, 3).map(d => d.day);
      if (topDays.includes(dayOfMonth)) {
        probability = domProb * 0.9 + dowProb * 0.1;
        if (dayOfMonth === topDays[0]) probability *= 1.5;
      } else {
        probability = domProb * 0.3 + dowProb * 0.1;
      }
    } else {
      probability = domProb * 0.8 + dowProb * 0.2;
    }
  } else if (pattern.patternType === 'weekly') {
    probability = dowProb * 0.7 + domProb * 0.3;
  } else {
    probability = (dowProb + domProb) / 2;
  }

  // Apply adjustments
  const adjustment = adjustments[patternKey];
  if (adjustment) {
    probability *= adjustment.probabilityMultiplier;
  }

  // Scale for non-daily patterns
  if (pattern.patternType !== 'daily') {
    const baselineDailyProb = pattern.avgOccurrencesPerMonth / 30;
    if (pattern.patternType === 'monthly' && pattern.categoryType === 'income') {
      probability = probability * 12;
    } else {
      probability = probability * baselineDailyProb * 2;
    }
  }

  return Math.min(Math.max(probability, 0), 0.95);
}

function adjustProbabilitiesForCurrentMonth(patterns, currentMonthTransactions, currentDay) {
  const adjustments = {};

  const occurredCategories = {};
  currentMonthTransactions.forEach(txn => {
    const category = txn.category_name || 'Uncategorized';
    const patternKey = patterns[txn.name] ? txn.name : category;
    
    if (!occurredCategories[patternKey]) {
      occurredCategories[patternKey] = [];
    }
    occurredCategories[patternKey].push({
      day: txn.day_of_month,
      amount: Math.abs(txn.price)
    });
  });

  Object.keys(patterns).forEach(patternKey => {
    const pattern = patterns[patternKey];
    const occurred = occurredCategories[patternKey] || [];

    adjustments[patternKey] = {
      alreadyOccurred: occurred.length,
      probabilityMultiplier: 1.0
    };

    if (pattern.patternType === 'monthly' && occurred.length > 0) {
      adjustments[patternKey].probabilityMultiplier = pattern.categoryType === 'income' ? 0.0 : 0.2;
    }

    if (occurred.length > 0) {
      const daysSinceLastOccurrence = currentDay - occurred[occurred.length - 1].day;
      if (daysSinceLastOccurrence <= 1) {
        adjustments[patternKey].probabilityMultiplier *= 0.5;
      } else if (daysSinceLastOccurrence <= 3) {
        adjustments[patternKey].probabilityMultiplier *= 0.8;
      }
    }
  });

  return adjustments;
}

// ==================== FORECASTING ====================

function forecastDay(date, patterns, adjustments) {
  const predictions = [];
  let expectedIncome = 0;
  let expectedExpenses = 0;

  Object.keys(patterns).forEach(category => {
    const pattern = patterns[category];
    
    if (pattern.insufficientData) return;
    
    const probability = calculateDayProbability(pattern, date, adjustments, category);

    let threshold;
    if (pattern.categoryType === 'income') {
      threshold = 0.02;
    } else if (pattern.patternType === 'monthly' || pattern.patternType === 'bi-monthly') {
      threshold = 0.01;
    } else {
      threshold = 0.05;
    }
    
    if (probability >= threshold) {
      const expectedAmount = pattern.useDailyTotal ? pattern.avgDailyTotal : pattern.avgAmount;
      const stdDev = pattern.useDailyTotal ? pattern.stdDevDailyTotal : pattern.stdDev;
      
      const prediction = {
        category: pattern.category,
        transactionName: pattern.transactionName || pattern.category,
        categoryType: pattern.categoryType,
        probability: probability,
        expectedAmount: expectedAmount,
        amountRange: {
          low: Math.max(0, expectedAmount - stdDev),
          high: expectedAmount + stdDev
        },
        probabilityWeightedAmount: probability * expectedAmount
      };

      predictions.push(prediction);

      if (pattern.categoryType === 'income') {
        expectedIncome += prediction.probabilityWeightedAmount;
      } else if (pattern.categoryType === 'expense') {
        expectedExpenses += prediction.probabilityWeightedAmount;
      }
    }
  });

  predictions.sort((a, b) => b.probability - a.probability);

  return {
    date: formatDate(date),
    dayOfWeek: date.getDay(),
    dayOfWeekName: getDayName(date.getDay()),
    dayOfMonth: date.getDate(),
    predictions: predictions,
    expectedIncome: expectedIncome,
    expectedExpenses: expectedExpenses,
    expectedCashFlow: expectedIncome - expectedExpenses,
    topPredictions: predictions.slice(0, 5)
  };
}

/**
 * Adjust monthly pattern forecasts to avoid counting the same event multiple times
 * For monthly patterns, keep only the highest probability day and zero out others
 */
function adjustMonthlyPatternForecasts(dailyForecasts, patterns, adjustments) {
  // Find all monthly patterns that haven't already occurred (multiplier > 0)
  const monthlyPatterns = Object.entries(patterns)
    .filter(([key, pattern]) => {
      const adjustment = adjustments[key];
      return pattern.patternType === 'monthly' &&
             (!adjustment || adjustment.probabilityMultiplier > 0);
    })
    .map(([key, pattern]) => ({
      key,
      transactionName: pattern.transactionName || pattern.category,
      category: pattern.category,
      categoryType: pattern.categoryType,
      avgAmount: pattern.avgAmount
    }));

  // For each monthly pattern, find the day with highest probability
  monthlyPatterns.forEach(monthlyPattern => {
    const patternKey = monthlyPattern.transactionName;

    // Find all days where this pattern appears with its probability
    const daysWithPattern = dailyForecasts.map((day, index) => {
      const pred = day.predictions.find(p =>
        (p.transactionName === patternKey) ||
        (p.category === monthlyPattern.category && !monthlyPattern.transactionName)
      );
      return pred ? { dayIndex: index, prediction: pred, probability: pred.probability } : null;
    }).filter(Boolean);

    if (daysWithPattern.length === 0) return;

    // Find the day with maximum probability
    const maxProbDay = daysWithPattern.reduce((max, curr) =>
      curr.probability > max.probability ? curr : max
    );

    // Adjust all days: keep only the max probability day, zero out others
    daysWithPattern.forEach(({ dayIndex, prediction }) => {
      const day = dailyForecasts[dayIndex];

      if (dayIndex === maxProbDay.dayIndex) {
        // This is the most likely day - keep full amount (not probability-weighted)
        const adjustmentDelta = prediction.expectedAmount - prediction.probabilityWeightedAmount;

        if (monthlyPattern.categoryType === 'income') {
          day.expectedIncome += adjustmentDelta;
        } else if (monthlyPattern.categoryType === 'expense') {
          day.expectedExpenses += adjustmentDelta;
        }
        day.expectedCashFlow = day.expectedIncome - day.expectedExpenses;

        // Update the prediction to show it's the chosen day
        prediction.probabilityWeightedAmount = prediction.expectedAmount;
        prediction.isChosenOccurrence = true;
      } else {
        // This is not the most likely day - remove the contribution
        const adjustmentDelta = -prediction.probabilityWeightedAmount;

        if (monthlyPattern.categoryType === 'income') {
          day.expectedIncome += adjustmentDelta;
        } else if (monthlyPattern.categoryType === 'expense') {
          day.expectedExpenses += adjustmentDelta;
        }
        day.expectedCashFlow = day.expectedIncome - day.expectedExpenses;

        // Mark prediction as not the chosen occurrence
        prediction.probabilityWeightedAmount = 0;
        prediction.isChosenOccurrence = false;
      }
    });
  });
}

// ==================== MONTE CARLO SIMULATION ====================

function sampleAmount(avgAmount, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, avgAmount + z * stdDev);
}

function willOccur(probability) {
  return Math.random() < probability;
}

function simulateScenario(dailyForecasts, patterns, adjustments) {
  const scenario = {
    totalIncome: 0,
    totalExpenses: 0,
    dailyResults: []
  };

  const monthlyOccurrences = new Set();

  dailyForecasts.forEach(dayForecast => {
    const date = new Date(dayForecast.date);
    let dayIncome = 0;
    let dayExpenses = 0;

    Object.keys(patterns).forEach(patternKey => {
      const pattern = patterns[patternKey];
      
      if (pattern.insufficientData) return;
      
      const probability = calculateDayProbability(pattern, date, adjustments, patternKey);
      
      let threshold;
      if (pattern.categoryType === 'income') {
        threshold = 0.02;
      } else if (pattern.patternType === 'monthly' || pattern.patternType === 'bi-monthly') {
        threshold = 0.01;
      } else {
        threshold = 0.05;
      }
      if (probability < threshold) return;

      if (pattern.patternType === 'monthly') {
        const monthlyKey = pattern.transactionName || pattern.category;
        if (monthlyOccurrences.has(monthlyKey)) return;
        
        if (willOccur(probability)) {
          monthlyOccurrences.add(monthlyKey);
          const amount = sampleAmount(pattern.avgAmount, pattern.stdDev);
          
          if (pattern.categoryType === 'income') {
            dayIncome += amount;
          } else if (pattern.categoryType === 'expense') {
            dayExpenses += amount;
          }
        }
      } else {
        if (willOccur(probability)) {
          const avgAmt = pattern.useDailyTotal ? pattern.avgDailyTotal : pattern.avgAmount;
          const stdDev = pattern.useDailyTotal ? pattern.stdDevDailyTotal : pattern.stdDev;
          const amount = sampleAmount(avgAmt, stdDev);
          
          if (pattern.categoryType === 'income') {
            dayIncome += amount;
          } else if (pattern.categoryType === 'expense') {
            dayExpenses += amount;
          }
        }
      }
    });

    scenario.dailyResults.push({
      date: dayForecast.date,
      income: dayIncome,
      expenses: dayExpenses,
      cashFlow: dayIncome - dayExpenses
    });

    scenario.totalIncome += dayIncome;
    scenario.totalExpenses += dayExpenses;
  });

  scenario.totalCashFlow = scenario.totalIncome - scenario.totalExpenses;
  return scenario;
}

function runMonteCarloSimulation(dailyForecasts, patterns, adjustments, numSimulations = 1000) {
  const scenarios = [];
  for (let i = 0; i < numSimulations; i++) {
    scenarios.push(simulateScenario(dailyForecasts, patterns, adjustments));
  }

  scenarios.sort((a, b) => a.totalCashFlow - b.totalCashFlow);

  const p10Index = Math.floor(numSimulations * 0.10);
  const p50Index = Math.floor(numSimulations * 0.50);
  const p90Index = Math.floor(numSimulations * 0.90);

  return {
    numSimulations,
    worst: scenarios[p10Index],
    base: scenarios[p50Index],
    best: scenarios[p90Index]
  };
}

// ==================== MAIN API ====================

async function generateDailyForecast(options = {}) {
  const { forecastDays = null } = options;
  
  // 1. Get all historical transactions
  const allTransactions = await getAllTransactions();
  
  if (allTransactions.length === 0) {
    throw new Error('No transactions found');
  }

  // 2. Get current month info
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentDay = now.getDate();

  const currentMonthTransactions = await getCurrentMonthTransactions(currentMonth);

  // 3. Analyze patterns
  const patterns = analyzeCategoryPatterns(allTransactions);

  // 4. Adjust probabilities
  const adjustments = adjustProbabilitiesForCurrentMonth(patterns, currentMonthTransactions, currentDay);

  // 5. Determine forecast period
  let forecastStartDate = new Date(now);
  forecastStartDate.setDate(currentDay + 1);

  let forecastEndDate;
  if (forecastDays) {
    forecastEndDate = new Date(forecastStartDate);
    forecastEndDate.setDate(forecastEndDate.getDate() + forecastDays - 1);
  } else {
    const daysInMonth = getDaysInMonth(now.getFullYear(), now.getMonth());
    forecastEndDate = new Date(now.getFullYear(), now.getMonth(), daysInMonth);
  }

  // 6. Generate daily forecasts
  const dailyForecasts = [];
  let currentDate = new Date(forecastStartDate);

  while (currentDate <= forecastEndDate) {
    const forecast = forecastDay(currentDate, patterns, adjustments);
    dailyForecasts.push(forecast);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // 7. Adjust for monthly patterns (avoid counting same event multiple times)
  adjustMonthlyPatternForecasts(dailyForecasts, patterns, adjustments);

  // 8. Run Monte Carlo simulation
  const monteCarloResults = runMonteCarloSimulation(dailyForecasts, patterns, adjustments, 1000);

  // 9. Calculate cumulative cash flow
  let cumulativeCashFlow = 0;
  dailyForecasts.forEach(day => {
    cumulativeCashFlow += day.expectedCashFlow;
    day.cumulativeCashFlow = cumulativeCashFlow;
  });

  // 10. Get current month actuals
  const actualIncome = currentMonthTransactions
    .filter(t => t.category_type === 'income')
    .reduce((sum, t) => sum + Math.abs(t.price), 0);
  const actualExpenses = currentMonthTransactions
    .filter(t => t.category_type === 'expense')
    .reduce((sum, t) => sum + Math.abs(t.price), 0);

  return {
    generated: new Date().toISOString(),
    forecastPeriod: {
      start: formatDate(forecastStartDate),
      end: formatDate(forecastEndDate),
      days: dailyForecasts.length
    },
    actual: {
      startDate: `${currentMonth}-01`,
      endDate: formatDate(now),
      income: actualIncome,
      expenses: actualExpenses,
      netPosition: actualIncome - actualExpenses
    },
    dailyForecasts: dailyForecasts.map(day => ({
      date: day.date,
      dayOfWeek: day.dayOfWeek,
      dayOfWeekName: day.dayOfWeekName,
      // Clean up floating point precision errors (values < 0.01 → 0)
      income: Math.abs(day.expectedIncome) < 0.01 ? 0 : day.expectedIncome,
      expenses: Math.abs(day.expectedExpenses) < 0.01 ? 0 : day.expectedExpenses,
      cashFlow: Math.abs(day.expectedCashFlow) < 0.01 ? 0 : day.expectedCashFlow,
      cumulativeCashFlow: day.cumulativeCashFlow,
      topPredictions: day.topPredictions.map(p => ({
        category: p.category,
        probability: p.probability,
        amount: Math.abs(p.expectedAmount) < 0.01 ? 0 : p.expectedAmount
      }))
    })),
    scenarios: {
      p10: {
        income: Math.abs(monteCarloResults.worst.totalIncome) < 0.01 ? 0 : monteCarloResults.worst.totalIncome,
        expenses: Math.abs(monteCarloResults.worst.totalExpenses) < 0.01 ? 0 : monteCarloResults.worst.totalExpenses,
        netCashFlow: Math.abs(monteCarloResults.worst.totalCashFlow) < 0.01 ? 0 : monteCarloResults.worst.totalCashFlow,
        daily: monteCarloResults.worst.dailyResults.map(d => ({
          ...d,
          income: Math.abs(d.income) < 0.01 ? 0 : d.income,
          expenses: Math.abs(d.expenses) < 0.01 ? 0 : d.expenses,
          cashFlow: Math.abs(d.cashFlow) < 0.01 ? 0 : d.cashFlow
        }))
      },
      p50: {
        income: Math.abs(monteCarloResults.base.totalIncome) < 0.01 ? 0 : monteCarloResults.base.totalIncome,
        expenses: Math.abs(monteCarloResults.base.totalExpenses) < 0.01 ? 0 : monteCarloResults.base.totalExpenses,
        netCashFlow: Math.abs(monteCarloResults.base.totalCashFlow) < 0.01 ? 0 : monteCarloResults.base.totalCashFlow,
        daily: monteCarloResults.base.dailyResults.map(d => ({
          ...d,
          income: Math.abs(d.income) < 0.01 ? 0 : d.income,
          expenses: Math.abs(d.expenses) < 0.01 ? 0 : d.expenses,
          cashFlow: Math.abs(d.cashFlow) < 0.01 ? 0 : d.cashFlow
        }))
      },
      p90: {
        income: Math.abs(monteCarloResults.best.totalIncome) < 0.01 ? 0 : monteCarloResults.best.totalIncome,
        expenses: Math.abs(monteCarloResults.best.totalExpenses) < 0.01 ? 0 : monteCarloResults.best.totalExpenses,
        netCashFlow: Math.abs(monteCarloResults.best.totalCashFlow) < 0.01 ? 0 : monteCarloResults.best.totalCashFlow,
        daily: monteCarloResults.best.dailyResults.map(d => ({
          ...d,
          income: Math.abs(d.income) < 0.01 ? 0 : d.income,
          expenses: Math.abs(d.expenses) < 0.01 ? 0 : d.expenses,
          cashFlow: Math.abs(d.cashFlow) < 0.01 ? 0 : d.cashFlow
        }))
      }
    },
    summary: {
      expectedIncome: dailyForecasts.reduce((sum, d) => sum + d.expectedIncome, 0),
      expectedExpenses: dailyForecasts.reduce((sum, d) => sum + d.expectedExpenses, 0),
      expectedCashFlow: dailyForecasts.reduce((sum, d) => sum + d.expectedCashFlow, 0),
      numSimulations: monteCarloResults.numSimulations
    }
  };
}

module.exports = {
  generateDailyForecast
};
