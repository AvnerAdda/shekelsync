import React from 'react';
import { Box, Button, Chip, Paper, Typography, alpha, useTheme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';

interface DashboardInsightsSectionToggleProps {
  expanded: boolean;
  insightCount: number;
  onToggle: () => void;
  sectionId: string;
}

const DashboardInsightsSectionToggle: React.FC<DashboardInsightsSectionToggleProps> = ({
  expanded,
  insightCount,
  onToggle,
  sectionId,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.dashboard.overview' });

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 4,
        bgcolor: (currentTheme) => alpha(currentTheme.palette.background.paper, 0.4),
        backdropFilter: 'blur(20px)',
        border: '1px solid',
        borderColor: (currentTheme) => alpha(currentTheme.palette.common.white, 0.1),
        boxShadow: (currentTheme) => `0 8px 32px 0 ${alpha(currentTheme.palette.common.black, 0.05)}`,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Chip
            label={t('count', { count: insightCount })}
            size="small"
            color={expanded ? 'primary' : 'default'}
            sx={{ mb: 1 }}
          />
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>

        <Button
          variant={expanded ? 'contained' : 'outlined'}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={sectionId}
          endIcon={
            <ExpandMoreIcon
              sx={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: theme.transitions.create('transform', {
                  duration: theme.transitions.duration.shorter,
                }),
              }}
            />
          }
          sx={{
            borderRadius: 999,
            px: 2,
            flexShrink: 0,
            textTransform: 'none',
          }}
        >
          {expanded ? t('hide') : t('show')}
        </Button>
      </Box>
    </Paper>
  );
};

export default DashboardInsightsSectionToggle;