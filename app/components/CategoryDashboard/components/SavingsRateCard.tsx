import React from 'react';
import { CircularProgress, Box } from '@mui/material';

interface SavingsRateCardProps {
  income: number;
  totalExpenses: number;
}

const SavingsRateCard: React.FC<SavingsRateCardProps> = ({ income, totalExpenses }) => {
  const savingsRate = income > 0 ? ((income - totalExpenses) / income) * 100 : 0;
  const targetRate = 20;

  const getColor = () => {
    if (savingsRate >= 20) return '#059669'; // Green
    if (savingsRate >= 10) return '#F59E0B'; // Yellow/Orange
    return '#DC2626'; // Red
  };

  const progressValue = Math.min((savingsRate / targetRate) * 100, 100);

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        padding: '24px 20px',
        border: '1px solid #F1F3F5',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '180px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: 'default'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Title */}
      <h3
        style={{
          margin: '0 0 16px 0',
          color: '#6B7280',
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          textAlign: 'center'
        }}
      >
        Savings Rate
      </h3>

      {/* Circular Progress */}
      <Box position="relative" display="inline-flex" marginBottom="12px">
        <CircularProgress
          variant="determinate"
          value={100}
          size={120}
          thickness={3}
          sx={{
            color: '#E5E7EB',
            position: 'absolute'
          }}
        />
        <CircularProgress
          variant="determinate"
          value={progressValue}
          size={120}
          thickness={3}
          sx={{
            color: getColor(),
            transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            '& .MuiCircularProgress-circle': {
              strokeLinecap: 'round'
            }
          }}
        />
        <Box
          top={0}
          left={0}
          bottom={0}
          right={0}
          position="absolute"
          display="flex"
          alignItems="center"
          justifyContent="center"
          flexDirection="column"
        >
          <span
            style={{
              fontSize: '36px',
              fontWeight: 700,
              color: getColor(),
              fontFamily: '"SF Mono", "IBM Plex Mono", ui-monospace, monospace',
              letterSpacing: '-0.03em',
              lineHeight: 1
            }}
          >
            {savingsRate.toFixed(0)}%
          </span>
        </Box>
      </Box>

      {/* Target */}
      <p
        style={{
          margin: 0,
          color: '#9CA3AF',
          fontSize: '12px',
          fontWeight: 500,
          textAlign: 'center'
        }}
        title="Financial advisors recommend saving at least 20% of your income"
      >
        Goal: {targetRate}%
      </p>

      {/* Status */}
      {savingsRate >= targetRate && (
        <p
          style={{
            margin: '8px 0 0 0',
            color: '#059669',
            fontSize: '11px',
            fontWeight: 600,
            textAlign: 'center'
          }}
        >
          ✓ On Track
        </p>
      )}
    </div>
  );
};

export default SavingsRateCard;
