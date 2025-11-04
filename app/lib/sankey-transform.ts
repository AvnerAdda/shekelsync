export type SankeyDataPoint = {
  name: string;
  value: number;
  type: 'income' | 'expense' | 'investment' | 'net';
  color: string;
  count: number;
};

export type SankeyNode = {
  name: string;
  color: string;
  count?: number;
  value?: number;
  nodeIndex?: number;
};

export type SankeyLink = {
  source: number;
  target: number;
  value: number;
  color?: string;
};

export type SankeyTransformResult = {
  nodes: SankeyNode[];
  links: SankeyLink[];
  hasFlow: boolean;
};

const MAX_EXPENSE_CATEGORIES = 4;
const MAX_INVESTMENT_CATEGORIES = 4;

export function transformToSankeyData(data: SankeyDataPoint[]): SankeyTransformResult {
  const incomeItems = data.filter((item) => item.type === 'income' && item.value > 0);
  const expenseItems = data.filter((item) => item.type === 'expense' && item.value < 0);
  const investmentItems = data.filter((item) => item.type === 'investment' && item.value < 0);

  const totalExpenses = Math.abs(expenseItems.reduce((sum, item) => sum + item.value, 0));
  const totalInvestments = Math.abs(investmentItems.reduce((sum, item) => sum + item.value, 0));

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  let nodeIndex = 0;

  // Income sources
  incomeItems.forEach((item) => {
    if (item.value <= 0) return;
    nodes.push({
      name: item.name,
      color: '#10b981',
      count: item.count,
      nodeIndex: nodeIndex++,
    });
  });

  const totalIncomeNodeIndex = nodeIndex++;
  nodes.push({
    name: 'Total Income',
    color: '#10b981',
    nodeIndex: totalIncomeNodeIndex,
  });

  let expensesTotalNodeIndex = -1;
  if (totalExpenses > 0) {
    expensesTotalNodeIndex = nodeIndex++;
    nodes.push({
      name: 'Expenses',
      color: '#ef4444',
      nodeIndex: expensesTotalNodeIndex,
    });
  }

  let investmentsTotalNodeIndex = -1;
  if (totalInvestments > 0) {
    investmentsTotalNodeIndex = nodeIndex++;
    nodes.push({
      name: 'Investments',
      color: '#3b82f6',
      nodeIndex: investmentsTotalNodeIndex,
    });
  }

  const sortedExpenses = [...expenseItems].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const topExpenses = sortedExpenses.slice(0, MAX_EXPENSE_CATEGORIES);
  const otherExpenses = sortedExpenses.slice(MAX_EXPENSE_CATEGORIES);

  const sortedInvestments = [...investmentItems].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const topInvestments = sortedInvestments.slice(0, MAX_INVESTMENT_CATEGORIES);
  const otherInvestments = sortedInvestments.slice(MAX_INVESTMENT_CATEGORIES);

  const expenseCategoryNodes: number[] = [];
  topExpenses.forEach((item) => {
    const value = Math.abs(item.value);
    if (value <= 0) return;
    const categoryNodeIndex = nodeIndex++;
    expenseCategoryNodes.push(categoryNodeIndex);
    nodes.push({
      name: item.name,
      color: '#ef4444',
      count: item.count,
      nodeIndex: categoryNodeIndex,
    });
  });

  if (otherExpenses.length > 0) {
    const otherTotal = otherExpenses.reduce((sum, item) => sum + Math.abs(item.value), 0);
    if (otherTotal > 0) {
      const categoryNodeIndex = nodeIndex++;
      expenseCategoryNodes.push(categoryNodeIndex);
      const otherCount = otherExpenses.reduce((sum, item) => sum + item.count, 0);
      nodes.push({
        name: 'Other Expenses',
        color: '#ef4444',
        count: otherCount,
        nodeIndex: categoryNodeIndex,
        value: otherTotal,
      });
    }
  }

  const investmentCategoryNodes: number[] = [];
  topInvestments.forEach((item) => {
    const value = Math.abs(item.value);
    if (value <= 0) return;
    const categoryNodeIndex = nodeIndex++;
    investmentCategoryNodes.push(categoryNodeIndex);
    nodes.push({
      name: item.name,
      color: '#3b82f6',
      count: item.count,
      nodeIndex: categoryNodeIndex,
    });
  });

  if (otherInvestments.length > 0) {
    const otherTotal = otherInvestments.reduce((sum, item) => sum + Math.abs(item.value), 0);
    if (otherTotal > 0) {
      const categoryNodeIndex = nodeIndex++;
      investmentCategoryNodes.push(categoryNodeIndex);
      const otherCount = otherInvestments.reduce((sum, item) => sum + item.count, 0);
      nodes.push({
        name: 'Other Investments',
        color: '#3b82f6',
        count: otherCount,
        nodeIndex: categoryNodeIndex,
        value: otherTotal,
      });
    }
  }

  incomeItems.forEach((_item, index) => {
    const value = Math.max(_item.value, 0);
    if (value <= 0) return;
    links.push({
      source: index,
      target: totalIncomeNodeIndex,
      value,
      color: '#10b98140',
    });
  });

  if (totalExpenses > 0 && expensesTotalNodeIndex !== -1) {
    links.push({
      source: totalIncomeNodeIndex,
      target: expensesTotalNodeIndex,
      value: totalExpenses,
      color: '#ef444440',
    });
  }

  if (totalInvestments > 0 && investmentsTotalNodeIndex !== -1) {
    links.push({
      source: totalIncomeNodeIndex,
      target: investmentsTotalNodeIndex,
      value: totalInvestments,
      color: '#3b82f640',
    });
  }

  if (totalExpenses > 0 && expensesTotalNodeIndex !== -1) {
    topExpenses.forEach((item, index) => {
      const targetIndex = expenseCategoryNodes[index];
      const value = Math.abs(item.value);
      if (targetIndex === undefined || value <= 0) return;
      links.push({
        source: expensesTotalNodeIndex,
        target: targetIndex,
        value,
        color: '#ef444440',
      });
    });

    if (otherExpenses.length > 0) {
      const otherTotal = otherExpenses.reduce((sum, item) => sum + Math.abs(item.value), 0);
      const targetIndex = expenseCategoryNodes[topExpenses.length];
      if (targetIndex !== undefined && otherTotal > 0) {
        links.push({
          source: expensesTotalNodeIndex,
          target: targetIndex,
          value: otherTotal,
          color: '#ef444440',
        });
      }
    }
  }

  if (totalInvestments > 0 && investmentsTotalNodeIndex !== -1) {
    topInvestments.forEach((item, index) => {
      const targetIndex = investmentCategoryNodes[index];
      const value = Math.abs(item.value);
      if (targetIndex === undefined || value <= 0) return;
      links.push({
        source: investmentsTotalNodeIndex,
        target: targetIndex,
        value,
        color: '#3b82f640',
      });
    });

    if (otherInvestments.length > 0) {
      const otherTotal = otherInvestments.reduce((sum, item) => sum + Math.abs(item.value), 0);
      const targetIndex = investmentCategoryNodes[topInvestments.length];
      if (targetIndex !== undefined && otherTotal > 0) {
        links.push({
          source: investmentsTotalNodeIndex,
          target: targetIndex,
          value: otherTotal,
          color: '#3b82f640',
        });
      }
    }
  }

  const totalFlow = links.reduce((sum, link) => sum + (link.value || 0), 0);
  return {
    nodes,
    links,
    hasFlow: totalFlow > 0 && nodes.length > 1,
  };
}

export default transformToSankeyData;
