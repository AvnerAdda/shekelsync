import React from 'react';
import { SvgIconComponent } from '@mui/icons-material';
import CircularProgress from '@mui/material/CircularProgress';
import { useFinancePrivacy } from '../../../contexts/FinancePrivacyContext';
import TrendBadge from './TrendBadge';

interface CardProps {
  title: string;
  subtitle?: string;
  value: number;
  color: string;
  icon: SvgIconComponent;
  onClick?: () => void;
  isLoading?: boolean;
  size?: 'large' | 'medium';
  clickable?: boolean;
  secondaryValue?: number;
  secondaryColor?: string;
  secondaryLabel?: string;
  trend?: number; // percentage change from previous period
  isExpense?: boolean; // for trend color logic
}

const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  value,
  color,
  icon: Icon,
  onClick,
  isLoading = false,
  size = 'medium',
  secondaryValue,
  secondaryColor,
  secondaryLabel,
  trend,
  isExpense = true
}) => {
  const padding = size === 'large' ? '24px 20px' : '20px';
  const titleSize = size === 'large' ? '13px' : '13px';
  const valueSize = size === 'large' ? '36px' : '32px';
  const iconSize = size === 'large' ? '22px' : '20px';
  const { formatCurrency } = useFinancePrivacy();

  const formatCurrencyValue = (amount: number) =>
    formatCurrency(amount, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        padding: padding,
        width: '100%',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'visible',
        border: '1px solid #F1F3F5',
        cursor: onClick ? (isLoading ? 'default' : 'pointer') : 'default',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        minHeight: size === 'large' ? '140px' : '180px'
      }}
      onClick={isLoading ? undefined : onClick}
      onMouseEnter={(e) => {
        if (!isLoading && onClick) {
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)';
          (e.currentTarget as HTMLDivElement).style.borderColor = '#E5E7EB';
        }
      }}
      onMouseLeave={(e) => {
        if (!isLoading) {
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)';
          (e.currentTarget as HTMLDivElement).style.borderColor = '#F1F3F5';
        }
      }}
    >
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
          borderRadius: '16px'
        }}>
          <CircularProgress size={32} style={{ color: '#6B7280' }} />
        </div>
      )}

      {/* Trend Badge - Top Right */}
      {trend !== undefined && trend !== 0 && !isLoading && (
        <div style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          zIndex: 1
        }}>
          <TrendBadge change={trend} isExpense={isExpense} size="small" />
        </div>
      )}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%'
      }}>
        {/* Icon - Simple, minimal */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '8px'
        }}>
          <Icon sx={{
            fontSize: iconSize,
            color: '#9CA3AF',
            opacity: 0.5
          }} />
          <h3 style={{
            margin: 0,
            color: '#6B7280',
            fontSize: titleSize,
            fontWeight: 500,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            flex: 1
          }}>{title}</h3>
        </div>

        {/* Value - Large and prominent */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ marginBottom: subtitle || secondaryValue ? '6px' : '0' }}>
            <span style={{
              fontSize: valueSize,
              fontWeight: '700',
              color: '#0F1419',
              letterSpacing: '-0.03em',
              fontFamily: '"SF Mono", "IBM Plex Mono", ui-monospace, monospace',
              fontFeatureSettings: '"tnum"'
            }}>
              {formatCurrencyValue(value || 0)}
            </span>
          </div>

          {/* Secondary Value */}
          {secondaryValue !== undefined && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#9CA3AF'
              }}>
                {secondaryLabel || 'Expenses'}:
              </span>
              <span style={{
                fontSize: '18px',
                fontWeight: 700,
                color: secondaryColor || '#EF4444',
                fontFamily: '"SF Mono", "IBM Plex Mono", ui-monospace, monospace',
                fontFeatureSettings: '"tnum"'
              }}>
                {formatCurrencyValue(secondaryValue)}
              </span>
            </div>
          )}

          {/* Subtitle */}
          {subtitle && (
            <p style={{
              margin: '4px 0 0 0',
              color: '#9CA3AF',
              fontSize: '12px',
              fontWeight: 400,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Card; 