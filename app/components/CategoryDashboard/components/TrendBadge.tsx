import React from 'react';

interface TrendBadgeProps {
  change: number;
  isExpense?: boolean; // true for expenses, false for income
  size?: 'small' | 'medium';
}

const TrendBadge: React.FC<TrendBadgeProps> = ({
  change,
  isExpense = true,
  size = 'small'
}) => {
  // For expenses: decrease is good (green), increase is bad (red)
  // For income: increase is good (green), decrease is bad (red)
  const isPositiveChange = change > 0;
  const isFavorable = isExpense ? !isPositiveChange : isPositiveChange;
  const isNeutral = Math.abs(change) < 5;

  const getColor = () => {
    if (isNeutral) return '#9CA3AF';
    return isFavorable ? '#059669' : '#DC2626';
  };

  const getBackgroundColor = () => {
    if (isNeutral) return '#9CA3AF15';
    return isFavorable ? '#05966915' : '#DC262615';
  };

  const arrow = isPositiveChange ? '↑' : '↓';
  const fontSize = size === 'small' ? '11px' : '12px';
  const padding = size === 'small' ? '3px 7px' : '4px 9px';

  if (change === 0) return null;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: padding,
        borderRadius: '12px',
        backgroundColor: getBackgroundColor(),
        color: getColor(),
        fontSize: fontSize,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        fontFamily: '"SF Mono", "IBM Plex Mono", ui-monospace, monospace',
        transition: 'all 0.2s ease',
        cursor: 'help',
        userSelect: 'none'
      }}
      title={`${Math.abs(change).toFixed(1)}% vs last month`}
    >
      <span style={{ fontSize: size === 'small' ? '10px' : '11px' }}>{arrow}</span>
      <span>{Math.abs(change).toFixed(0)}%</span>
    </div>
  );
};

export default TrendBadge;
