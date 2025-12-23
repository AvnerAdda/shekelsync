const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { generateDailyForecast } = require('../services/forecast.js');

// Initialize database for category lookups
const dbPath = path.join(__dirname, '../../dist/clarify.sqlite');
let dbInstance = null;

function getDatabase() {
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

function createForecastRouter() {
  const router = express.Router();

  router.get('/daily', async (req, res) => {
    try {
      const { months, days, includeToday, verbose, noCache } = req.query;
      const skipCache = noCache === 'true' || noCache === '1';

      // Check cache first (unless explicitly skipped)
      if (!skipCache && isCacheValid()) {
        console.log('[Forecast] Returning cached forecast result');
        return res.json(forecastCache.data);
      }

      // Default to forecast until end of current month (not 6 months)
      const now = new Date();
      const daysUntilEndOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

      let forecastDaysValue;
      let forecastMonthsValue;

      if (days) {
        forecastDaysValue = Number.parseInt(days, 10);
      } else {
        forecastDaysValue = daysUntilEndOfMonth;
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

      // Build actual spending by category for this month (for budget status)
      // Use full result data which has predictions before response is trimmed
      let actualSpendingByCategory = {};
      try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const categorySpending = result.dailyForecasts
          .filter(d => d.date <= todayStr)
          .flatMap(d => d.predictions || [])
          .filter(p => p.categoryType === 'expense')
          .reduce((acc, p) => {
            const cat = p.category;
            acc[cat] = (acc[cat] || 0) + p.probabilityWeightedAmount;
            return acc;
          }, {});
        actualSpendingByCategory = categorySpending;
      } catch (err) {
        console.warn('[Forecast] Could not calculate actual spending:', err.message);
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
      const forecastStart = new Date(result.forecastPeriod?.start);
      forecastStart.setDate(forecastStart.getDate() - 1);
      const actualEndDate = forecastStart.toISOString().split('T')[0];

      // Build category spending map from scenarios for budget status
      const categoryP10 = {};
      const categoryP50 = {};
      const categoryP90 = {};

      // Sum up spending by category from each scenario
      (result.scenarios?.p10?.dailyResults || []).forEach(day => {
        // Rough estimate: distribute expenses by pattern frequency
        (result.categoryPatterns || []).forEach(pattern => {
          if (pattern.categoryType === 'expense') {
            const key = pattern.category;
            const monthlyShare = (pattern.avgAmount * pattern.avgOccurrencesPerMonth) / 30; // Daily average
            categoryP10[key] = (categoryP10[key] || 0) + monthlyShare;
          }
        });
      });

      (result.scenarios?.p50?.dailyResults || []).forEach(day => {
        (result.categoryPatterns || []).forEach(pattern => {
          if (pattern.categoryType === 'expense') {
            const key = pattern.category;
            const monthlyShare = (pattern.avgAmount * pattern.avgOccurrencesPerMonth) / 30;
            categoryP50[key] = (categoryP50[key] || 0) + monthlyShare;
          }
        });
      });

      (result.scenarios?.p90?.dailyResults || []).forEach(day => {
        (result.categoryPatterns || []).forEach(pattern => {
          if (pattern.categoryType === 'expense') {
            const key = pattern.category;
            const monthlyShare = (pattern.avgAmount * pattern.avgOccurrencesPerMonth) / 30;
            categoryP90[key] = (categoryP90[key] || 0) + monthlyShare;
          }
        });
      });

      // Get category definitions for icons, colors, and translations
      const categoryDefinitions = {};
      try {
        const db = getDatabase();
        const categoryQuery = `
          SELECT id, name, name_en, name_fr, icon, color
          FROM category_definitions
          WHERE category_type = 'expense'
        `;
        const categories = db.prepare(categoryQuery).all();
        categories.forEach(cat => {
          categoryDefinitions[cat.name] = cat;
          if (cat.name_en) categoryDefinitions[cat.name_en] = cat;
        });
      } catch (err) {
        console.warn('[Forecast] Could not load category definitions:', err.message);
      }

      // Generate budget outlook from forecast and category patterns
      const budgetOutlook = (result.categoryPatterns || [])
        .filter(p => p.categoryType === 'expense')
        .map(pattern => {
          const monthlyForecast = Math.round(pattern.avgAmount * pattern.avgOccurrencesPerMonth);
          const p10Value = Math.round(categoryP10[pattern.category] || monthlyForecast * 0.8);
          const p50Value = Math.round(categoryP50[pattern.category] || monthlyForecast);
          const p90Value = Math.round(categoryP90[pattern.category] || monthlyForecast * 1.2);

          // Use actual spending from historical data, or estimate if not available
          const actualSpent = Math.round(actualSpendingByCategory[pattern.category] || monthlyForecast * 0.45);

          // Determine status based on where actual spending falls
          let status = 'on_track'; // <= p10
          let risk = 0;

          if (actualSpent > p90Value) {
            status = 'exceeded'; // > p90
            risk = 1;
          } else if (actualSpent > p50Value) {
            status = 'at_risk'; // p50 < actual <= p90
            risk = 0.7;
          } else if (actualSpent > p10Value) {
            status = 'at_risk'; // p10 < actual <= p50
            risk = 0.4;
          }

          // Look up category definition for icon, color, and translations
          const categoryDef = categoryDefinitions[pattern.category];

          return {
            budgetId: null,
            categoryDefinitionId: categoryDef?.id || null,
            categoryName: categoryDef?.name || pattern.category,
            categoryNameEn: categoryDef?.name_en || pattern.category,
            categoryNameFr: categoryDef?.name_fr || pattern.category,
            categoryIcon: categoryDef?.icon || null,
            categoryColor: categoryDef?.color || null,
            parentCategoryId: null,
            limit: 0,
            actualSpent,
            forecasted: monthlyForecast,
            projectedTotal: monthlyForecast,
            utilization: monthlyForecast > 0 ? (actualSpent / monthlyForecast) * 100 : 0,
            status,
            risk,
            alertThreshold: 0.8,
            nextLikelyHitDate: null,
            actions: [],
            scenarios: {
              p10: p10Value,
              p50: p50Value,
              p90: p90Value
            }
          };
        });

      const budgetSummary = {
        totalBudgets: budgetOutlook.length,
        highRisk: budgetOutlook.filter(b => b.status === 'at_risk').length,
        exceeded: budgetOutlook.filter(b => b.status === 'exceeded').length,
        totalProjectedOverrun: budgetOutlook.reduce((sum, b) => {
          if (b.status === 'exceeded') return sum + (b.actualSpent - b.forecasted);
          return sum;
        }, 0)
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
          endDate: actualEndDate
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
