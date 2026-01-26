const express = require('express');
const path = require('path');
const { generateDailyForecast } = require('../services/forecast.js');

// Initialize database for category lookups
const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../../dist/clarify.sqlite');
let dbInstance = null;
let Database = null;

function getDatabase() {
  if (!Database) {
    // Lazy-load the native module to keep cold-start lighter
    Database = require('better-sqlite3');
  }
  if (!dbInstance) {
    dbInstance = new Database(dbPath);
  }
  return dbInstance;
}

// Simple in-memory cache for forecast results
const forecastCache = {
  data: null,
  timestamp: null,
  cacheDuration: 5 * 60 * 1000, // 5 minutes
};

function isCacheValid() {
  if (!forecastCache.data || !forecastCache.timestamp) return false;
  return Date.now() - forecastCache.timestamp < forecastCache.cacheDuration;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr) {
  if (typeof dateStr !== 'string') return new Date(dateStr);
  if (dateStr.includes('T')) return new Date(dateStr);
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date(dateStr);
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function createForecastRouter({ sqliteDb = null } = {}) {
  const router = express.Router();
  const getDbInstance = () => sqliteDb || getDatabase();

  router.get('/daily', async (req, res) => {
    try {
      const { months, days, includeToday, verbose, noCache, budgetDays: budgetDaysParam } = req.query;
      const skipCache = noCache === 'true' || noCache === '1';
      
      // Budget lookback period (default 30 days)
      const budgetDays = budgetDaysParam ? Number.parseInt(budgetDaysParam, 10) : 30;
      const budgetMultiplier = budgetDays / 30; // Pro-rate monthly budgets

      // Check cache first (unless explicitly skipped)
      if (!skipCache && isCacheValid()) {
        console.log('[Forecast] Returning cached forecast result');
        return res.json(forecastCache.data);
      }

      // Default to 30 days forecast (not end of month)
      const now = new Date();

      let forecastDaysValue;
      let forecastMonthsValue;

      if (days) {
        forecastDaysValue = Number.parseInt(days, 10);
      } else {
        forecastDaysValue = 30; // Default to 30 days forecast
      }

      if (months) {
        forecastMonthsValue = Number.parseInt(months, 10);
      } else if (!days) {
        forecastMonthsValue = undefined; // Use forecastDays instead
      }

      const opts = {
        forecastMonths: forecastMonthsValue,
        forecastDays: forecastDaysValue,
        includeToday: includeToday === 'true' || includeToday === '1',
        verbose: verbose === 'true' || verbose === '1',
      };
      console.log('[Forecast] Generating daily forecast with options:', opts);
      const result = await generateDailyForecast(opts);
      console.log('[Forecast] Successfully generated forecast with', result.dailyForecasts?.length || 0, 'days');

      // Date calculations for budget period (last X days based on budgetDays)
      const today = new Date();
      const todayStr = formatLocalDate(today);
      const budgetStartDate = new Date(today);
      budgetStartDate.setDate(budgetStartDate.getDate() - budgetDays);
      const budgetStartStr = formatLocalDate(budgetStartDate);
      
      // Legacy month calculations for forecast filtering
      const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const monthEndStr = formatLocalDate(monthEnd);

      // Use SQLite directly for actuals/budgets/category lookups
      const db = getDbInstance();

      // Load actual spending (real transactions) for the last X days (budgetDays)
      let actualSpendingRows = [];
      try {
        const actualSpendingQuery = `
          SELECT
            cd.id AS category_definition_id,
            cd.name AS category_name,
            cd.name_en AS category_name_en,
            cd.name_fr AS category_name_fr,
            cd.icon AS category_icon,
            cd.color AS category_color,
            cd.parent_id AS parent_category_id,
            SUM(ABS(t.price)) AS spent
          FROM transactions t
          LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
          LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
            ON t.identifier = tpe.transaction_identifier
            AND t.vendor = tpe.transaction_vendor
          WHERE t.status = 'completed'
            AND t.category_type = 'expense'
            AND tpe.transaction_identifier IS NULL
            AND t.date >= ? AND t.date <= ?
          GROUP BY cd.id, cd.name, cd.name_en, cd.name_fr, cd.icon, cd.color, cd.parent_id
        `;
        actualSpendingRows = db.prepare(actualSpendingQuery).all(budgetStartStr, todayStr);
      } catch (err) {
        console.warn('[Forecast] Could not load actual spending:', err.message);
      }

      // Category definitions cache (icons/colors/translations/hierarchy)
      const categoryDefinitions = {};
      const categoryDefinitionsById = {};
      try {
        const categoryQuery = `
          SELECT id, name, name_en, name_fr, icon, color, parent_id
          FROM category_definitions
          WHERE category_type = 'expense'
        `;
        const categories = db.prepare(categoryQuery).all();
        categories.forEach(cat => {
          categoryDefinitions[cat.name] = cat;
          if (cat.name_en) categoryDefinitions[cat.name_en] = cat;
          categoryDefinitionsById[cat.id] = cat;
        });
      } catch (err) {
        console.warn('[Forecast] Could not load category definitions:', err.message);
      }

      // Format minimal daily fields for response
      const dailyMinimal = (result.dailyForecasts || []).map(d => ({
        date: d.date,
        income: d.expectedIncome,
        expenses: d.expectedExpenses,
        cashFlow: d.expectedCashFlow,
        cumulativeCashFlow: d.cumulativeCashFlow,
        topCategory: d.topPredictions?.[0]?.category || null,
        topProbability: d.topPredictions?.[0]?.probability || null,
        topPredictions: (d.topPredictions || []).map(p => ({
          category: p.category,
          amount: p.expectedAmount,
          probability: p.probability
        }))
      }));

      const mapScenario = s => ({
        totalIncome: s.totalIncome,
        totalExpenses: s.totalExpenses,
        totalCashFlow: s.totalCashFlow,
        daily: (s.dailyResults || []).map(dr => ({
          date: dr.date,
          income: dr.income,
          expenses: dr.expenses,
          cashFlow: dr.cashFlow,
          cumulativeCashFlow: dr.cumulativeCashFlow
        }))
      });

      const summaries = {
        pessimistic: {
          netCashFlow: Math.round(result.scenarios?.p10?.totalCashFlow || 0),
          income: Math.round(result.scenarios?.p10?.totalIncome || 0),
          expenses: Math.round(result.scenarios?.p10?.totalExpenses || 0)
        },
        base: {
          netCashFlow: Math.round(result.scenarios?.p50?.totalCashFlow || 0),
          income: Math.round(result.scenarios?.p50?.totalIncome || 0),
          expenses: Math.round(result.scenarios?.p50?.totalExpenses || 0)
        },
        optimistic: {
          netCashFlow: Math.round(result.scenarios?.p90?.totalCashFlow || 0),
          income: Math.round(result.scenarios?.p90?.totalIncome || 0),
          expenses: Math.round(result.scenarios?.p90?.totalExpenses || 0)
        }
      };

      // Calculate actual end date (day before forecast starts)
      const forecastStart = parseLocalDate(result.forecastPeriod?.start);
      forecastStart.setDate(forecastStart.getDate() - 1);
      const actualEndDate = formatLocalDate(forecastStart);

      // Calculate total forecasted expenses by scenario for remaining month
      const forecastExpensesByScenario = {
        p10: 0,
        p50: 0,
        p90: 0
      };

      (result.scenarios?.p10?.dailyResults || [])
        .filter(d => d.date >= todayStr && d.date <= monthEndStr)
        .forEach(day => {
          forecastExpensesByScenario.p10 += day.expenses || 0;
        });

      (result.scenarios?.p50?.dailyResults || [])
        .filter(d => d.date >= todayStr && d.date <= monthEndStr)
        .forEach(day => {
          forecastExpensesByScenario.p50 += day.expenses || 0;
        });

      (result.scenarios?.p90?.dailyResults || [])
        .filter(d => d.date >= todayStr && d.date <= monthEndStr)
        .forEach(day => {
          forecastExpensesByScenario.p90 += day.expenses || 0;
        });

      const p50ScenarioExpenses = forecastExpensesByScenario.p50 || 0;
      const p10Ratio = p50ScenarioExpenses > 0 ? forecastExpensesByScenario.p10 / p50ScenarioExpenses : 1;
      const p90Ratio = p50ScenarioExpenses > 0 ? forecastExpensesByScenario.p90 / p50ScenarioExpenses : 1;

      // Load active monthly budgets (fallback to legacy schema if needed)
      let budgetRows = [];
      try {
        const budgetsQuery = `
          SELECT
            cb.id AS budget_id,
            cb.category_definition_id,
            cb.period_type,
            cb.budget_limit,
            cb.is_active,
            cd.name AS category_name,
            cd.name_en AS category_name_en,
            cd.name_fr AS category_name_fr,
            cd.icon AS category_icon,
            cd.color AS category_color,
            cd.parent_id AS parent_category_id
          FROM category_budgets cb
          JOIN category_definitions cd ON cd.id = cb.category_definition_id
          WHERE cb.is_active = 1
            AND cb.period_type = 'monthly'
        `;
        budgetRows = db.prepare(budgetsQuery).all();
      } catch (err) {
        if (err?.message && err.message.includes('category_definition_id')) {
          try {
            const legacyBudgetQuery = `
              SELECT id AS budget_id, category AS category_name, period_type, budget_limit, is_active
              FROM category_budgets
              WHERE is_active = 1 AND period_type = 'monthly'
            `;
            budgetRows = db.prepare(legacyBudgetQuery).all();
          } catch (legacyErr) {
            console.warn('[Forecast] Could not load budgets (legacy):', legacyErr.message);
          }
        } else {
          console.warn('[Forecast] Could not load budgets:', err.message);
        }
      }

      // Forecasted remaining spend by category (p50 baseline) for the rest of this month
      const forecastRemainingByCategory = new Map();
      const makeCategoryKey = (categoryDefinitionId, categoryName) =>
        categoryDefinitionId ? `id:${categoryDefinitionId}` : `name:${categoryName || 'unknown'}`;

      (result.dailyForecasts || [])
        .filter(d => d.date >= todayStr && d.date <= monthEndStr)
        .forEach(day => {
          (day.predictions || [])
            .filter(p => p.categoryType === 'expense')
            .forEach(p => {
              const catDef = categoryDefinitions[p.category] || categoryDefinitions[p.transactionName];
              const catId = catDef?.id || null;
              const catName = catDef?.name || p.category;
              const key = makeCategoryKey(catId, catName);
              const current = forecastRemainingByCategory.get(key) || { amount: 0, categoryDefinitionId: catId, categoryName: catName };
              current.amount += p.probabilityWeightedAmount || 0;
              current.categoryDefinitionId = catId || current.categoryDefinitionId;
              current.categoryName = catName || current.categoryName;
              forecastRemainingByCategory.set(key, current);
            });
        });

      // Aggregate outlook per category using actuals, budgets, and forecasted remaining spend
      const categoryData = new Map();
      const getCategoryEntry = (categoryDefinitionId, categoryName) => {
        const key = makeCategoryKey(categoryDefinitionId, categoryName);
        if (!categoryData.has(key)) {
          const catDef = categoryDefinitionId ? categoryDefinitionsById[categoryDefinitionId] : categoryDefinitions[categoryName];
          categoryData.set(key, {
            key,
            budgetId: null,
            categoryDefinitionId: catDef?.id || categoryDefinitionId || null,
            categoryName: catDef?.name || categoryName || 'Unknown',
            categoryNameEn: catDef?.name_en || categoryName || 'Unknown',
            categoryNameFr: catDef?.name_fr || catDef?.name_en || categoryName || 'Unknown',
            categoryIcon: catDef?.icon || null,
            categoryColor: catDef?.color || null,
            parentCategoryId: catDef?.parent_id ?? null,
            limit: 0,
            actualSpent: 0,
            forecasted: 0,
            projectedTotal: 0,
            utilization: 0,
            status: 'on_track',
            risk: 0,
            alertThreshold: 0.8,
            nextLikelyHitDate: null,
            actions: [],
            scenarios: { p10: 0, p50: 0, p90: 0 }
          });
        }
        return categoryData.get(key);
      };

      // Apply actual spending
      actualSpendingRows.forEach(row => {
        const spent = Math.round(row.spent || 0);
        if (!spent) return;
        const entry = getCategoryEntry(row.category_definition_id, row.category_name);
        entry.actualSpent += spent;
        if (row.parent_category_id && !entry.parentCategoryId) {
          entry.parentCategoryId = row.parent_category_id;
        }
        entry.categoryNameEn = entry.categoryNameEn || row.category_name_en || entry.categoryName;
        entry.categoryNameFr = entry.categoryNameFr || row.category_name_fr || row.category_name_en || entry.categoryName;
        entry.categoryIcon = entry.categoryIcon || row.category_icon || null;
        entry.categoryColor = entry.categoryColor || row.category_color || null;
      });

      // Apply budgets (pro-rated based on budgetDays)
      budgetRows.forEach(row => {
        const monthlyLimit = Number.parseFloat(row.budget_limit);
        if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) return;
        // Pro-rate: 30 days = 1x monthly, 60 days = 2x monthly, 90 days = 3x monthly
        const limit = monthlyLimit * budgetMultiplier;
        const entry = getCategoryEntry(row.category_definition_id, row.category_name);
        entry.limit = limit;
        entry.monthlyLimit = monthlyLimit; // Store original for reference
        entry.budgetId = row.budget_id || null;
        if (row.parent_category_id && !entry.parentCategoryId) {
          entry.parentCategoryId = row.parent_category_id;
        }
        entry.categoryNameEn = entry.categoryNameEn || row.category_name_en || entry.categoryName;
        entry.categoryNameFr = entry.categoryNameFr || row.category_name_fr || row.category_name_en || entry.categoryName;
        entry.categoryIcon = entry.categoryIcon || row.category_icon || null;
        entry.categoryColor = entry.categoryColor || row.category_color || null;
      });

      // Apply forecasted remaining spend
      forecastRemainingByCategory.forEach(forecast => {
        const entry = getCategoryEntry(forecast.categoryDefinitionId, forecast.categoryName);
        entry.forecasted += Math.round(forecast.amount || 0);
      });

      // Derive scenarios, projected totals, and risk/status
      categoryData.forEach(entry => {
        const p50Remaining = entry.forecasted;
        const p10Remaining = Math.round(p50Remaining * p10Ratio);
        const p90Remaining = Math.round(p50Remaining * p90Ratio);

        entry.scenarios = {
          p10: entry.actualSpent + p10Remaining,
          p50: entry.actualSpent + p50Remaining,
          p90: entry.actualSpent + p90Remaining
        };

        entry.projectedTotal = entry.scenarios.p50;
        if (entry.limit > 0) {
          const projectedUtilization = entry.projectedTotal / entry.limit;
          const actualUtilization = entry.actualSpent / entry.limit;

          if (entry.actualSpent >= entry.limit) {
            entry.status = 'exceeded';
            entry.risk = 1;
          } else if (projectedUtilization >= 1 || projectedUtilization >= 0.9 || actualUtilization >= 0.9) {
            entry.status = 'at_risk';
            entry.risk = Math.min(1, projectedUtilization);
          } else if (projectedUtilization >= 0.75) {
            entry.status = 'at_risk';
            entry.risk = Math.max(entry.risk, projectedUtilization);
          } else {
            entry.status = 'on_track';
            entry.risk = Math.max(entry.risk, projectedUtilization * 0.5);
          }

          entry.utilization = projectedUtilization * 100;
        } else {
          const p50Total = entry.scenarios.p50;
          const p90Total = entry.scenarios.p90;
          const p10Total = entry.scenarios.p10;

          if (entry.actualSpent > p90Total && p90Total > 0) {
            entry.status = 'exceeded';
            entry.risk = 1;
          } else if (entry.actualSpent > p50Total) {
            entry.status = 'at_risk';
            entry.risk = 0.7;
          } else if (entry.actualSpent > p10Total) {
            entry.status = 'at_risk';
            entry.risk = 0.4;
          } else {
            entry.status = 'on_track';
            entry.risk = 0.2;
          }

          entry.utilization = p50Total > 0 ? (entry.actualSpent / p50Total) * 100 : 0;
        }
      });

      const budgetOutlook = Array.from(categoryData.values()).filter(entry =>
        entry.limit > 0 || entry.actualSpent > 0 || entry.forecasted > 0
      );

      const budgetSummary = {
        totalBudgets: budgetOutlook.length,
        highRisk: budgetOutlook.filter(b => b.status === 'at_risk').length,
        exceeded: budgetOutlook.filter(b => b.status === 'exceeded').length,
        totalProjectedOverrun: budgetOutlook.reduce((sum, b) => {
          if (b.limit > 0) {
            return sum + Math.max(0, b.projectedTotal - b.limit);
          }
          return sum;
        }, 0),
        budgetDays, // Include the period used for budget calculations
        budgetMultiplier, // Include the pro-rate multiplier
      };

      const response = {
        forecastPeriod: result.forecastPeriod,
        dailyForecasts: dailyMinimal,
        scenarios: {
          p10: mapScenario(result.scenarios?.p10 || {}),
          p50: mapScenario(result.scenarios?.p50 || {}),
          p90: mapScenario(result.scenarios?.p90 || {})
        },
        summaries,
        actual: {
          endDate: actualEndDate,
          startDate: budgetStartStr, // Budget period start
        },
        budgetOutlook,
        budgetSummary
      };

      // Cache the response
      forecastCache.data = response;
      forecastCache.timestamp = Date.now();

      return res.json(response);
    } catch (error) {
      console.error('[Forecast] Generation error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to generate forecast',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      });
    }
  });

  return router;
}

module.exports = { createForecastRouter };
