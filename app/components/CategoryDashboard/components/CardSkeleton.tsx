import React from 'react';

interface CardSkeletonProps {
  size?: 'large' | 'medium';
}

const CardSkeleton: React.FC<CardSkeletonProps> = ({ size = 'medium' }) => {
  const padding = size === 'large' ? '28px' : '24px';
  const minHeight = size === 'large' ? '140px' : '180px';

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        padding: padding,
        width: '100%',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid #E2E8F0',
        minHeight: minHeight
      }}
    >
      {/* Shimmer effect overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '-100%',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.8), transparent)',
          animation: 'shimmer 1.5s infinite',
          pointerEvents: 'none'
        }}
      />

      <style>
        {`
          @keyframes shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
          }
        `}
      </style>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: size === 'large' ? 'center' : 'flex-start',
        gap: '16px'
      }}>
        <div style={{ flex: 1 }}>
          {/* Title skeleton */}
          <div style={{
            height: '14px',
            width: size === 'large' ? '140px' : '120px',
            backgroundColor: '#E2E8F0',
            borderRadius: '4px',
            marginBottom: '12px'
          }} />

          {/* Value skeleton */}
          <div style={{
            height: size === 'large' ? '42px' : '28px',
            width: size === 'large' ? '180px' : '140px',
            backgroundColor: '#CBD5E1',
            borderRadius: '6px',
            marginTop: size === 'large' ? '8px' : '16px'
          }} />
        </div>

        {/* Icon skeleton */}
        <div style={{
          width: size === 'large' ? '56px' : '48px',
          height: size === 'large' ? '56px' : '48px',
          backgroundColor: '#E2E8F0',
          borderRadius: '12px',
          flexShrink: 0
        }} />
      </div>
    </div>
  );
};

export default CardSkeleton;
