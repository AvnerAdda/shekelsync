const express = require('express');
const { generateDailyForecast } = require('../services/forecast.js');

function createForecastRouter() {
  const router = express.Router();

  router.get('/daily', async (req, res) => {
    try {
      const { months, days, includeToday, verbose } = req.query;
      // Default to trimmed responses unless explicitly disabled
      const trimParam = req.query.trim;
      const trim = trimParam === undefined ? true : (trimParam === 'true' || trimParam === '1');
      const opts = {
        forecastMonths: months ? parseInt(months, 10) : undefined,
        forecastDays: days ? parseInt(days, 10) : undefined,
        includeToday: includeToday === 'true' || includeToday === '1',
        verbose: verbose === 'true' || verbose === '1',
      };
      console.log('[Forecast] Generating daily forecast...');
      const result = await generateDailyForecast(opts);
      console.log('[Forecast] Successfully generated forecast with', result.dailyForecasts?.length || 0, 'days');

      if (!trim) {
        return res.json(result);
      }

      // Trimmed payload for frontend: minimal daily fields + scenarios + summaries
      const dailyMinimal = (result.dailyForecasts || []).map(d => ({
        date: d.date,
        income: d.expectedIncome,
        expenses: d.expectedExpenses,
        cashFlow: d.expectedCashFlow,
        cumulativeCashFlow: d.cumulativeCashFlow,
        topCategory: d.topPredictions?.[0]?.category || null,
        topProbability: d.topPredictions?.[0]?.probability || null
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

      return res.json({
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
        }
      });
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
