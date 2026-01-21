import React, { useState, useEffect } from 'react';
import { IconButton, Tooltip, Badge, alpha, useTheme } from '@mui/material';
import { Shield as ShieldIcon } from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';

interface SecurityIndicatorProps {
  onClick?: () => void;
}

const SecurityIndicator: React.FC<SecurityIndicatorProps> = ({ onClick }) => {
  const theme = useTheme();
  const [securityLevel, setSecurityLevel] = useState<'secure' | 'warning' | 'error' | 'unknown'>('unknown');
  const [tooltip, setTooltip] = useState('Loading security status...');

  const fetchSecurityStatus = async () => {
    try {
      const response = await apiClient.get('/api/security/summary');

      if (response.ok && response.data) {
        const summaryData = response.data as { success: boolean; data: { level: string; checks: any; warnings: any[] } };
        const level = summaryData.data.level as 'secure' | 'warning' | 'error';
        setSecurityLevel(level);

        // Update tooltip based on level
        switch (level) {
          case 'secure':
            setTooltip('Security: All systems secure');
            break;
          case 'warning':
            setTooltip('Security: Warning - Check details');
            break;
          case 'error':
            setTooltip('Security: Issues detected');
            break;
          default:
            setTooltip('Security status unknown');
        }
      }
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
