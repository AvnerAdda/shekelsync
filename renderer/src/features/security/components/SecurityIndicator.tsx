import React, { useState, useEffect } from 'react';
import { IconButton, Tooltip, Badge, alpha, useTheme } from '@mui/material';
import { Shield as ShieldIcon } from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';

interface SecurityIndicatorProps {
  onClick?: () => void;
}

type SecurityLevel = 'secure' | 'warning' | 'error' | 'unknown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseSecuritySummaryLevel(payload: unknown): SecurityLevel {
  if (!isRecord(payload)) {
    return 'unknown';
  }

  const nestedData = isRecord(payload.data) ? payload.data : null;
  const rawLevel = nestedData?.level ?? payload.level;

  if (rawLevel === 'secure' || rawLevel === 'warning' || rawLevel === 'error' || rawLevel === 'unknown') {
    return rawLevel;
  }

  return 'unknown';
}

export function getSecurityTooltip(level: SecurityLevel): string {
  switch (level) {
    case 'secure':
      return 'Security: All systems secure';
    case 'warning':
      return 'Security: Warning - Check details';
    case 'error':
      return 'Security: Issues detected';
    default:
      return 'Security status unknown';
  }
}

const SecurityIndicator: React.FC<SecurityIndicatorProps> = ({ onClick }) => {
  const theme = useTheme();
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>('unknown');
  const [tooltip, setTooltip] = useState('Loading security status...');

  const fetchSecurityStatus = async () => {
    try {
      const response = await apiClient.get('/api/security/summary');

      if (!response.ok) {
        throw new Error('Failed to fetch security summary');
      }

      const level = parseSecuritySummaryLevel(response.data);
      setSecurityLevel(level);
      setTooltip(getSecurityTooltip(level));
    } catch (err) {
      console.error('[SecurityIndicator] Error fetching status:', err);
      setSecurityLevel('unknown');
      setTooltip('Security status unavailable');
    }
  };

  useEffect(() => {
    fetchSecurityStatus();

    // Refresh every 60 seconds
    const interval = setInterval(fetchSecurityStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const getSecurityColor = () => {
    switch (securityLevel) {
      case 'secure':
        return theme.palette.success.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'error':
        return theme.palette.error.main;
      default:
        return theme.palette.text.disabled;
    }
  };

  const showBadge = securityLevel === 'warning' || securityLevel === 'error';

  return (
    <Tooltip title={tooltip}>
      <IconButton
        size="small"
        onClick={onClick}
        sx={{
          width: 36,
          height: 36,
          color: theme.palette.text.secondary,
          borderRadius: 2,
          transition: 'all 0.2s',
          '&:hover': {
            backgroundColor: alpha(getSecurityColor(), 0.1),
            color: getSecurityColor(),
            transform: 'translateY(-2px)',
          },
        }}
      >
        <Badge
          variant="dot"
          invisible={!showBadge}
          sx={{
            '& .MuiBadge-badge': {
              backgroundColor: getSecurityColor(),
              boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
            },
          }}
        >
          <ShieldIcon
            sx={{
              fontSize: 20,
              color: getSecurityColor(),
            }}
          />
        </Badge>
      </IconButton>
    </Tooltip>
  );
};

export default SecurityIndicator;
