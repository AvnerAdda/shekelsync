export function getIncomeExpenseYAxisConfig(
  yAxisScale: 'linear' | 'log',
  hasInvestmentWithdrawals = false,
) {
  if (hasInvestmentWithdrawals) {
    return {
      domain: ['dataMin', 'auto'] as ['dataMin', 'auto'],
      allowDataOverflow: false,
    };
  }

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

export function getLogScaleData(history: any[]) {
  return (history || []).map((item) => ({
    ...item,
    income: item.income == null ? item.income : Math.log10(Math.max(1, item.income)),
    expenses: item.expenses == null ? item.expenses : Math.log10(Math.max(1, item.expenses)),
    // Keep withdrawals below zero and missing historical/forecast values absent.
    investments: item.investments == null
      ? item.investments
      : Math.sign(item.investments) * Math.log10(Math.max(1, Math.abs(item.investments))),
    originalIncome: item.income,
    originalExpenses: item.expenses,
    originalInvestments: item.investments,
  }));
}
