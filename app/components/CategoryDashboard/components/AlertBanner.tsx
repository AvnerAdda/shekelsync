import React, { useState } from 'react';
import { IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

interface AlertBannerProps {
  message: string;
  count?: number;
  onAction?: () => void;
  actionLabel?: string;
  severity?: 'info' | 'warning' | 'error';
}

const AlertBanner: React.FC<AlertBannerProps> = ({
  message,
  count,
  onAction,
  actionLabel = 'Review',
  severity = 'warning'
}) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const getSeverityColors = () => {
    switch (severity) {
      case 'error':
        return {
          bg: '#FEE2E2',
          text: '#991B1B',
          border: '#FCA5A5'
        };
      case 'info':
        return {
          bg: '#DBEAFE',
          text: '#1E40AF',
          border: '#93C5FD'
        };
      default: // warning
        return {
          bg: '#FEF3C7',
          text: '#92400E',
          border: '#FDE68A'
        };
    }
  };

  const colors = getSeverityColors();

  return (
    <div
      style={{
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '12px',
        padding: '12px 20px',
        marginBottom: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        animation: 'slideIn 0.3s ease-out',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
      }}
    >
      <style>
        {`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(-8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
        <WarningAmberIcon sx={{ color: colors.text, fontSize: '20px' }} />
        <span
          style={{
            color: colors.text,
            fontSize: '14px',
            fontWeight: 500,
            letterSpacing: '-0.01em'
          }}
        >
          {message}
          {count !== undefined && (
            <span
              style={{
                marginLeft: '6px',
                backgroundColor: colors.text + '20',
                padding: '2px 8px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                fontFamily: '"SF Mono", "IBM Plex Mono", ui-monospace, monospace'
              }}
            >
              {count}
            </span>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {onAction && (
          <button
            onClick={onAction}
            style={{
              backgroundColor: colors.text,
              color: colors.bg,
              border: 'none',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {actionLabel} →
          </button>
        )}

        <IconButton
          size="small"
          onClick={() => setDismissed(true)}
          sx={{
            color: colors.text,
            padding: '4px',
            '&:hover': {
              backgroundColor: colors.text + '15'
            }
          }}
        >
          <CloseIcon sx={{ fontSize: '18px' }} />
        </IconButton>
      </div>
    </div>
  );
};

export default AlertBanner;
