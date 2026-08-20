export function getIncomeExpenseYAxisConfig(yAxisScale: 'linear' | 'log') {
  return yAxisScale === 'log'
    ? {
        domain: [0, 'dataMax'] as [number, 'dataMax'],
        allowDataOverflow: false,
      }
    : {
        domain: [0, 'auto'] as [number, 'auto'],
        allowDataOverflow: true,
      };
}
