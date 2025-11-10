import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import transformToSankeyData from '@/lib/sankey-transform';

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

  const sankeyData = useMemo(() => transformToSankeyData(data), [data]);
  const formatCurrencyValue = useCallback(
    (value: number) => formatCurrency(value, { absolute: true, maximumFractionDigits: 0 }),
    [formatCurrency],
  );

  // D3 Sankey rendering
  useEffect(() => {
    if (!svgRef.current || !sankeyData.hasFlow) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const width = 1400 - margin.left - margin.right; // Even wider for better spacing
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Create sankey layout with more columns
    const sankeyLayout = sankey<Record<string, unknown>, Record<string, unknown>>()
      .nodeWidth(60)  // Thinner for minimalist look
      .nodePadding(15) // More spacing
      .extent([[0, 0], [width, chartHeight]]);

    const sankeyGraph = {
      nodes: sankeyData.nodes.map((node) => ({ ...node })),
      links: sankeyData.links.map((link) => ({ ...link })),
    };
    const { nodes, links } = sankeyLayout(sankeyGraph);

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
      sankeyLayout.update(sankeyGraph);
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

  }, [height, formatCurrencyValue, maskAmounts, sankeyData]);

  if (!sankeyData.hasFlow) {
    return (
      <Box>
        {title && (
          <Typography variant="h6" gutterBottom>
            {title}
          </Typography>
        )}
        <Box
          sx={{
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'grey.50',
            borderRadius: 2,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Not enough data to visualize financial flow yet.
          </Typography>
        </Box>
      </Box>
    );
  }

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
