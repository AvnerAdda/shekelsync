const express = require('express');
const { generateDailyForecast } = require('../services/forecast.js');

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

      // Generate budget outlook from forecast and category patterns
      const budgetOutlook = (result.categoryPatterns || [])
        .filter(p => p.categoryType === 'expense')
        .map(pattern => ({
          budgetId: null,
          categoryDefinitionId: null,
          categoryName: pattern.category,
          categoryNameEn: pattern.category,
          categoryIcon: null,
          categoryColor: null,
          parentCategoryId: null,
          limit: 0, // No limit set
          actualSpent: 0,
          forecasted: Math.round(pattern.avgAmount * pattern.avgOccurrencesPerMonth),
          projectedTotal: Math.round(pattern.avgAmount * pattern.avgOccurrencesPerMonth),
          utilization: 0,
          status: 'on_track',
          risk: 0,
          alertThreshold: 0.8,
          nextLikelyHitDate: null,
          actions: []
        }));

      const budgetSummary = {
        totalBudgets: budgetOutlook.length,
        highRisk: 0,
        exceeded: 0,
        totalProjectedOverrun: 0
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
