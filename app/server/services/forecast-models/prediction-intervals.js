function quantiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = probability => {
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

// Quantiles of each date's distribution, including cumulative balances.
// Summing daily quantiles or selecting a path by its final total cannot do this.
function buildPredictionIntervals(scenarios) {
  if (!scenarios.length) return { level: 0.8, daily: [] };
  const paths = scenarios.map(scenario => {
    let cashFlow = 0;
    let operatingCashFlow = 0;
    return scenario.dailyResults.map(day => {
      cashFlow += day.cashFlow;
      operatingCashFlow += day.operatingCashFlow ?? day.cashFlow;
      return { ...day, cumulativeCashFlow: cashFlow, cumulativeOperatingCashFlow: operatingCashFlow };
    });
  });
  const metrics = ['cashFlow', 'operatingCashFlow', 'expenses', 'cumulativeCashFlow', 'cumulativeOperatingCashFlow'];
  return {
    level: 0.8,
    daily: paths[0].map((day, index) => ({
      date: day.date,
      ...Object.fromEntries(metrics.map(metric => [metric,
        quantiles(paths.map(path => path[index][metric] ?? (metric === 'operatingCashFlow' ? path[index].cashFlow : NaN))),
      ])),
    })),
  };
}

module.exports = { quantiles, buildPredictionIntervals };
