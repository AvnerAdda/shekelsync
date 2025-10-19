import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';

interface SankeyDataPoint {
  name: string;
  value: number;
  type: 'income' | 'expense' | 'investment' | 'net';
  color: string;
  count: number;
}

interface SankeyChartProps {
  data: SankeyDataPoint[];
  height?: number;
  title?: string;
}

const SankeyChart: React.FC<SankeyChartProps> = ({
  data,
  height = 400,
  title = 'Financial Flow'
}) => {
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const svgRef = useRef<SVGSVGElement>(null);

  // Transform data for D3 Sankey: income sources → total → expense/investment totals → individual categories
  const transformToD3SankeyData = () => {
    const incomeItems = data.filter(item => item.type === 'income' && item.value > 0);
    const expenseItems = data.filter(item => item.type === 'expense' && item.value < 0);
    const investmentItems = data.filter(item => item.type === 'investment' && item.value < 0);

    const totalExpenses = Math.abs(expenseItems.reduce((sum, item) => sum + item.value, 0));
    const totalInvestments = Math.abs(investmentItems.reduce((sum, item) => sum + item.value, 0));

    const nodes: any[] = [];
    const links: any[] = [];
    let nodeIndex = 0;

    // Column 1: Individual income sources
    incomeItems.forEach(item => {
      nodes.push({
        name: item.name,
        color: '#10b981',
        count: item.count,
        nodeIndex: nodeIndex++
      });
    });

    // Column 2: Total income
    const totalIncomeNodeIndex = nodeIndex++;
    nodes.push({
      name: 'Total Income',
      color: '#10b981',
      nodeIndex: totalIncomeNodeIndex
    });

    // Column 3: Expense/Investment/Remaining totals
    const expensesTotalNodeIndex = nodeIndex++;
    if (totalExpenses > 0) {
      nodes.push({
        name: 'Expenses',
        color: '#ef4444',
        nodeIndex: expensesTotalNodeIndex
      });
    }

    const investmentsTotalNodeIndex = nodeIndex++;
    if (totalInvestments > 0) {
      nodes.push({
        name: 'Investments',
        color: '#3b82f6',
        nodeIndex: investmentsTotalNodeIndex
      });
    }


    // Column 4: Top 5 expense and investment categories, group rest as "Other"

    // Sort expenses by value (largest first) and take top 4
    const sortedExpenses = [...expenseItems].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const top4Expenses = sortedExpenses.slice(0, 4);
    const otherExpenses = sortedExpenses.slice(4);

    // Sort investments by value (largest first) and take top 4
    const sortedInvestments = [...investmentItems].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const top4Investments = sortedInvestments.slice(0, 4);
    const otherInvestments = sortedInvestments.slice(4);

    const expenseCategoryNodes: number[] = [];

    // Add top 5 expense categories
    top4Expenses.forEach(item => {
      const categoryNodeIndex = nodeIndex++;
      expenseCategoryNodes.push(categoryNodeIndex);
      nodes.push({
        name: item.name,
        color: '#ef4444',
        count: item.count,
        nodeIndex: categoryNodeIndex
      });
    });

    // Add "Other Expenses" if there are more than 5
    if (otherExpenses.length > 0) {
      const categoryNodeIndex = nodeIndex++;
      expenseCategoryNodes.push(categoryNodeIndex);
      const otherExpensesTotal = otherExpenses.reduce((sum, item) => sum + Math.abs(item.value), 0);
      const otherExpensesCount = otherExpenses.reduce((sum, item) => sum + item.count, 0);
      nodes.push({
        name: 'Other Expenses',
        color: '#ef4444',
        count: otherExpensesCount,
        nodeIndex: categoryNodeIndex,
        value: otherExpensesTotal
      });
    }

    const investmentCategoryNodes: number[] = [];

    // Add top 4 investment categories
    top4Investments.forEach(item => {
      const categoryNodeIndex = nodeIndex++;
      investmentCategoryNodes.push(categoryNodeIndex);
      nodes.push({
        name: item.name,
        color: '#3b82f6',
        count: item.count,
        nodeIndex: categoryNodeIndex
      });
    });

    // Add "Other Investments" if there are more than 5
    if (otherInvestments.length > 0) {
      const categoryNodeIndex = nodeIndex++;
      investmentCategoryNodes.push(categoryNodeIndex);
      const otherInvestmentsTotal = otherInvestments.reduce((sum, item) => sum + Math.abs(item.value), 0);
      const otherInvestmentsCount = otherInvestments.reduce((sum, item) => sum + item.count, 0);
      nodes.push({
        name: 'Other Investments',
        color: '#3b82f6',
        count: otherInvestmentsCount,
        nodeIndex: categoryNodeIndex,
        value: otherInvestmentsTotal
      });
    }

    // Links: Column 1 → Column 2 (income sources → total income)
    incomeItems.forEach((item, index) => {
      links.push({
        source: index,
        target: totalIncomeNodeIndex,
        value: item.value,
        color: '#10b98140'
      });
    });

    // Links: Column 2 → Column 3 (total income → expense/investment/remaining totals)
    if (totalExpenses > 0) {
      links.push({
        source: totalIncomeNodeIndex,
        target: expensesTotalNodeIndex,
        value: totalExpenses,
        color: '#ef444440'
      });
    }

    if (totalInvestments > 0) {
      links.push({
        source: totalIncomeNodeIndex,
        target: investmentsTotalNodeIndex,
        value: totalInvestments,
        color: '#3b82f640'
      });
    }


    // Links: Column 3 → Column 4 (expense total → top 5 expense categories + other)
    if (totalExpenses > 0) {
      // Links to top 5 expenses
      top4Expenses.forEach((item, index) => {
        links.push({
          source: expensesTotalNodeIndex,
          target: expenseCategoryNodes[index],
          value: Math.abs(item.value),
          color: '#ef444440'
        });
      });

      // Link to "Other Expenses" if it exists
      if (otherExpenses.length > 0) {
        const otherExpensesTotal = otherExpenses.reduce((sum, item) => sum + Math.abs(item.value), 0);
        links.push({
          source: expensesTotalNodeIndex,
          target: expenseCategoryNodes[top4Expenses.length], // Index after top 5
          value: otherExpensesTotal,
          color: '#ef444440'
        });
      }
    }

    // Links: Column 3 → Column 4 (investment total → top 4 investment categories + other)
    if (totalInvestments > 0) {
      // Links to top 4 investments
      top4Investments.forEach((item, index) => {
        links.push({
          source: investmentsTotalNodeIndex,
          target: investmentCategoryNodes[index],
          value: Math.abs(item.value),
          color: '#3b82f640'
        });
      });

      // Link to "Other Investments" if it exists
      if (otherInvestments.length > 0) {
        const otherInvestmentsTotal = otherInvestments.reduce((sum, item) => sum + Math.abs(item.value), 0);
        links.push({
          source: investmentsTotalNodeIndex,
          target: investmentCategoryNodes[top4Investments.length], // Index after top 4
          value: otherInvestmentsTotal,
          color: '#3b82f640'
        });
      }
    }


    return { nodes, links };
  };

  const sankeyData = transformToD3SankeyData();
  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  // D3 Sankey rendering
  useEffect(() => {
    if (!svgRef.current || !sankeyData.nodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const width = 1400 - margin.left - margin.right; // Even wider for better spacing
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Create sankey layout with more columns
    const sankeyLayout = sankey<{}, {}>()
      .nodeWidth(60)  // Thinner for minimalist look
      .nodePadding(15) // More spacing
      .extent([[0, 0], [width, chartHeight]]);

    const { nodes, links } = sankeyLayout(sankeyData);

    // Force color grouping in the rightmost column by manually adjusting Y positions
    const column4Nodes = nodes.filter((node: any) => {
      // Find nodes in the rightmost column (highest x position)
      const maxX = Math.max(...nodes.map((n: any) => n.x0));
      return Math.abs(node.x0 - maxX) < 10; // nodes in rightmost column
    });

    if (column4Nodes.length > 0) {
      // Sort by color: red (expenses) first, then blue (investments)
      const sortedColumn4 = column4Nodes.sort((a: any, b: any) => {
        const colorOrder: Record<string, number> = { '#ef4444': 0, '#3b82f6': 1 };
        return (colorOrder[a.color] || 0) - (colorOrder[b.color] || 0);
      });

      // Redistribute Y positions to group by color
      const nodePadding = 15;
      let currentY = 20; // Start position

      sortedColumn4.forEach((node: any) => {
        const height = node.y1 - node.y0;
        node.y0 = currentY;
        node.y1 = currentY + height;
        currentY += height + nodePadding;
      });

      // Recalculate Sankey layout to fix link connections after repositioning
      sankeyLayout.update(sankeyData);
    }


    // Draw links with smoother curves
    g.append('g')
      .selectAll('path')
      .data(links)
      .enter()
      .append('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', (d: any) => d.color || '#999')
      .attr('stroke-opacity', 0.4) // More subtle
      .attr('stroke-width', (d: any) => Math.max(2, d.width))
      .attr('fill', 'none')
      .style('cursor', 'pointer')
      .append('title')
      .text((d: any) => `${d.source.name} → ${d.target.name}: ${formatCurrencyValue(d.value)}`);

    // Draw nodes with rounded corners
    const nodeGroups = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g');

    nodeGroups
      .append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('height', (d: any) => d.y1 - d.y0)
      .attr('rx', 8) // Rounded corners
      .attr('ry', 8) // Rounded corners
      .attr('fill', (d: any) => d.color || '#999')
      .attr('stroke', 'none') // No stroke for cleaner look
      .style('cursor', 'pointer')
      .style('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))') // Subtle shadow
      .append('title')
      .text((d: any) => `${d.name}: ${formatCurrencyValue(d.value || 0)}${
        d.count ? ` (${d.count} transactions)` : ''
      }`);

    // Add labels with better typography
    nodeGroups
      .append('text')
      .attr('x', (d: any) => (d.x0 + d.x1) / 2)
      .attr('y', (d: any) => (d.y0 + d.y1) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', 'white')
      .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
      .text((d: any) => {
        // Truncate long names
        return d.name.length > 12 ? d.name.substring(0, 10) + '...' : d.name;
      });

    // Add value labels if not masked
    if (!maskAmounts) {
      nodeGroups
        .append('text')
        .attr('x', (d: any) => (d.x0 + d.x1) / 2)
        .attr('y', (d: any) => (d.y0 + d.y1) / 2 + 14)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('font-weight', '500')
        .attr('fill', 'white')
        .attr('opacity', 0.8)
        .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
        .text((d: any) => formatCurrencyValue(d.value || 0));
    }

  }, [data, height, formatCurrencyValue, maskAmounts, sankeyData]);

  return (
    <Box>
      {title && (
        <Typography variant="h6" gutterBottom>
          {title}
        </Typography>
      )}
      <Box sx={{ width: '100%', overflowX: 'auto' }}>
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          viewBox={`0 0 1400 ${height}`}
        />
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 2, mt: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#10b981', borderRadius: 0.5 }} />
          <Typography variant="caption">Income</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#ef4444', borderRadius: 0.5 }} />
          <Typography variant="caption">Expenses</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#3b82f6', borderRadius: 0.5 }} />
          <Typography variant="caption">Investments</Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default SankeyChart;